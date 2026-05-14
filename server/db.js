import postgres from "postgres";

const dbUrl = process.env.DATABASE_URL || "";
const sslMode = new URL(dbUrl).searchParams.get("sslmode") || "";
const ssl = sslMode.startsWith("disable")
  ? false
  : { rejectUnauthorized: false };

const sql = postgres(dbUrl, {
  ssl,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export async function getSigners({
  filter = "alle",
  search = "",
  limit = 18,
  offset = 0,
}) {
  limit = Math.min(Math.max(1, limit), 100);
  offset = Math.max(0, offset);

  const conditions = [`s.verified = TRUE`, `s.show_publicly = TRUE`];
  const params = [];

  if (filter === "heute") {
    conditions.push(`s.created_at > NOW() - INTERVAL '24 hours'`);
  } else if (filter === "kv") {
    conditions.push(`s.kreisverband != ''`);
  }

  if (search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(
      `(LOWER(s.name) LIKE $${params.length} OR LOWER(s.kreisverband) LIKE $${params.length})`,
    );
  }

  const where = conditions.join(" AND ");

  const countResult = await sql.unsafe(
    `SELECT COUNT(*)::int AS total FROM signers s WHERE ${where}`,
    params,
  );

  params.push(limit, offset);
  const signers = await sql.unsafe(
    `SELECT s.id, s.name, s.kreisverband, s.created_at
     FROM signers s
     WHERE ${where}
     ORDER BY s.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { signers, total: countResult[0].total };
}

export async function getStats() {
  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE verified)::int AS total,
      COUNT(*) FILTER (WHERE verified AND created_at > NOW() - INTERVAL '24 hours')::int AS today,
      COUNT(*) FILTER (WHERE verified AND created_at > NOW() - INTERVAL '7 days')::int AS week,
      COUNT(DISTINCT kreisverband) FILTER (WHERE verified AND kreisverband != '')::int AS "kvCount"
    FROM signers
  `;
  return row;
}

export async function getNewsletterStats() {
  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE verified)::int AS "signerCount",
      COUNT(*) FILTER (WHERE verified AND newsletter)::int AS "subscriberCount"
    FROM signers
  `;
  return row;
}

export async function insertSigner({
  name,
  email,
  kv,
  newsletter,
  showPublicly,
  token,
  expiresAt,
}) {
  const result = await sql`
    INSERT INTO signers (name, email, kreisverband, newsletter, show_publicly, verification_token, token_expires_at)
    VALUES (${name}, ${email}, ${kv}, ${newsletter}, ${showPublicly}, ${token}, ${expiresAt})
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          kreisverband = EXCLUDED.kreisverband,
          newsletter = EXCLUDED.newsletter,
          show_publicly = EXCLUDED.show_publicly,
          verification_token = EXCLUDED.verification_token,
          token_expires_at = EXCLUDED.token_expires_at
      WHERE signers.verified = FALSE
    RETURNING id, verified
  `;
  if (result.length === 0) {
    return { ok: false, alreadyVerified: true };
  }
  return { ok: true, alreadyVerified: result[0].verified };
}

export async function confirmSigner(token) {
  const result = await sql`
    UPDATE signers
    SET verified = TRUE, verification_token = NULL, token_expires_at = NULL
    WHERE verification_token = ${token}
      AND verified = FALSE
      AND token_expires_at > NOW()
    RETURNING id
  `;
  return result.length > 0;
}

export async function createDeletionToken(email, token, expiresAt) {
  const result = await sql`
    UPDATE signers
    SET deletion_token = ${token}, deletion_token_expires_at = ${expiresAt}
    WHERE email = ${email}
    RETURNING id
  `;
  return result.length > 0;
}

export async function deleteSigner(token) {
  const result = await sql`
    DELETE FROM signers
    WHERE deletion_token = ${token}
      AND deletion_token_expires_at > NOW()
    RETURNING id
  `;
  return result.length > 0;
}

export async function listEmailTemplates() {
  return await sql`
    SELECT id, slug, name, subject, updated_at,
           slug IN ('verification', 'deletion', 'open-letter-update') AS system
    FROM email_templates
    ORDER BY system DESC, updated_at DESC, name ASC
  `;
}

export async function getEmailTemplate(id) {
  const [template] = await sql`
    SELECT id, slug, name, subject, html_body, updated_at,
           slug IN ('verification', 'deletion', 'open-letter-update') AS system
    FROM email_templates
    WHERE id = ${id}
  `;
  return template || null;
}

export async function getEmailTemplateBySlug(slug) {
  const [template] = await sql`
    SELECT id, slug, name, subject, html_body, updated_at
    FROM email_templates
    WHERE slug = ${slug}
  `;
  return template || null;
}

export async function createEmailTemplate({ name, subject, htmlBody }) {
  const slugBase = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const reserved = ["verification", "deletion", "open-letter-update"];
  const safeSlugBase = reserved.some((prefix) => slugBase.startsWith(prefix))
    ? `newsletter-${slugBase || "template"}`
    : slugBase || "newsletter";
  const slug = `${safeSlugBase}-${crypto.randomUUID().slice(0, 8)}`;
  const [template] = await sql`
    INSERT INTO email_templates (slug, name, subject, html_body)
    VALUES (${slug}, ${name}, ${subject}, ${htmlBody})
    RETURNING id, slug, name, subject, html_body, updated_at,
              FALSE AS system
  `;
  return template;
}

export async function updateEmailTemplate(id, { subject, htmlBody }) {
  const [template] = await sql`
    UPDATE email_templates
    SET subject = ${subject}, html_body = ${htmlBody}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, slug, name, subject, html_body, updated_at,
              slug IN ('verification', 'deletion', 'open-letter-update') AS system
  `;
  return template || null;
}

export async function deleteEmailTemplate(id) {
  const [template] = await sql`
    DELETE FROM email_templates
    WHERE id = ${id}
      AND slug NOT IN ('verification', 'deletion', 'open-letter-update')
    RETURNING id
  `;
  return Boolean(template);
}

export async function listCampaigns() {
  return await sql`
    SELECT c.id, c.template_id, t.name AS template_name, c.subject, c.scheduled_at,
           c.sent_at, c.status, c.recipient_count, c.created_at
    FROM campaigns c
    LEFT JOIN email_templates t ON t.id = c.template_id
    ORDER BY c.scheduled_at DESC, c.created_at DESC
  `;
}

export async function createCampaign({ templateId, subject, scheduledAt }) {
  const [campaign] = await sql`
    INSERT INTO campaigns (template_id, subject, scheduled_at)
    SELECT id, ${subject}, ${scheduledAt}
    FROM email_templates
    WHERE id = ${templateId}
    RETURNING id, template_id, subject, scheduled_at, sent_at, status, recipient_count, created_at
  `;
  return campaign || null;
}

export async function cancelCampaign(id) {
  const [campaign] = await sql`
    DELETE FROM campaigns
    WHERE id = ${id}
      AND status = 'scheduled'
    RETURNING id
  `;
  return Boolean(campaign);
}

export async function claimDueCampaigns() {
  return await sql`
    UPDATE campaigns
    SET status = 'sending'
    WHERE id IN (
      SELECT id
      FROM campaigns
      WHERE scheduled_at <= NOW()
        AND status = 'scheduled'
      ORDER BY scheduled_at ASC
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, template_id, subject, scheduled_at
  `;
}

export async function markCampaignSent(id, recipientCount) {
  await sql`
    UPDATE campaigns
    SET status = 'sent', sent_at = NOW(), recipient_count = ${recipientCount}
    WHERE id = ${id}
  `;
}

export async function markCampaignFailed(id, recipientCount = null) {
  await sql`
    UPDATE campaigns
    SET status = 'failed', recipient_count = ${recipientCount}
    WHERE id = ${id}
  `;
}

export async function getNewsletterRecipients() {
  return await sql`
    SELECT id, name, email, unsubscribe_token
    FROM signers
    WHERE verified = TRUE
      AND newsletter = TRUE
    ORDER BY created_at ASC
  `;
}

export async function refreshUnsubscribeToken(id) {
  const token = crypto.randomUUID();
  const [row] = await sql`
    UPDATE signers
    SET unsubscribe_token = ${token}, unsubscribe_token_created_at = NOW()
    WHERE id = ${id}
    RETURNING unsubscribe_token
  `;
  return row?.unsubscribe_token || token;
}

export async function getUnsubscribeState(token) {
  const [signer] = await sql`
    SELECT id, email, newsletter, verified
    FROM signers
    WHERE unsubscribe_token = ${token}
  `;
  return signer || null;
}

export async function optOutNewsletter(token) {
  const [signer] = await sql`
    UPDATE signers
    SET newsletter = FALSE,
        unsubscribe_token = NULL,
        unsubscribe_token_created_at = NULL
    WHERE unsubscribe_token = ${token}
    RETURNING id
  `;
  return Boolean(signer);
}

export async function deleteSignerByUnsubscribeToken(token) {
  const [signer] = await sql`
    DELETE FROM signers
    WHERE unsubscribe_token = ${token}
    RETURNING id
  `;
  return Boolean(signer);
}

export async function healthCheck() {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function close() {
  await sql.end();
}
