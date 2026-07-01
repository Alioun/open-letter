import juice from "juice";
import nodemailer from "nodemailer";
import { getEmailTemplateBySlug, getNewsletterStats } from "./db.js";
import cfg from "../config/letter.config.js";

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

// Default templates come from the active letter config. Used as a fallback when
// a template hasn't been seeded/edited in the DB (db/setup.js seeds the same set).
const fallbackTemplates = Object.fromEntries(
  Object.entries(cfg.email.templates).map(([slug, t]) => [
    slug,
    { subject: t.subject, html_body: t.htmlBody },
  ]),
);

// Email colours/fonts come from the active letter theme. Inline styles use
// single-quoted font names so they survive inside double-quoted style="" attrs.
const ec = cfg.theme.colors;
const emailDisplay = String(cfg.theme.fonts.display).replace(/"/g, "'");
const emailBody = String(cfg.theme.fonts.body).replace(/"/g, "'");

// Email-safe "Zum Kalender hinzufügen" button (inline styles, no border-radius).
export function zoomCalendarButton(icsUrl) {
  return `<p><a href="${icsUrl}" style="display:inline-block;background:${ec.rot};color:${ec.weiss};font-family:${emailDisplay};font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border:2px solid ${ec.akzent};">Zum Kalender hinzufügen</a></p>`;
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

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const URL_VARIABLES = new Set([
  "confirmUrl",
  "deleteUrl",
  "unsubscribeUrl",
  "linkInfo",
  "zoomJaUrl",
  "zoomJaDelegiertUrl",
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
    /\{\{\s*(name|firstName|confirmUrl|deleteUrl|signerCount|unsubscribeUrl|eventLabel|eventWhen|linkInfo|zoomJaUrl|zoomJaDelegiertUrl)\s*\}\}/g,
    (_, key) => {
      const raw = String(variables[key] ?? "");
      return URL_VARIABLES.has(key) ? raw : escapeHtml(raw);
    },
  );
}

export function renderEmailHtml(htmlBody, variables = {}) {
  const body = interpolateTemplate(htmlBody, variables);
  const needsFooter = variables.unsubscribeUrl && !/<footer[\s>]/i.test(body);
  const footer = needsFooter
    ? `<footer>Du möchtest keine E-Mails mehr erhalten? <a href="${variables.unsubscribeUrl}">Hier abmelden</a>.</footer>`
    : "";
  const document = `<!doctype html><html><head><meta charset="utf-8"><style>${emailCss}</style></head><body>${body}${footer}</body></html>`;
  return juice(document);
}

export async function renderTemplateBySlug(slug, variables = {}) {
  const stats = await getNewsletterStats();
  const template =
    (await getEmailTemplateBySlug(slug)) || fallbackTemplates[slug] || null;
  if (!template) return null;

  const allVariables = {
    signerCount: stats.signerCount?.toLocaleString("de-DE") || "0",
    ...variables,
  };

  return {
    subject: interpolateTemplate(template.subject, allVariables),
    html: renderEmailHtml(template.html_body, allVariables),
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

export async function sendBatchEmails(emails, idempotencyKey = null) {
  return provider === "smtp"
    ? sendBatchViaSmtp(emails, idempotencyKey)
    : sendBatchViaResend(emails, idempotencyKey);
}

async function sendBatchViaResend(emails, idempotencyKey = null) {
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
      return result;
    }

    const retryable = response.status === 429 || response.status >= 500;
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

// SMTP has no batch endpoint — send each message individually. The
// idempotencyKey is logged for traceability but has no SMTP equivalent.
async function sendBatchViaSmtp(emails, idempotencyKey = null) {
  console.log(
    `[email] batch sending ${emails.length} emails via=${transportSummary}${
      idempotencyKey ? ` key=${idempotencyKey}` : ""
    }`,
  );

  const ids = [];
  for (const e of emails) {
    const messageId = await sendViaSmtp(e);
    ids.push(messageId);
  }

  console.log(
    `[email] batch sent ${emails.length} emails via=${transportSummary} ids=${ids.join(", ")}`,
  );
  return { data: ids.map((id) => ({ id })) };
}

export async function sendDeletionEmail({
  to,
  token,
  baseUrl,
  headers,
  unsubscribeUrl,
}) {
  console.log(`[email] deletion request toDomain=${getEmailDomain(to)}`);
  const deleteUrl = `${baseUrl}/api/delete/${token}`;
  const rendered = await renderTemplateBySlug("deletion", {
    deleteUrl,
    unsubscribeUrl,
  });

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
}) {
  console.log(
    `[email] already-signed notification toDomain=${getEmailDomain(to)}`,
  );
  const firstName = name.split(/\s/)[0];
  const rendered = await renderTemplateBySlug("already_signed", {
    name,
    firstName,
    unsubscribeUrl,
  });

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
}) {
  console.log(`[email] zoom confirmation toDomain=${getEmailDomain(to)}`);
  const firstName = name.split(/\s/)[0];
  const rendered = await renderTemplateBySlug("zoom_confirmation", {
    name,
    firstName,
    eventLabel,
    eventWhen,
    linkInfo,
  });

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
  });
}

export async function sendVerificationEmail({
  to,
  name,
  token,
  baseUrl,
  headers,
  unsubscribeUrl,
}) {
  console.log(`[email] verification toDomain=${getEmailDomain(to)}`);
  const confirmUrl = `${baseUrl}/api/confirm/${token}`;
  const firstName = name.split(/\s/)[0];
  const rendered = await renderTemplateBySlug("verification", {
    name,
    firstName,
    confirmUrl,
    unsubscribeUrl,
  });

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}
