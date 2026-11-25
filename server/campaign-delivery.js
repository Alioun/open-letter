import { DeliveryDeferred } from "./email-setup.js";
import cfg, { DEFAULT_LANG } from "../config/letter.config.js";
import { normalizeLang } from "../config/i18n.js";
import { memoryTemplate } from "./template-snapshot.js";
import {
  getEmailTemplate,
  getCampaignRecipients,
  getNewsletterStats,
  getDeliveredEmails,
  markDeliveredForRecipient,
  authorizeRecipient,
  issueUnsubscribeTokenForRecipient,
  countDelivered,
  setCampaignProgress,
  setCampaignAudienceSize,
  markCampaignFailed,
  markCampaignSent,
  isCampaignSending,
  claimCampaignById,
  deferCampaign,
} from "./db.js";
import {
  dispatchEmail,
  campaignVersion,
  langLocale,
  pageUrl,
  interpolateTemplate,
  renderEmailHtml,
  buildUnsubscribeHeaders,
} from "./email.js";

export function createCampaignDelivery({
  baseUrl: BASE_URL,
  getZoomConfig,
  zoomIn,
  buildMeetingInfo,
  treffenSignupUrls,
  canContinue = () => true,
}) {
  async function sendCampaign(campaign) {
    const template =
      memoryTemplate(campaign.template_id) ||
      (await getEmailTemplate(campaign.template_id));
    if (!template) {
      console.error(
        `[campaign] ${campaign.id} template ${campaign.template_id} not found, aborting`,
      );
      await markCampaignFailed(campaign.id, { category: "missing-template" });
      return;
    }

    const audience = campaign.audience || "newsletter";
    const isZoom = audience === "zoom" || audience === "zoom_delegates";
    const recipients = await getCampaignRecipients(campaign);
    const stats = await getNewsletterStats();
    const signerCount = stats.signerCount?.toLocaleString("de-DE") || "0";
    const zoomCfg = await getZoomConfig();
    const zoomLinkInfo = zoomCfg ? buildMeetingInfo(zoomCfg) : "";
    // What a recipient in another language gets (features.multiLanguage): the
    // campaign's template and subject for that language, each falling back to
    // the default's, with dates, links and the meeting block in that language.
    const inLang = new Map();
    async function campaignFor(lang) {
      const l = normalizeLang(cfg, lang);
      if (l === DEFAULT_LANG) {
        return {
          lang: undefined,
          template,
          subject: campaign.subject,
          signerCount,
          zoomCfg,
          linkInfo: zoomLinkInfo,
        };
      }
      if (!inLang.has(l)) {
        const zc = zoomIn(zoomCfg, l);
        inLang.set(l, {
          ...(await campaignVersion(campaign, template, l)),
          signerCount: stats.signerCount?.toLocaleString(langLocale(l)) || "0",
          zoomCfg: zc,
          linkInfo: zc ? buildMeetingInfo(zc) : "",
        });
      }
      return inLang.get(l);
    }

    // Resume by who was reached, not by list position: the audience is
    // re-queried on every attempt, and opt-outs or late confirmations in between
    // would shift positions.
    const mailing = `campaign:${campaign.id}`;
    const delivered = await getDeliveredEmails(mailing);
    const todo = recipients.filter((r) => !delivered.has(r.email));
    // Reached so far, including people who left the audience since, plus
    // who is still to come: the denominator for "18 von 122".
    await setCampaignAudienceSize(campaign.id, delivered.size + todo.length);

    console.log(
      `[campaign] ${campaign.id} starting (attempt ${campaign.attempts}): ${recipients.length} in audience, ${delivered.size} already reached, remaining=${todo.length}, audience=${audience}`,
    );

    let failures = 0;
    let failure = null;
    for (const recipient of todo) {
      if (!canContinue()) {
        await deferCampaign(campaign.id, 5);
        throw new DeliveryDeferred("worker-stopping", 5);
      }
      if (!(await isCampaignSending(campaign.id))) {
        console.log(
          `[campaign] ${campaign.id} stopped in the admin: ${await countDelivered(mailing)} reached`,
        );
        return;
      }
      const identity = {
        source: isZoom ? "meeting" : "signer",
        id: recipient.id,
        email: recipient.email,
        createdAt: recipient.created_at,
      };
      try {
        await dispatchEmail(
          async () => {
            if (!(await authorizeRecipient(identity, { audience })))
              return null;
            const firstName = recipient.name.split(/\s/)[0];
            const text = await campaignFor(recipient.lang);
            const zc = text.zoomCfg;
            let variables;
            let optOutUrl;
            if (isZoom) {
              const token = await issueUnsubscribeTokenForRecipient(identity);
              if (!token) return null;
              const unsubscribeUrl = pageUrl(
                BASE_URL,
                `/abmelden/${token}?from=zoom`,
                text.lang,
              );
              optOutUrl = `${BASE_URL}/api/zoom-abmelden/${token}/opt-out`;
              variables = {
                name: recipient.name,
                firstName,
                eventLabel: zc.label,
                eventWhen: zc.whenPhrase,
                zoomLink: zc.link,
                linkInfo: text.linkInfo,
                unsubscribeUrl,
              };
            } else {
              const token = await issueUnsubscribeTokenForRecipient(identity);
              if (!token) return null;
              const unsubscribeUrl = pageUrl(
                BASE_URL,
                `/abmelden/${token}`,
                text.lang,
              );
              optOutUrl = `${BASE_URL}/api/unsubscribe/${token}/opt-out`;
              variables = {
                name: recipient.name,
                firstName,
                signerCount: text.signerCount,
                eventLabel: zc?.label || "",
                eventWhen: zc?.whenPhrase || "",
                linkInfo: text.linkInfo,
                unsubscribeUrl,
                ...treffenSignupUrls(token, zc?.showDelegierter, text.lang),
              };
            }
            return {
              to: recipient.email,
              subject: interpolateTemplate(text.subject, variables),
              html: renderEmailHtml(
                text.template.html_body,
                variables,
                text.lang,
              ),
              headers: buildUnsubscribeHeaders(optOutUrl),
            };
          },
          {
            priority: "campaign",
            scope: `campaign-${campaign.id}:${recipient.email}`,
            eligible: (connection) =>
              authorizeRecipient(identity, { audience, connection }),
            onAccepted: (connection) =>
              markDeliveredForRecipient(mailing, identity, { connection }),
          },
        );
      } catch (error) {
        if (
          error.defer &&
          error.message !== "provider-reconciliation-required"
        ) {
          await deferCampaign(campaign.id, error.retryAfterS);
          throw error;
        }
        failures++;
        failure =
          error.message === "provider-reconciliation-required"
            ? { category: "provider-reconciliation-required" }
            : error.diagnostic || { category: "message-preparation" };
        console.error(
          `[campaign] ${campaign.id} recipient ${recipient.id} pending:`,
          error.message,
        );
      }
      await setCampaignProgress(campaign.id, await countDelivered(mailing));
    }

    const reached = await countDelivered(mailing);
    if (failures > 0) {
      console.error(
        `[campaign] ${campaign.id} attempt ${campaign.attempts} finished with ${failures} failure(s): ${reached} reached, will retry the rest`,
      );
      await setCampaignProgress(campaign.id, reached);
      await markCampaignFailed(campaign.id, failure);
      return;
    }
    console.log(`[campaign] ${campaign.id} done: ${reached} reached`);
    await markCampaignSent(campaign.id, reached);
  }

  async function handleCampaignJob({ campaignId }) {
    const campaign = await claimCampaignById(campaignId);
    if (campaign) await sendCampaign(campaign);
  }
  return { send: sendCampaign, handle: handleCampaignJob };
}
