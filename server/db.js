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
  sort = "desc",
}) {
  limit = Math.min(Math.max(1, limit), 100);
  offset = Math.max(0, offset);

  const searchParam = search.trim() ? `%${search.trim().toLowerCase()}%` : null;
  const sortDir = sort === "asc" ? sql`ASC` : sql`DESC`;

  const filterClause =
    filter === "heute"
      ? sql`AND s.created_at > NOW() - INTERVAL '24 hours'`
      : filter === "kv"
        ? sql`AND s.kreisverband != ''`
        : sql``;

  const searchClause = searchParam
    ? sql`AND (LOWER(s.name) LIKE ${searchParam} OR LOWER(s.kreisverband) LIKE ${searchParam} OR LOWER(s.occupation) LIKE ${searchParam})`
    : sql``;

  const [{ total }] = await sql`
    SELECT COUNT(*)::int AS total
    FROM signers s
    WHERE s.verified = TRUE AND s.show_publicly = TRUE
    ${filterClause}
    ${searchClause}
  `;

  const signers = await sql`
    SELECT s.id, s.name, s.kreisverband, s.occupation, s.state, s.created_at
    FROM signers s
    WHERE s.verified = TRUE AND s.show_publicly = TRUE
    ${filterClause}
    ${searchClause}
    ORDER BY s.created_at ${sortDir}
    LIMIT ${limit} OFFSET ${offset}
  `;

  return { signers, total };
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
  occupation,
  newsletter,
  showPublicly,
  token,
  expiresAt,
}) {
  const result = await sql`
    INSERT INTO signers (name, email, kreisverband, occupation, newsletter, show_publicly, verification_token, token_expires_at)
    VALUES (${name}, ${email}, ${kv}, ${occupation || ""}, ${newsletter}, ${showPublicly}, ${token}, ${expiresAt})
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          kreisverband = EXCLUDED.kreisverband,
          occupation = EXCLUDED.occupation,
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

export async function getVerifiedSignerName(email) {
  const result = await sql`
    SELECT name FROM signers WHERE email = ${email} AND verified = TRUE
  `;
  return result.length > 0 ? result[0].name : null;
}

export async function refreshVerificationToken(email, token, expiresAt) {
  const result = await sql`
    UPDATE signers
    SET verification_token = ${token}, token_expires_at = ${expiresAt}
    WHERE email = ${email} AND verified = FALSE
    RETURNING name
  `;
  if (result.length === 0) return null; // not found or already verified
  return result[0].name;
}

export async function confirmSigner(token) {
  const result = await sql`
    UPDATE signers
    SET verified = TRUE, verification_token = NULL, token_expires_at = NULL
    WHERE verification_token = ${token}
      AND verified = FALSE
      AND token_expires_at > NOW()
    RETURNING id, kreisverband
  `;
  if (result.length === 0) return null;
  return { id: result[0].id, kreisverband: result[0].kreisverband };
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
      AND unsubscribe_token_created_at > NOW() - INTERVAL '90 days'
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
      AND unsubscribe_token_created_at > NOW() - INTERVAL '90 days'
    RETURNING id
  `;
  return Boolean(signer);
}

export async function deleteSignerByUnsubscribeToken(token) {
  const [signer] = await sql`
    DELETE FROM signers
    WHERE unsubscribe_token = ${token}
      AND unsubscribe_token_created_at > NOW() - INTERVAL '90 days'
    RETURNING id
  `;
  return Boolean(signer);
}

export function normalizeOccupation(occ) {
  let s = occ.trim();
  // Strip explicit gender markers: *in, *innen, :in, /in etc.
  s = s.replace(/\*innen$|\*in$|:innen$|:in$|\/innen$|\/in$/i, "");
  // Strip feminine -in/-innen suffix (Lehrerin→Lehrer, Ärztinnen→Ärzt)
  s = s.replace(/innen$|in$/i, (m, offset, str) => {
    const before = str.slice(0, offset);
    if (before.length >= 2) return "";
    return m;
  });
  // Strip adjectival & weak-noun endings -er/-e so gender variants
  // normalize to the same base:
  //   Angestellter / Angestellte  → angestellt
  //   Sozialpädagoge              → sozialpädagog  (matches Sozialpädagogin→sozialpädagog)
  //   Lehrer                      → lehr           (matches Lehrerin→Lehrer→lehr)
  s = s.replace(/er$|e$/i, (m, offset) => {
    if (offset >= 3) return "";
    return m;
  });
  return s.toLowerCase();
}

