import juice from "juice";
import { getEmailTemplateBySlug, getNewsletterStats } from "./db.js";

const resendApiKey = process.env.RESEND_API_KEY || "";
const resendFrom =
  process.env.RESEND_FROM ||
  '"Gehaltsdeckel Initiative" <noreply@gehaltsdeckel.jetzt>';
const resendEndpoint = "https://api.resend.com/emails";
const resendBatchEndpoint = "https://api.resend.com/emails/batch";
const transportSummary = `resend auth=${resendApiKey ? "yes" : "no"}`;

if (process.env.NODE_ENV === "production" && !resendApiKey) {
  throw new Error("Production email requires RESEND_API_KEY");
}

const fallbackTemplates = {
  verification: {
    subject: "Bitte bestätige deine Unterschrift — Gehaltsdeckel jetzt",
    html_body: `
      <p>Hallo {{name}},</p>
      <p>Danke für deine Unterschrift unter den offenen Brief „Gehaltsdeckel jetzt".</p>
      <p><a href="{{confirmUrl}}">Klicke hier, um deine E-Mail zu bestätigen</a></p>
      <p>Der Link ist 24 Stunden gültig.</p>
      <p>Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
  },
  already_signed: {
    subject: "Du hast bereits unterschrieben — Gehaltsdeckel jetzt",
    html_body: `
      <p>Hallo {{name}},</p>
      <p>deine Unterschrift unter den offenen Brief „Gehaltsdeckel jetzt" ist bereits bestätigt und wird gezählt.</p>
      <p>Du musst nichts weiter tun – danke für deine Solidarität!</p>
      <p>Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
  },
  deletion: {
    subject: "Deine Unterschrift löschen — Gehaltsdeckel jetzt",
    html_body: `
      <p>Hallo,</p>
      <p>du hast die Löschung deiner Unterschrift und aller gespeicherten Daten angefordert.</p>
      <p><a href="{{deleteUrl}}">Klicke hier, um deine Daten unwiderruflich zu löschen</a></p>
      <p>Der Link ist 24 Stunden gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.</p>
      <p>Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
  },
};

const emailCss = `
  body { margin: 0; padding: 24px; background: #ffffff; color: #6f003c; font-family: Inter, Arial, sans-serif; }
  .email-shell { max-width: 600px; margin: 0 auto; background: #f4f1ec; border: 1px solid #6f003c; padding: 36px; }
  h1, h2, h3 { font-family: "Work Sans", Arial, sans-serif; color: #6f003c; line-height: 1.08; margin: 0 0 16px; }
  h1 { font-size: 34px; font-weight: 900; }
  h2 { font-size: 28px; font-weight: 900; }
  h3 { font-size: 22px; font-weight: 700; }
  p { font-size: 16px; line-height: 1.6; margin: 0 0 16px; color: #6f003c; }
  a { color: #ff0000; font-weight: 700; }
  blockquote, .pullquote { border-left: 5px solid #ff0000; margin: 28px 0; padding: 8px 0 8px 18px; font-family: "Work Sans", Arial, sans-serif; font-size: 22px; line-height: 1.25; }
  .anrede { font-family: "Work Sans", Arial, sans-serif; font-size: 22px; font-weight: 300; }
  .gruss { font-family: "Work Sans", Arial, sans-serif; font-weight: 700; margin-top: 28px; }
  .signers-line { color: #6b6b6b; font-family: "Work Sans", Arial, sans-serif; }
  footer { border-top: 1px solid #6f003c; color: #6b6b6b; font-size: 13px; line-height: 1.5; margin-top: 28px; padding-top: 16px; }
`;

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const URL_VARIABLES = new Set(["confirmUrl", "deleteUrl", "unsubscribeUrl"]);

export function interpolateTemplate(value, variables = {}) {
  return String(value || "").replace(
    /\{\{\s*(name|firstName|confirmUrl|deleteUrl|signerCount|unsubscribeUrl)\s*\}\}/g,
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
  return String(email || "").split("@").pop() || "unknown";
}

export function buildUnsubscribeHeaders(optOutUrl) {
  return {
    "List-Unsubscribe": `<${optOutUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function sendRenderedEmail({ to, subject, html, headers }) {
  const toDomain = getEmailDomain(to);
  console.log(
    `[email] sending via=${transportSummary} toDomain=${toDomain} subject="${subject}"`,
  );

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
      from: resendFrom,
      to,
      subject,
      html,
      text: htmlToText(html),
      ...(headers && { headers }),
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.message || result?.error || response.statusText;
    throw new Error(`Resend email failed: ${response.status} ${message}`);
  }

  console.log(
    `[email] sent via=${transportSummary} toDomain=${toDomain} messageId=${result.id || ""}`,
  );
}

export async function sendBatchEmails(emails, idempotencyKey = null) {
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is required to send email");
  }

  const payload = emails.map((e) => ({
    from: resendFrom,
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

export async function sendDeletionEmail({ to, token, baseUrl, headers, unsubscribeUrl }) {
  console.log(`[email] deletion request toDomain=${getEmailDomain(to)}`);
  const deleteUrl = `${baseUrl}/api/delete/${token}`;
  const rendered = await renderTemplateBySlug("deletion", { deleteUrl, unsubscribeUrl });

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}

export async function sendAlreadySignedEmail({ to, name, headers, unsubscribeUrl }) {
  console.log(
    `[email] already-signed notification toDomain=${getEmailDomain(to)}`,
  );
  const firstName = name.split(/\s/)[0];
  const rendered = await renderTemplateBySlug("already_signed", { name, firstName, unsubscribeUrl });

  await sendRenderedEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    headers,
  });
}

export async function sendVerificationEmail({ to, name, token, baseUrl, headers, unsubscribeUrl }) {
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
