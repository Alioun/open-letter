import juice from "juice";
import { getEmailTemplate, getNewsletterStats } from "./db.js";
import { memoryTemplate, memoryTemplateBySlug } from "./template-snapshot.js";
import { deliveryContext } from "./email-setup.js";
import cfg, { configFor } from "../config/letter.config.js";
import {
  normalizeLang,
  defaultLanguage,
  langPrefix,
  letterTemplates,
  templateSlug,
  withLang,
} from "../config/i18n.js";
import { fillText } from "../config/ui.js";
import { escapeHtml } from "./pages.js";
import { resolvePrivacy } from "../config/privacy.js";

let emailManager = null;
export function installEmailManager(manager) {
  emailManager = manager;
}

// ---- Send pacing -----------------------------------------------------------
// Delays inserted between outbound sends to respect provider rate limits.
// Configurable per letter via email.pacing, overridable via env. Read by the
// mailing workers in server/index.js.
const pacingCfg = cfg.email.pacing || {};
function envInt(value) {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
// Delay between individual one-by-one sends (e.g. the zoom link mailing).
export const messageDelayMs =
  envInt(process.env.EMAIL_MESSAGE_DELAY_MS) ?? pacingCfg.messageDelayMs ?? 550;
// Delay between consecutive batch chunks (campaign + zoom reminder sends).
export const batchDelayMs =
  envInt(process.env.EMAIL_BATCH_DELAY_MS) ?? pacingCfg.batchDelayMs ?? 1000;

// Default templates come from the active letter config, in every language it
// ships ("<slug>" and "<slug>.<lang>", config/i18n.js). Used as a fallback when
// a template hasn't been seeded/edited in the DB (db/setup.js seeds the same set).
const fallbackTemplates = letterTemplates(cfg);

// ---- Person language ---------------------------------------------------------
// A mail is written in the language of the person it goes to (their `lang`
// column; null or unknown means the letter's default). With
// features.multiLanguage off there is only the default, and every helper here
// returns exactly what the code did before languages existed.

// The `ui.server` strings of a language, its admin overrides included.
export function serverStrings(lang) {
  return configFor(lang).ui.server;
}

// Locale for numbers and dates in a language's mails and pages. The default
// language keeps the German formatting it always had.
export function langLocale(lang) {
  const l = normalizeLang(cfg, lang);
  if (l === defaultLanguage(cfg)) return "de-DE";
  const own = configFor(l).brand?.locale;
  return own && own !== cfg.brand?.locale ? own : l;
}

// Link helpers for mails: "?lang=<l>" on API links, "/<l>" before page paths.
export const langUrl = (url, lang) => withLang(cfg, url, lang);
export const pageUrl = (baseUrl, path, lang) =>
  `${baseUrl}${langPrefix(cfg, lang)}${path}`;

// Email colours/fonts come from the active letter theme. Inline styles use
// single-quoted font names so they survive inside double-quoted style="" attrs.
// Email-safe calendar button (inline styles, no border-radius); label from ui.server.calendarButton.
export function zoomCalendarButton(icsUrl, lang) {
  const ec = cfg.theme.colors;
  const emailDisplay = String(cfg.theme.fonts.display).replace(/"/g, "'");
  return `<p><a href="${icsUrl}" style="display:inline-block;background:${ec.rot};color:${ec.weiss};font-family:${emailDisplay};font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border:2px solid ${ec.akzent};">${serverStrings(lang).calendarButton}</a></p>`;
}

function emailCss() {
  const ec = cfg.theme.colors;
  const emailDisplay = cfg.theme.fonts.display;
  const emailBody = cfg.theme.fonts.body;
  return `
  body { margin: 0; padding: 24px; background: ${ec.weiss}; color: ${ec.akzent}; font-family: ${emailBody}; }
  .email-shell { max-width: 600px; margin: 0 auto; background: ${ec.fond}; border: 1px solid ${ec.akzent}; padding: 36px; }
  h1, h2, h3 { font-family: ${emailDisplay}; color: ${ec.akzent}; line-height: 1.08; margin: 0 0 16px; }
  h1 { font-size: 34px; font-weight: 900; }
  h2 { font-size: 28px; font-weight: 900; }
  h3 { font-size: 22px; font-weight: 700; }
  p { font-size: 16px; line-height: 1.6; margin: 0 0 16px; color: ${ec.akzent}; }
  a { color: ${ec.rot}; font-weight: 700; }
  blockquote, .pullquote { border-left: 5px solid ${ec.rot}; margin: 28px 0; padding: 8px 0 8px 18px; font-family: ${emailDisplay}; font-size: 22px; line-height: 1.25; }
  .anrede { font-family: ${emailDisplay}; font-size: 22px; font-weight: 300; }
  .gruss { font-family: ${emailDisplay}; font-weight: 700; margin-top: 28px; }
  .signers-line { color: ${ec.grau}; font-family: ${emailDisplay}; }
  footer { border-top: 1px solid ${ec.akzent}; color: ${ec.grau}; font-size: 13px; line-height: 1.5; margin-top: 28px; padding-top: 16px; }
`;
}

const URL_VARIABLES = new Set([
  "confirmUrl",
  "deleteUrl",
  "unsubscribeUrl",
  "linkInfo",
  "zoomJaUrl",
  "zoomJaDelegiertUrl",
  "inviteUrl",
  "statsUrl",
]);

export function interpolateTemplate(value, variables = {}) {
  // Conditional sections: {{#var}}…{{/var}} keep their inner block only when the
  // variable is truthy, else the whole block (markers included) is dropped. Lets
  // config templates gate optional buttons (e.g. the delegate CTA) on a value the
  // server sets to "" when the corresponding feature is off. Runs before the plain
  // {{var}} substitution below.
  const sectioned = String(value || "").replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key, inner) => (variables[key] ? inner : ""),
  );
  return sectioned.replace(
    /\{\{\s*(name|firstName|confirmUrl|deleteUrl|signerCount|unsubscribeUrl|eventLabel|eventWhen|linkInfo|zoomJaUrl|zoomJaDelegiertUrl|linkHours|inviteUrl|statsUrl)\s*\}\}/g,
    (_, key) => {
      const raw = String(variables[key] ?? "");
      return URL_VARIABLES.has(key) ? raw : escapeHtml(raw);
    },
  );
}