function addGendersternchen(label) {
  // Already has a gender marker — leave it
  if (/[*:/]in(nen)?$/i.test(label)) return label;

  // Feminine -in/-innen form: Ärztin → Ärzt*in, Studentin → Student*in
  const femMatch = label.match(/^(.+?)(innen|in)$/i);
  if (femMatch && femMatch[1].length >= 2) {
    return `${femMatch[1]}*${femMatch[2].toLowerCase()}`;
  }

  // Adjectival masculine -er (stem ends in -t/-d):
  //   Angestellter → Angestellte*r, Beamter → Beamte*r
  const adjErMatch = label.match(/^(.+[dt])er$/i);
  if (adjErMatch && adjErMatch[1].length >= 3) {
    return `${adjErMatch[1]}e*r`;
  }

  // Adjectival feminine -e (stem ends in -t/-d):
  //   Angestellte → Angestellte*r, Studierende → Studierende*r
  const adjEMatch = label.match(/^(.+[dt])e$/i);
  if (adjEMatch && adjEMatch[1].length >= 3) {
    return `${label}*r`;
  }

  // Weak masculine -e (consonant + e): Sozialpädagoge → Sozialpädagog*in
  if (label.length >= 4 && /[^aeioüö]e$/i.test(label)) {
    return `${label.slice(0, -1)}*in`;
  }

  // Default: Lehrer → Lehrer*in
  return `${label}*in`;
}

export async function getOccupations() {
  const rows = await sql`
    SELECT occupation, COUNT(*)::int AS count
    FROM signers
    WHERE verified = TRUE AND occupation != '' AND show_publicly = TRUE
    GROUP BY occupation
    ORDER BY count DESC, occupation ASC
  `;
  const groups = new Map();
  for (const row of rows) {
    const key = normalizeOccupation(row.occupation);
    if (groups.has(key)) {
      const g = groups.get(key);
      g.count += row.count;
      if (row.count > g.maxCount) {
        g.maxCount = row.count;
        g.label = row.occupation;
      }
    } else {
      groups.set(key, {
        label: row.occupation,
        count: row.count,
        maxCount: row.count,
      });
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "de"))
    .slice(0, 100)
    .map((g) => ({
      occupation: g.count > 1 ? addGendersternchen(g.label) : g.label,
      count: g.count,
    }));
}

export async function getKreisverbandStats() {
  const rows = await sql`
    SELECT
      CASE WHEN kreisverband = '' THEN 'Ohne Kreisverband' ELSE kreisverband END AS kreisverband,
      COALESCE(NULLIF(state, ''), '') AS state,
      COUNT(*)::int AS count
    FROM signers
    WHERE verified = TRUE AND show_publicly = TRUE
    GROUP BY 1, 2
    ORDER BY count DESC, kreisverband ASC
  `;
  return rows;
}

export async function getDistinctKreisverbands() {
  return await sql`
    SELECT kreisverband, COUNT(*)::int AS count
    FROM signers
    WHERE verified = TRUE AND kreisverband != ''
    GROUP BY kreisverband
    ORDER BY count DESC, kreisverband ASC
  `;
}

export async function mergeKreisverband(fromKv, toKv) {
  const result = await sql`
    UPDATE signers
    SET kreisverband = ${toKv}, state = ''
    WHERE kreisverband = ${fromKv}
    RETURNING id
  `;
  return result.length;
}

export async function getDistinctOccupations() {
  return await sql`
    SELECT occupation, COUNT(*)::int AS count
    FROM signers
    WHERE verified = TRUE AND occupation != ''
    GROUP BY occupation
    ORDER BY count DESC, occupation ASC
  `;
}

export async function mergeOccupation(fromOcc, toOcc) {
  const result = await sql`
    UPDATE signers
    SET occupation = ${toOcc}
    WHERE occupation = ${fromOcc}
    RETURNING id
  `;
  return result.length;
}

