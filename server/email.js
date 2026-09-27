import juice from "juice";
import nodemailer from "nodemailer";
import {
  getEmailTemplate,
  getEmailTemplateBySlug,
  getNewsletterStats,
} from "./db.js";
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

// ---- Transport selection ---------------------------------------------------
// The mail transport is chosen by the active letter config (email.provider),
// overridable per-deployment via EMAIL_PROVIDER. Either "resend" (Resend HTTP
// API) or "smtp" (any SMTP server via nodemailer). The *choice* and non-secret
// SMTP connection details live in config; secrets (Resend API key, SMTP
// password) live in env only.

function envBool(value) {
  if (value === undefined || value === "") return undefined;
  return value === "true" || value === "1";
}

const provider = (
  process.env.EMAIL_PROVIDER ||
  cfg.email.provider ||
  "resend"
).toLowerCase();

// Sender applies to both transports. RESEND_FROM kept for back-compat;
// EMAIL_FROM is the neutral alias.
const mailFrom =
  process.env.EMAIL_FROM || process.env.RESEND_FROM || cfg.email.from;

// Resend
const resendApiKey = process.env.RESEND_API_KEY || "";
const resendEndpoint = "https://api.resend.com/emails";
const resendBatchEndpoint = "https://api.resend.com/emails/batch";

// SMTP (host/port/secure may come from config; credentials only from env)
const smtpCfg = cfg.email.smtp || {};
const smtpHost = process.env.SMTP_HOST || smtpCfg.host || "";
const smtpPort = Number(process.env.SMTP_PORT || smtpCfg.port || 587);
const smtpSecure = envBool(process.env.SMTP_SECURE) ?? smtpCfg.secure ?? false;
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";

const transportSummary =
  provider === "smtp"
    ? `smtp host=${smtpHost || "?"} auth=${smtpUser ? "yes" : "no"}`
    : `resend auth=${resendApiKey ? "yes" : "no"}`;

