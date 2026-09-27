// Run with the multi-language preload (see test/person-lang.test.js). Prints
// one JSON object of observations about mails and link pages per language.
import * as q from "../../server/db.js";
import {
  renderTemplateBySlug,
  campaignVersion,
  zoomCalendarButton,
} from "../../server/email.js";
import { prepareQueuedEmail } from "../../server/queued-email.js";
import { simplePage, pageCopy } from "../../server/pages.js";
import { buildZoomIcs } from "../../server/ics.js";
import { storedLang, requestLang } from "../../config/i18n.js";
import cfg, { configFor } from "../../config/letter.config.js";

const out = {};
const future = () => new Date(Date.now() + 3600_000);
const base = "https://example.org";

// Sign-up language: the page's, normalised; the default is stored as NULL.
const pageLang = (headers) =>
  storedLang(cfg, requestLang(cfg, new Request(`${base}/api/sign`, { headers })));
out.stored = {
  en: pageLang({ "X-Lang": "en" }),
  EN: pageLang({ "X-Lang": "EN" }),
  fr: pageLang({ "X-Lang": "fr" }),
  none: pageLang({}),
};

async function signer(email, lang) {
  await q.insertSigner({
    name: "Pia Pending",
    email,
    kv: "",
    occupation: "",
    newsletter: true,
    showPublicly: true,
    token: `tok-${email}`,
    expiresAt: future(),
    lang,
  });
  const id = await q.getSignerIdByEmail(email);
  return prepareQueuedEmail({ kind: "verification", signerId: id, baseUrl: base });
}
const en = await signer("en@example.org", "en");
const de = await signer("de@example.org", null);
out.queued = {
  en: { lang: en.lang, unsubscribeUrl: en.unsubscribeUrl },
  de: { lang: de.lang, unsubscribeUrl: de.unsubscribeUrl },
};
out.pendingLang = (await q.getPendingSignerByToken("tok-en@example.org")).lang;

const vars = {
  name: "Pia Pending",
  firstName: "Pia",
  confirmUrl: `${base}/api/confirm/x?lang=en`,
  unsubscribeUrl: `${base}/en/abmelden/t`,
};
out.mail = {
  en: await renderTemplateBySlug("verification", vars, "en"),
  de: await renderTemplateBySlug("verification", vars, null),
  fr: await renderTemplateBySlug("verification", vars, "fr"),
  // No English template of its own: the default text, English footer.
  enFallback: await renderTemplateBySlug("deletion", vars, "en"),
  deFallback: await renderTemplateBySlug("deletion", vars),
};
out.calendar = {
  en: zoomCalendarButton("https://x/ics", "en"),
  de: zoomCalendarButton("https://x/ics"),
};
out.page = {
  en: simplePage("<p>x</p>", configFor("en"), "en"),
  de: simplePage("<p>x</p>", cfg),
  // The letter's own (German) `pages` apply to every language unless its
  // i18n block translates them; keys it leaves out come from the defaults.
  enError: pageCopy(configFor("en"), "en").error.heading,
};
out.ics = buildZoomIcs({ start: new Date(0), summary: "S", uid: "u", lang: "en" });

// Campaign texts: own template and subject for "en", default otherwise.
const baseTpl = { id: 1, subject: "Hallo", html_body: "<p>de</p>" };
const { db } = await import("../../db/connection.js");
const enTpl = await db
  .query(
    `INSERT INTO email_templates (slug, name, subject, html_body)
     VALUES ('news-en', 'News EN', 'News', '<p>en</p>') RETURNING id`,
  )
  .get();
const campaign = {
  subject: "Neuigkeiten",
  i18n: { en: { templateId: enTpl.id } },
};
const pick = async (c, l) => {
  const v = await campaignVersion(c, baseTpl, l);
  return { lang: v.lang ?? null, subject: v.subject, body: v.template.html_body };
};
out.campaign = {
  en: await pick(campaign, "en"),
  de: await pick(campaign, null),
  fr: await pick(campaign, "fr"),
  enSubjectOnly: await pick({ subject: "Neuigkeiten", i18n: { en: { subject: "News!" } } }, "en"),
  enMissingTemplate: await pick({ subject: "Neuigkeiten", i18n: { en: { templateId: 99999 } } }, "en"),
  enNone: await pick({ subject: "Neuigkeiten", i18n: null }, "en"),
};

console.log(JSON.stringify(out));
process.exit(0);