export async function insertOccNotTypo(canonical, outlier) {
  await sql`
    INSERT INTO occupation_not_typo (canonical, outlier)
    VALUES (${canonical}, ${outlier})
    ON CONFLICT DO NOTHING
  `;
}

export async function loadOccNotTypo() {
  return await sql`SELECT canonical, outlier FROM occupation_not_typo`;
}

export async function updateSignerState(id, state) {
  await sql`UPDATE signers SET state = ${state} WHERE id = ${id}`;
}

export async function getSignersNeedingState(limit = null) {
  if (limit) {
    return await sql`
      SELECT s.id, s.kreisverband
      FROM signers s
      WHERE s.verified = TRUE
        AND s.kreisverband != ''
        AND s.state = ''
      ORDER BY s.created_at DESC
      LIMIT ${limit}
    `;
  }
  return await sql`
    SELECT s.id, s.kreisverband
    FROM signers s
    WHERE s.verified = TRUE
      AND s.kreisverband != ''
      AND s.state = ''
    ORDER BY s.created_at DESC
  `;
}

export async function getUnresolvedKvs() {
  return await sql`
    SELECT kreisverband, COUNT(*)::int AS count
    FROM signers
    WHERE verified = TRUE AND kreisverband != '' AND state = ''
    GROUP BY kreisverband
    ORDER BY count DESC, kreisverband ASC
  `;
}

export async function getStateStats() {
  return await sql`
    SELECT
      CASE WHEN state = '' THEN 'Unbekannt' ELSE state END AS state,
      COUNT(*)::int AS count
    FROM signers
    WHERE verified = TRUE AND show_publicly = TRUE
    GROUP BY 1
    ORDER BY count DESC, state ASC
  `;
}

export async function ensureKvStateCacheTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS kv_state_cache (
      kreisverband  TEXT PRIMARY KEY,
      state         TEXT NOT NULL DEFAULT '',
      source        TEXT NOT NULL DEFAULT 'nominatim',
      resolved_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS kv_not_typo (
      canonical     TEXT NOT NULL,
      outlier       TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (canonical, outlier)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS occupation_not_typo (
      canonical     TEXT NOT NULL,
      outlier       TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (canonical, outlier)
    )
  `;
}

export async function insertKvNotTypo(canonical, outlier) {
  await sql`
    INSERT INTO kv_not_typo (canonical, outlier)
    VALUES (${canonical}, ${outlier})
    ON CONFLICT DO NOTHING
  `;
}

export async function loadKvNotTypo() {
  return await sql`SELECT canonical, outlier FROM kv_not_typo`;
}

export async function upsertKvStateCache(kreisverband, state, source = "nominatim") {
  await sql`
    INSERT INTO kv_state_cache (kreisverband, state, source, resolved_at)
    VALUES (${kreisverband}, ${state}, ${source}, NOW())
    ON CONFLICT (kreisverband) DO UPDATE
      SET state = EXCLUDED.state,
          source = EXCLUDED.source,
          resolved_at = NOW()
  `;
}

export async function clearEmptyKvCacheEntries() {
  const result = await sql`
    DELETE FROM kv_state_cache WHERE state = ''
    RETURNING kreisverband
  `;
  return result.length;
}

export async function loadKvStateCache() {
  return await sql`
    SELECT kreisverband, state FROM kv_state_cache WHERE state != ''
  `;
}

export async function bulkUpdateSignerStateByKv(kreisverband, state) {
  const result = await sql`
    UPDATE signers SET state = ${state}
    WHERE kreisverband = ${kreisverband} AND state = ''
    RETURNING id
  `;
  return result.length;
}

export async function getStateResolutionStats() {
  const [row] = await sql`
    SELECT
      COUNT(DISTINCT s.kreisverband) FILTER (WHERE s.state != '')::int AS "resolvedKvs",
      COUNT(DISTINCT s.kreisverband) FILTER (WHERE s.state = '')::int AS "unresolvedKvs",
      COUNT(*) FILTER (WHERE s.state = '')::int AS "unresolvedSigners",
      COUNT(*) FILTER (WHERE s.state != '')::int AS "resolvedSigners"
    FROM signers s
    WHERE s.verified = TRUE AND s.kreisverband != ''
  `;
  return row;
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