if (process.env.NODE_ENV === "production") {
  // The published privacy policy names the email processor from the letter
  // config (src/App.jsx reads cfg.email.provider), so an EMAIL_PROVIDER that
  // disagrees would send every address through a processor the policy doesn't
  // name, or name one that isn't used. Fail closed instead.
  const published = String(cfg.email.provider || "").toLowerCase();
  if (published !== provider) {
    throw new Error(
      `EMAIL_PROVIDER=${provider} does not match email.provider="${published}" in the letter config. ` +
        "The privacy policy names the processor from the config; change the config (and redeploy) instead of overriding it.",
    );
  }
  if (provider === "resend" && !resendApiKey) {
    throw new Error("Production email requires RESEND_API_KEY");
  }
  if (provider === "smtp" && !smtpHost) {
    throw new Error("Production email with provider=smtp requires SMTP_HOST");
  }
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

// Lazily-created singleton SMTP transport.
let smtpTransport = null;
function getSmtpTransport() {
  if (!smtpHost) {
    throw new Error("SMTP_HOST (or email.smtp.host) is required to send email");
  }
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      ...(smtpUser && { auth: { user: smtpUser, pass: smtpPass } }),
    });
  }
  return smtpTransport;
}

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
const ec = cfg.theme.colors;
const emailDisplay = String(cfg.theme.fonts.display).replace(/"/g, "'");
const emailBody = String(cfg.theme.fonts.body).replace(/"/g, "'");

// Email-safe calendar button (inline styles, no border-radius); label from ui.server.calendarButton.
export function zoomCalendarButton(icsUrl, lang) {
  return `<p><a href="${icsUrl}" style="display:inline-block;background:${ec.rot};color:${ec.weiss};font-family:${emailDisplay};font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border:2px solid ${ec.akzent};">${serverStrings(lang).calendarButton}</a></p>`;
}

const emailCss = `
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
  const document = `<!doctype html><html><head><meta charset="utf-8"><style>${emailCss}</style></head><body>${body}${footer}</body></html>`;
  return juice(document);
}

// The template for `slug` in `lang`: its translation "<slug>.<lang>" (DB,
// then config) for a further language, else the default one (DB, then config).
export async function findTemplate(slug, lang) {
  const own = templateSlug(cfg, slug, lang);
  const candidates = own === slug ? [slug] : [own, slug];
  for (const s of candidates) {
    const t = (await getEmailTemplateBySlug(s)) || fallbackTemplates[s];
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
    ? await getEmailTemplate(own.templateId)
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
  const toDomain = getEmailDomain(payload.to);
  console.log(
    `[email] sending via=${transportSummary} toDomain=${toDomain} subject="${payload.subject}"`,
  );

  const messageId =
    provider === "smtp"
      ? await sendViaSmtp(payload)
      : await sendViaResend(payload);

  console.log(
    `[email] sent via=${transportSummary} toDomain=${toDomain} messageId=${messageId || ""}`,
  );
}

async function sendViaResend({ to, subject, html, headers, attachments }) {
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is required to send email");
  }

  const response = await fetch(resendEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom,
      to,
      subject,
      html,
      text: htmlToText(html),
      ...(headers && { headers }),
      ...(attachments && { attachments }),
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.message || result?.error || response.statusText;
    throw new Error(`Resend email failed: ${response.status} ${message}`);
  }

  return result.id || "";
}

// Map a Resend-shaped attachment ({ filename, content: base64, content_type })
// to nodemailer's shape ({ filename, content: Buffer, contentType }).
function toNodemailerAttachments(attachments) {
  return attachments.map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.content, "base64"),
    ...(a.content_type && { contentType: a.content_type }),
  }));
}

async function sendViaSmtp({ to, subject, html, headers, attachments }) {
  const transport = getSmtpTransport();
  const info = await transport.sendMail({
    from: mailFrom,
    to,
    subject,
    html,
    text: htmlToText(html),
    ...(headers && { headers }),
    ...(attachments && { attachments: toNodemailerAttachments(attachments) }),
  });
  return info.messageId || "";
}

// `onDelivered(emails)` is awaited with the messages known to have gone out, as
// soon as that is known: the whole chunk for Resend, each message for SMTP. The
// caller records them in its delivery log, so a retry never re-sends them.
export async function sendBatchEmails(
  emails,
  idempotencyKey = null,
  { onDelivered = async () => {} } = {},
) {
  return provider === "smtp"
    ? sendBatchViaSmtp(emails, idempotencyKey, onDelivered)
    : sendBatchViaResend(emails, idempotencyKey, onDelivered);
}

async function sendBatchViaResend(emails, idempotencyKey, onDelivered) {
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is required to send email");
  }

  const payload = emails.map((e) => ({
    from: mailFrom,
    to: e.to,
    subject: e.subject,
    html: e.html,
    text: htmlToText(e.html),
    ...(e.headers && { headers: e.headers }),
  }));

  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    console.log(
      `[email] batch sending ${emails.length} emails via=${transportSummary}${attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : ""}`,
    );

    const response = await fetch(resendBatchEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));

    if (response.ok) {
      const ids = (result.data || result || []).map((r) => r.id).join(", ");
      console.log(
        `[email] batch sent ${emails.length} emails via=${transportSummary} ids=${ids}`,
      );
      await onDelivered(emails);
      return result;
    }

    // Callers derive the key from the chunk's recipients, so a key Resend has
    // already processed (with a body that differs, e.g. a fresh token) means
    // this exact set of recipients was sent to before, typically a lost
    // response. Record it as delivered rather than failing every retry.
    if (
      response.status === 409 &&
      result?.name === "invalid_idempotent_request"
    ) {
      console.log(
        `[email] batch key=${idempotencyKey} already processed by Resend; treating ${emails.length} emails as delivered`,
      );
      await onDelivered(emails);
      return result;
    }

    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      // Another request with this key is still in flight, so it is safe to retry.
      result?.name === "concurrent_idempotent_requests";
    if (retryable && attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000;
      console.log(
        `[email] batch retry ${attempt + 1}/${maxRetries} after ${delay}ms (status=${response.status})`,
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const message = result?.message || result?.error || response.statusText;
    throw new Error(`Resend batch failed: ${response.status} ${message}`);
  }
}

// SMTP has no batch endpoint, so send each message individually. The
// idempotencyKey is logged for traceability but has no SMTP equivalent. Each
// accepted message is reported via onDelivered right away, and one rejected
// address doesn't stop the rest of the chunk; the chunk throws at the end if
// any failed, so the mailing is retried for exactly those.
async function sendBatchViaSmtp(emails, idempotencyKey, onDelivered) {
  console.log(
    `[email] batch sending ${emails.length} emails via=${transportSummary}${
      idempotencyKey ? ` key=${idempotencyKey}` : ""
    }`,
  );

  const ids = [];
  const failures = [];
  for (const e of emails) {
    try {
      ids.push(await sendViaSmtp(e));
    } catch (err) {
      failures.push(err);
      continue;
    }
    await onDelivered([e]);
  }

  console.log(
    `[email] batch sent ${ids.length}/${emails.length} emails via=${transportSummary} ids=${ids.join(", ")}`,
  );
  if (failures.length) {
    throw new Error(
      `SMTP batch: ${failures.length}/${emails.length} failed; first: ${failures[0].message}`,
    );
  }
  return { data: ids.map((id) => ({ id })) };
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

// Sent once the signature is confirmed: the personal invite link plus the
// private stats link. The stats token is only in this mail (see
// issueInviteStatsToken), so it is never logged or stored in a job payload.
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
  const rendered = await renderTemplateBySlug("invite", {
    name,
    firstName: name.split(/\s/)[0],
    inviteUrl,
    // In the fragment, which browsers never send: the token stays out of
    // server and proxy logs and Referer headers.
    statsUrl: `${inviteUrl}#s=${statsToken}`,
    unsubscribeUrl,
  }, lang);
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
  console.log(`[email] treffen already registered toDomain=${getEmailDomain(to)}`);
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