export function renderEmailHtml(htmlBody, variables = {}, lang) {
  const body = interpolateTemplate(htmlBody, variables);
  const needsFooter = variables.unsubscribeUrl && !/<footer[\s>]/i.test(body);
  const footer = needsFooter
    ? fillText(serverStrings(lang).unsubscribeFooter, {
        url: variables.unsubscribeUrl,
      })
    : "";
  const document = `<!doctype html><html><head><meta charset="utf-8"><style>${emailCss()}</style></head><body>${body}${footer}</body></html>`;
  return juice(document);
}

// The template for `slug` in `lang`: its translation "<slug>.<lang>" (DB,
// then config) for a further language, else the default one (DB, then config).
export async function findTemplate(slug, lang) {
  const own = templateSlug(cfg, slug, lang);
  const candidates = own === slug ? [slug] : [own, slug];
  for (const s of candidates) {
    const t = memoryTemplateBySlug(s) || fallbackTemplates[s];
    if (t) return t;
  }
  return null;
}

// A campaign's version for a recipient in `lang`: `lang` normalised (undefined
// for the default), the template and the subject. A further language uses the
// campaign's own template and subject for it (`campaign.i18n`), each falling
// back to the default's; a subject left empty takes that language's template's.
export async function campaignVersion(campaign, template, lang) {
  const l = normalizeLang(cfg, lang);
  if (l === defaultLanguage(cfg)) {
    return { lang: undefined, template, subject: campaign.subject };
  }
  const own = campaign.i18n?.[l] || {};
  const ownTemplate = own.templateId
    ? memoryTemplate(own.templateId) || (await getEmailTemplate(own.templateId))
    : null;
  return {
    lang: l,
    template: ownTemplate || template,
    subject: own.subject || ownTemplate?.subject || campaign.subject,
  };
}

export async function renderTemplateBySlug(slug, variables = {}, lang) {
  const stats = await getNewsletterStats();
  const template = await findTemplate(slug, lang);
  if (!template) return null;

  const allVariables = {
    signerCount: stats.signerCount?.toLocaleString(langLocale(lang)) || "0",
    // How long confirmation/deletion links stay valid (config privacy).
    linkHours: String(resolvePrivacy(cfg).confirmationLinkHours),
    ...variables,
  };

  return {
    subject: interpolateTemplate(template.subject, allVariables),
    html: renderEmailHtml(template.html_body, allVariables, lang),
  };
}

export function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getEmailDomain(email) {
  return (
    String(email || "")
      .split("@")
      .pop() || "unknown"
  );
}

export function buildUnsubscribeHeaders(optOutUrl) {
  return {
    "List-Unsubscribe": `<${optOutUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function sendRenderedEmail(payload) {
  if (!emailManager) throw new Error("Email configuration is not loaded");
  return emailManager.send(payload, deliveryContext.getStore() || {});
}

export function dispatchEmail(prepare, options) {
  if (!emailManager) throw new Error("Email configuration is not loaded");
  return emailManager.send(prepare, options);
}

export async function sendBatchEmails(
  emails,
  idempotencyKey = null,
  { onDelivered = async () => {} } = {},
) {
  let failure;
  for (const message of emails) {
    try {
      await emailManager.send(message, {
        priority: "campaign",
        scope: `${idempotencyKey || "batch"}:${message.to}`,
      });
      await onDelivered([message]);
    } catch (error) {
      if (error.defer && error.message !== "provider-reconciliation-required")
        throw error;
      failure ||= error;
    }
  }
  if (failure) throw failure;
}

export async function sendDeletionEmail({
  to,
  token,
  baseUrl,
  headers,
  unsubscribeUrl,
  lang,
}) {
  console.log(`[email] deletion request toDomain=${getEmailDomain(to)}`);
  const deleteUrl = langUrl(`${baseUrl}/api/delete/${token}`, lang);
  const rendered = await renderTemplateBySlug(
    "deletion",
    { deleteUrl, unsubscribeUrl },
    lang,
  );

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}

export async function sendAlreadySignedEmail({
  to,
  name,
  headers,
  unsubscribeUrl,
  lang,
}) {
  console.log(
    `[email] already-signed notification toDomain=${getEmailDomain(to)}`,
  );
  const firstName = name.split(/\s/)[0];
  const rendered = await renderTemplateBySlug(
    "already_signed",
    { name, firstName, unsubscribeUrl },
    lang,
  );

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}

export async function sendZoomConfirmationEmail({
  to,
  name,
  eventLabel,
  eventWhen = "",
  linkInfo = "",
  unsubscribeUrl,
  headers,
  lang,
}) {
  console.log(`[email] zoom confirmation toDomain=${getEmailDomain(to)}`);
  const firstName = name.split(/\s/)[0];
  const rendered = await renderTemplateBySlug(
    "zoom_confirmation",
    { name, firstName, eventLabel, eventWhen, linkInfo, unsubscribeUrl },
    lang,
  );

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}

export async function sendVerificationEmail({
  to,
  name,
  token,
  baseUrl,
  headers,
  unsubscribeUrl,
  lang,
}) {
  console.log(`[email] verification toDomain=${getEmailDomain(to)}`);
  const confirmUrl = langUrl(`${baseUrl}/api/confirm/${token}`, lang);
  const firstName = name.split(/\s/)[0];
  const rendered = await renderTemplateBySlug(
    "verification",
    { name, firstName, confirmUrl, unsubscribeUrl },
    lang,
  );

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}

export async function sendInviteEmail({
  to,
  name,
  inviteCode,
  statsToken,
  baseUrl,
  headers,
  unsubscribeUrl,
  lang,
}) {
  console.log(`[email] invite toDomain=${getEmailDomain(to)}`);
  // The invite page in the inviter's language; invitees see it in that one
  // too, and each gets their own language's link after signing.
  const inviteUrl = pageUrl(baseUrl, `/i/${inviteCode}`, lang);
  const rendered = await renderTemplateBySlug(
    "invite",
    {
      name,
      firstName: name.split(/\s/)[0],
      inviteUrl,
      // In the fragment, which browsers never send: the token stays out of
      // server and proxy logs and Referer headers.
      statsUrl: `${inviteUrl}#s=${statsToken}`,
      unsubscribeUrl,
    },
    lang,
  );
  if (!rendered) throw new Error("invite template missing");

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}

export async function sendTreffenAlreadyRegisteredEmail({
  to,
  name,
  headers,
  unsubscribeUrl,
  eventLabel = "",
  eventWhen = "",
  lang,
}) {
  console.log(
    `[email] treffen already registered toDomain=${getEmailDomain(to)}`,
  );
  const rendered = await renderTemplateBySlug(
    "zoom_already_registered",
    {
      name,
      firstName: name.split(/\s/)[0],
      unsubscribeUrl,
      eventLabel,
      eventWhen,
    },
    lang,
  );
  if (!rendered) throw new Error("zoom_already_registered template missing");

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}

export async function sendTreffenVerificationEmail({
  to,
  name,
  token,
  baseUrl,
  eventLabel = "",
  eventWhen = "",
  lang,
}) {
  console.log(`[email] treffen verification toDomain=${getEmailDomain(to)}`);
  const rendered = await renderTemplateBySlug(
    "zoom_verification",
    {
      name,
      firstName: name.split(/\s/)[0],
      confirmUrl: langUrl(`${baseUrl}/api/treffen-bestaetigen/${token}`, lang),
      eventLabel,
      eventWhen,
    },
    lang,
  );
  if (!rendered) throw new Error("zoom_verification template missing");

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
  });
}
