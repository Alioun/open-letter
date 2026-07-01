// Data access layer — bun:sqlite over a SQLCipher-encrypted database.
//
// Migrated from postgres.js. Key translation rules applied throughout:
//   * Timestamps are ISO-8601 UTC TEXT. Bind Dates via `iso()`, compare against
//     JS-computed cutoffs (`isoAgo`) instead of `NOW() - INTERVAL '…'`.
//   * Booleans are stored as 0/1; response-facing rows are coerced back to JS
//     booleans via `boolify`.
//   * `campaigns.recipient_ids` is a JSON-array TEXT column (Postgres INTEGER[]).
//   * The Postgres `fuzzystrmatch` search (levenshtein / regexp_split_to_table)
//     is reimplemented in JS (`fuzzyMatch`), since bun:sqlite has no custom
//     SQL functions.
import { db, nowIso, isoAgo } from "../db/connection.js";
import cfg from "../config/letter.config.js";

const DAY = 24 * 60 * 60 * 1000;

// ---- small helpers ---------------------------------------------------------

const B = (v) => (v ? 1 : 0);
const iso = (v) =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

function boolify(row, fields) {
  if (!row) return row;
  for (const f of fields) if (f in row) row[f] = !!row[f];
  return row;
}
function boolifyAll(rows, fields) {
  for (const r of rows) boolify(r, fields);
  return rows;
}

// Full Levenshtein edit distance (strings here are short — names / KV labels).
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Mirrors the old SQL fuzzy clause + match_score:
//   match  -> substring OR per-word name Levenshtein OR whole-KV Levenshtein
//   score  -> best similarity ratio in [0,1] used for ranking
function fuzzyMatch(name, kv, q) {
  const nameLower = (name || "").toLowerCase();
  const kvLower = (kv || "").toLowerCase();
  let match = false;
  let score = 0;

  if (nameLower.includes(q)) {
    match = true;
    score = 1;
  }
  if (kvLower.includes(q)) {
    match = true;
    score = 1;
  }

  for (const w of nameLower.split(/\s+/)) {
    if (w.length < 2) continue;
    const d = levenshtein(w, q);
    const thr = Math.max(1, Math.round(w.length * 0.4));
    if (d <= thr) match = true;
    const ratio = 1 - d / Math.max(w.length, q.length, 1);
    if (ratio > score) score = ratio;
  }

  if (kvLower.length >= 3) {
    const d = levenshtein(kvLower, q);
    const thr = Math.max(
      2,
      Math.round(Math.max(kvLower.length, q.length) * 0.35),
    );
    if (d <= thr) match = true;
    const ratio = 1 - d / Math.max(kvLower.length, q.length, 1);
    if (ratio > score) score = ratio;
  }

  return { match, score };
}

function parseIds(json) {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

// ---- public signers list ---------------------------------------------------

export async function getSigners({
  filter = "alle",
  search = "",
  limit = 18,
  offset = 0,
  sort = "desc",
}) {
  limit = Math.min(Math.max(1, limit), 100);
  offset = Math.max(0, offset);

  const searchClean = search.trim().toLowerCase();
  const sortDir = sort === "asc" ? "ASC" : "DESC";

  const conds = ["s.verified = 1", "s.show_publicly = 1"];
  const params = [];
  if (filter === "heute") {
    conds.push("s.created_at > ?");
    params.push(isoAgo(DAY));
  } else if (filter === "kv") {
    conds.push("s.kreisverband != ''");
  }
  const whereSql = conds.join(" AND ");

  if (!searchClean) {
    const { total } = await db
      .query(`SELECT COUNT(*) AS total FROM signers s WHERE ${whereSql}`)
      .get(...params);
    const signers = await db
      .query(
        `SELECT s.name, s.kreisverband, s.state, s.created_at
         FROM signers s WHERE ${whereSql}
         ORDER BY s.created_at ${sortDir} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return { signers, total };
  }

  // Fuzzy search in JS over the candidate set.
  const rows = await db
    .query(
      `SELECT s.name, s.kreisverband, s.state, s.created_at
       FROM signers s WHERE ${whereSql}`,
    )
    .all(...params);

  const scored = [];
  for (const r of rows) {
    const { match, score } = fuzzyMatch(r.name, r.kreisverband, searchClean);
    if (match) scored.push({ r, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return sortDir === "DESC"
      ? String(b.r.created_at).localeCompare(String(a.r.created_at))
      : String(a.r.created_at).localeCompare(String(b.r.created_at));
  });

  const total = scored.length;
  const signers = scored.slice(offset, offset + limit).map((x) => x.r);
  return { signers, total };
}

// ---- admin newsletter-signer list ------------------------------------------

function newsletterBase({
  state = "",
  kv = "",
  dateFrom = null,
  dateTo = null,
}) {
  const conds = ["s.verified = 1", "s.newsletter = 1"];
  const params = [];
  if (state) {
    conds.push("s.state = ?");
    params.push(state);
  }
  if (kv) {
    conds.push("s.kreisverband = ?");
    params.push(kv);
  }
  if (dateFrom) {
    conds.push("s.created_at >= ?");
    params.push(iso(dateFrom));
  }
  if (dateTo) {
    conds.push("s.created_at <= ?");
    params.push(iso(dateTo));
  }
  return { whereSql: conds.join(" AND "), params };
}

function matchesAdminSearch(row, q) {
  if ((row.email || "").toLowerCase().includes(q)) return true;
  return fuzzyMatch(row.name, row.kreisverband, q).match;
}

export async function listNewsletterSigners({
  search = "",
  state = "",
  kv = "",
  dateFrom = null,
  dateTo = null,
  limit = 25,
  offset = 0,
  sort = "desc",
}) {
  limit = Math.min(Math.max(1, limit), 100);
  offset = Math.max(0, offset);
  const sortDir = sort === "asc" ? "ASC" : "DESC";
  const searchClean = search.trim().toLowerCase();
  const { whereSql, params } = newsletterBase({ state, kv, dateFrom, dateTo });
  const cols =
    "s.id, s.name, s.email, s.kreisverband, s.occupation, s.state, s.created_at";

  if (!searchClean) {
    const { total } = await db
      .query(`SELECT COUNT(*) AS total FROM signers s WHERE ${whereSql}`)
      .get(...params);
    const signers = await db
      .query(
        `SELECT ${cols} FROM signers s WHERE ${whereSql}
         ORDER BY s.created_at ${sortDir} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return { signers, total };
  }

  const rows = await db
    .query(
      `SELECT ${cols} FROM signers s WHERE ${whereSql}
       ORDER BY s.created_at ${sortDir}`,
    )
    .all(...params);
  const filtered = rows.filter((r) => matchesAdminSearch(r, searchClean));
  const total = filtered.length;
  return { signers: filtered.slice(offset, offset + limit), total };
}

export async function listNewsletterSignerIds({
  search = "",
  state = "",
  kv = "",
  dateFrom = null,
  dateTo = null,
  cap = 20000,
} = {}) {
  const searchClean = search.trim().toLowerCase();
  const { whereSql, params } = newsletterBase({ state, kv, dateFrom, dateTo });
  let rows = await db
    .query(
      `SELECT s.id, s.name, s.email, s.kreisverband FROM signers s
       WHERE ${whereSql} ORDER BY s.created_at DESC`,
    )
    .all(...params);
  if (searchClean)
    rows = rows.filter((r) => matchesAdminSearch(r, searchClean));
  return rows.slice(0, cap).map((r) => r.id);
}

export async function getNewsletterSignerFilters() {
  const states = await db
    .query(
      `SELECT state, COUNT(*) AS count FROM signers
       WHERE verified = 1 AND newsletter = 1 AND state != ''
       GROUP BY state ORDER BY count DESC, state ASC`,
    )
    .all();
  const kvs = await db
    .query(
      `SELECT kreisverband, COUNT(*) AS count FROM signers
       WHERE verified = 1 AND newsletter = 1 AND kreisverband != ''
       GROUP BY kreisverband ORDER BY count DESC, kreisverband ASC`,
    )
    .all();
  return { states, kvs };
}

// ---- stats -----------------------------------------------------------------

export async function getStats() {
  return await db
    .query(
      `SELECT
        COUNT(*) FILTER (WHERE verified) AS total,
        COUNT(*) FILTER (WHERE verified AND created_at > ?) AS today,
        COUNT(*) FILTER (WHERE verified AND created_at > ?) AS week,
        COUNT(DISTINCT kreisverband) FILTER (WHERE verified AND kreisverband != '') AS "kvCount"
      FROM signers`,
    )
    .get(isoAgo(DAY), isoAgo(7 * DAY));
}

export async function getNewsletterStats() {
  return await db
    .query(
      `SELECT
        COUNT(*) FILTER (WHERE verified) AS "signerCount",
        COUNT(*) FILTER (WHERE verified AND newsletter) AS "subscriberCount",
        COUNT(*) FILTER (
          WHERE verified AND newsletter
            AND NOT EXISTS (
              SELECT 1 FROM zoom_registrations z WHERE z.email = signers.email
            )
        ) AS "newsletterNotZoomCount"
      FROM signers`,
    )
    .get();
}

// ---- signers: insert / verify / delete -------------------------------------

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
  const row = await db
    .query(
      `INSERT INTO signers
         (name, email, kreisverband, occupation, newsletter, show_publicly, verification_token, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET name = excluded.name,
             kreisverband = excluded.kreisverband,
             occupation = excluded.occupation,
             newsletter = excluded.newsletter,
             show_publicly = excluded.show_publicly,
             verification_token = excluded.verification_token,
             token_expires_at = excluded.token_expires_at
         WHERE signers.verified = 0
       RETURNING id, verified`,
    )
    .get(
      name,
      email,
      kv,
      occupation || "",
      B(newsletter),
      B(showPublicly),
      token,
      iso(expiresAt),
    );
  if (!row) return { ok: false, alreadyVerified: true };
  return { ok: true, alreadyVerified: !!row.verified };
}

export async function getVerifiedSignerName(email) {
  const row = await db
    .query(`SELECT name FROM signers WHERE email = ? AND verified = 1`)
    .get(email);
  return row ? row.name : null;
}

export async function refreshVerificationToken(email, token, expiresAt) {
  const row = await db
    .query(
      `UPDATE signers SET verification_token = ?, token_expires_at = ?
       WHERE email = ? AND verified = 0 RETURNING name`,
    )
    .get(token, iso(expiresAt), email);
  return row ? row.name : null;
}

export async function confirmSigner(token) {
  const row = await db
    .query(
      `UPDATE signers
       SET verified = 1, verification_token = NULL, token_expires_at = NULL
       WHERE verification_token = ? AND verified = 0 AND token_expires_at > ?
       RETURNING id, kreisverband`,
    )
    .get(token, nowIso());
  if (!row) return null;
  return { id: row.id, kreisverband: row.kreisverband };
}

export async function createDeletionToken(email, token, expiresAt) {
  const row = await db
    .query(
      `UPDATE signers SET deletion_token = ?, deletion_token_expires_at = ?
       WHERE email = ? RETURNING id`,
    )
    .get(token, iso(expiresAt), email);
  return Boolean(row);
}

export async function deleteSigner(token) {
  const row = await db
    .query(
      `DELETE FROM signers
       WHERE deletion_token = ? AND deletion_token_expires_at > ? RETURNING id`,
    )
    .get(token, nowIso());
  return Boolean(row);
}

// ---- zoom registrations ----------------------------------------------------

export async function getSignerForZoomInvite(token) {
  return (
    (await db
      .query(
        `SELECT id, name, email, kreisverband FROM signers
         WHERE unsubscribe_token = ? AND verified = 1`,
      )
      .get(token)) || null
  );
}

export async function insertZoomRegistration({ name, email, kv, delegierter }) {
  const row = await db
    .query(
      `INSERT INTO zoom_registrations (name, email, kreisverband, delegierter)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET name = excluded.name,
             kreisverband = excluded.kreisverband,
             delegierter = excluded.delegierter
       RETURNING id`,
    )
    .get(name, email, kv || "", B(delegierter));
  return { ok: true, id: row.id };
}

export async function getZoomRegistrationCount() {
  return await db
    .query(`SELECT COUNT(*) AS count FROM zoom_registrations`)
    .get();
}

export async function listZoomRegistrations() {
  return boolifyAll(
    await db
      .query(
        `SELECT name, email, kreisverband, delegierter, created_at
         FROM zoom_registrations ORDER BY created_at DESC`,
      )
      .all(),
    ["delegierter"],
  );
}

export async function getZoomCounts() {
  return await db
    .query(
      `SELECT COUNT(*) AS "zoomCount",
              COUNT(*) FILTER (WHERE delegierter) AS "zoomDelegateCount"
       FROM zoom_registrations`,
    )
    .get();
}

export async function getZoomRecipients({ delegatesOnly = false } = {}) {
  if (delegatesOnly) {
    return await db
      .query(
        `SELECT id, name, email, unsubscribe_token FROM zoom_registrations
         WHERE delegierter = 1 ORDER BY created_at ASC`,
      )
      .all();
  }
  return await db
    .query(
      `SELECT id, name, email, unsubscribe_token FROM zoom_registrations
       ORDER BY created_at ASC`,
    )
    .all();
}

export async function refreshZoomUnsubscribeToken(id) {
  const token = crypto.randomUUID();
  const row = await db
    .query(
      `UPDATE zoom_registrations SET unsubscribe_token = ?
       WHERE id = ? RETURNING unsubscribe_token`,
    )
    .get(token, id);
  return row?.unsubscribe_token || token;
}

export async function deleteZoomRegistrationByUnsubscribeToken(token) {
  const row = await db
    .query(
      `DELETE FROM zoom_registrations WHERE unsubscribe_token = ? RETURNING id`,
    )
    .get(token);
  return Boolean(row);
}

export async function getZoomRegistrationByEmail(email) {
  const row = await db
    .query(
      `SELECT id, delegierter, unsubscribe_token FROM zoom_registrations
       WHERE email = ?`,
    )
    .get(email);
  return boolify(row || null, ["delegierter"]);
}

// Race-safe claim: returns true only if newly inserted or previously failed.
export async function claimZoomMailing(kind) {
  const row = await db
    .query(
      `INSERT INTO zoom_event_mailings (kind, status, updated_at)
       VALUES (?, 'sending', ?)
       ON CONFLICT (kind) DO UPDATE
         SET status = 'sending', updated_at = ?
         WHERE zoom_event_mailings.status = 'failed'
       RETURNING kind`,
    )
    .get(kind, nowIso(), nowIso());
  return Boolean(row);
}

export async function markZoomMailing(kind, status, count = null) {
  const setSent = status === "sent" ? "sent_at = ?, " : "";
  const params = [status, count];
  if (status === "sent") params.push(nowIso());
  params.push(nowIso(), kind);
  await db
    .query(
      `UPDATE zoom_event_mailings
     SET status = ?, recipient_count = ?, ${setSent}updated_at = ?
     WHERE kind = ?`,
    )
    .run(...params);
}

export async function listZoomMailings() {
  return await db
    .query(
      `SELECT kind, status, recipient_count, sent_at, updated_at
       FROM zoom_event_mailings ORDER BY kind ASC`,
    )
    .all();
}

export async function resetZoomMailings() {
  await db.query(`DELETE FROM zoom_event_mailings`).run();
}

// Wipes all Zoom registrations and resets the mailing state, so the same Zoom
// event/list can be reused for a fresh round of signups (e.g. repurposing the
// original meeting for an Auswertungszoom). Returns the number of rows removed.
export async function clearZoomRegistrations() {
  const { count } = await db
    .query(`SELECT COUNT(*) AS count FROM zoom_registrations`)
    .get();
  await db.query(`DELETE FROM zoom_registrations`).run();
  await resetZoomMailings();
  return count;
}

export async function getZoomSettings() {
  const rows = await db
    .query(`SELECT key, value FROM app_settings WHERE key LIKE 'zoom_%'`)
    .all();
  const out = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function setZoomSettings(partial) {
  const entries = Object.entries(partial).filter(([, v]) => v != null);
  for (const [key, value] of entries) {
    await db
      .query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = ?`,
      )
      .run(key, String(value), nowIso(), nowIso());
  }
}

// ---- milestones (admin-editable goal thresholds) ---------------------------
// Stored as a JSON array under app_settings.milestones; seeded from the active
// letter config (cfg.hero.milestones) when unset.

function sanitizeMilestones(arr) {
  return [
    ...new Set(
      (Array.isArray(arr) ? arr : [])
        .map((n) => Math.round(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);
}

export async function getMilestones() {
  const row = await db
    .query(`SELECT value FROM app_settings WHERE key = 'milestones'`)
    .get();
  if (row?.value) {
    try {
      const arr = sanitizeMilestones(JSON.parse(row.value));
      if (arr.length) return arr;
    } catch {}
  }
  return cfg.hero.milestones;
}

export async function setMilestones(arr) {
  const clean = sanitizeMilestones(arr);
  if (!clean.length) throw new Error("milestones must be positive integers");
  await db
    .query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('milestones', ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = ?`,
    )
    .run(JSON.stringify(clean), nowIso(), nowIso());
  return clean;
}

// ---- email templates -------------------------------------------------------

const SYSTEM_SLUGS_SQL =
  "slug IN ('verification', 'deletion', 'open-letter-update')";

export async function listEmailTemplates() {
  return boolifyAll(
    await db
      .query(
        `SELECT id, slug, name, subject, updated_at, ${SYSTEM_SLUGS_SQL} AS system
         FROM email_templates
         ORDER BY system DESC, updated_at DESC, name ASC`,
      )
      .all(),
    ["system"],
  );
}

export async function getEmailTemplate(id) {
  const row = await db
    .query(
      `SELECT id, slug, name, subject, html_body, updated_at, ${SYSTEM_SLUGS_SQL} AS system
       FROM email_templates WHERE id = ?`,
    )
    .get(id);
  return boolify(row || null, ["system"]);
}

export async function getEmailTemplateBySlug(slug) {
  return (
    (await db
      .query(
        `SELECT id, slug, name, subject, html_body, updated_at
         FROM email_templates WHERE slug = ?`,
      )
      .get(slug)) || null
  );
}

export async function createEmailTemplate({ name, subject, htmlBody }) {
  const slugBase = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const reserved = ["verification", "deletion", "open-letter-update"];
  const safeSlugBase = reserved.some((prefix) => slugBase.startsWith(prefix))
    ? `newsletter-${slugBase || "template"}`
    : slugBase || "newsletter";
  const slug = `${safeSlugBase}-${crypto.randomUUID().slice(0, 8)}`;
  const row = await db
    .query(
      `INSERT INTO email_templates (slug, name, subject, html_body)
       VALUES (?, ?, ?, ?)
       RETURNING id, slug, name, subject, html_body, updated_at, 0 AS system`,
    )
    .get(slug, name, subject, htmlBody);
  return boolify(row, ["system"]);
}

export async function updateEmailTemplate(id, { subject, htmlBody }) {
  const row = await db
    .query(
      `UPDATE email_templates SET subject = ?, html_body = ?, updated_at = ?
       WHERE id = ?
       RETURNING id, slug, name, subject, html_body, updated_at, ${SYSTEM_SLUGS_SQL} AS system`,
    )
    .get(subject, htmlBody, nowIso(), id);
  return boolify(row || null, ["system"]);
}

export async function deleteEmailTemplate(id) {
  const row = await db
    .query(
      `DELETE FROM email_templates
       WHERE id = ? AND slug NOT IN ('verification', 'deletion', 'open-letter-update')
       RETURNING id`,
    )
    .get(id);
  return Boolean(row);
}

// ---- campaigns -------------------------------------------------------------

export async function listCampaigns() {
  return await db
    .query(
      `SELECT c.id, c.template_id, t.name AS template_name, c.subject, c.scheduled_at,
              c.sent_at, c.status, c.recipient_count, c.sent_offset, c.audience,
              COALESCE(json_array_length(c.recipient_ids), 0) AS selection_count, c.created_at
       FROM campaigns c
       LEFT JOIN email_templates t ON t.id = c.template_id
       ORDER BY c.scheduled_at DESC, c.created_at DESC`,
    )
    .all();
}

export async function createCampaign({
  templateId,
  subject,
  scheduledAt,
  audience = "newsletter",
  recipientIds = null,
}) {
  const ids =
    audience === "selection" && Array.isArray(recipientIds)
      ? JSON.stringify(recipientIds)
      : null;
  const row = await db
    .query(
      `INSERT INTO campaigns (template_id, subject, scheduled_at, audience, recipient_ids)
       SELECT id, ?, ?, ?, ? FROM email_templates WHERE id = ?
       RETURNING id, template_id, subject, scheduled_at, sent_at, status, recipient_count, audience, created_at`,
    )
    .get(subject, iso(scheduledAt), audience, ids, templateId);
  return row || null;
}

// Load a single campaign (for the job worker), with recipient_ids parsed.
export async function getCampaignById(id) {
  const row = await db
    .query(
      `SELECT id, template_id, subject, scheduled_at, sent_at, status,
              recipient_count, audience, sent_offset, recipient_ids, created_at
       FROM campaigns WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;
  row.recipient_ids = parseIds(row.recipient_ids);
  return row;
}

export async function cancelCampaign(id) {
  const row = await db
    .query(
      `DELETE FROM campaigns WHERE id = ? AND status = 'scheduled' RETURNING id`,
    )
    .get(id);
  return Boolean(row);
}

export async function claimDueCampaigns() {
  // SQLite is a single writer, so no FOR UPDATE SKIP LOCKED is needed.
  const rows = await db
    .query(
      `UPDATE campaigns SET status = 'sending'
       WHERE scheduled_at <= ? AND status IN ('scheduled', 'failed')
       RETURNING id, template_id, subject, scheduled_at, audience, sent_offset, recipient_ids`,
    )
    .all(nowIso());
  for (const r of rows) r.recipient_ids = parseIds(r.recipient_ids);
  return rows;
}

// Claim a single campaign for sending (used by the Honker job handler).
// Returns the row (recipient_ids parsed) or null if it isn't due/claimable.
export async function claimCampaignById(id) {
  const row = await db
    .query(
      `UPDATE campaigns SET status = 'sending'
       WHERE id = ? AND status IN ('scheduled', 'failed')
       RETURNING id, template_id, subject, scheduled_at, audience, sent_offset, recipient_ids`,
    )
    .get(id);
  if (!row) return null;
  row.recipient_ids = parseIds(row.recipient_ids);
  return row;
}

// Ids of campaigns whose send time has arrived (for the reconciler).
export async function getDueCampaignIds() {
  const rows = await db
    .query(
      `SELECT id FROM campaigns
       WHERE scheduled_at <= ? AND status IN ('scheduled', 'failed')`,
    )
    .all(nowIso());
  return rows.map((r) => r.id);
}

export async function markCampaignSent(id, recipientCount) {
  await db
    .query(
      `UPDATE campaigns SET status = 'sent', sent_at = ?, recipient_count = ? WHERE id = ?`,
    )
    .run(nowIso(), recipientCount, id);
}

export async function markCampaignFailed(id, recipientCount = null) {
  await db
    .query(
      `UPDATE campaigns SET status = 'failed',
       recipient_count = COALESCE(?, recipient_count) WHERE id = ?`,
    )
    .run(recipientCount, id);
}

export async function incrementCampaignOffset(id, count) {
  await db
    .query(
      `UPDATE campaigns SET sent_offset = sent_offset + ?, recipient_count = sent_offset + ?
     WHERE id = ?`,
    )
    .run(count, count, id);
}

// ---- newsletter / zoom recipients ------------------------------------------

export async function getNewsletterRecipientByEmail(email) {
  return (
    (await db
      .query(
        `SELECT id, name, email FROM signers
         WHERE email = ? AND verified = 1 AND newsletter = 1`,
      )
      .get(email)) || null
  );
}

export async function getZoomRecipientByEmail(email) {
  return (
    (await db
      .query(`SELECT id, name, email FROM zoom_registrations WHERE email = ?`)
      .get(email)) || null
  );
}

export async function getNewsletterRecipients() {
  return await db
    .query(
      `SELECT id, name, email, unsubscribe_token FROM signers
       WHERE verified = 1 AND newsletter = 1 ORDER BY created_at ASC`,
    )
    .all();
}

export async function getNewsletterNotZoomRecipients() {
  return await db
    .query(
      `SELECT id, name, email, unsubscribe_token FROM signers s
       WHERE s.verified = 1 AND s.newsletter = 1
         AND NOT EXISTS (SELECT 1 FROM zoom_registrations z WHERE z.email = s.email)
       ORDER BY s.created_at ASC`,
    )
    .all();
}

export async function getNewsletterRecipientsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return await db
    .query(
      `SELECT id, name, email, unsubscribe_token FROM signers
       WHERE verified = 1 AND newsletter = 1 AND id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .all(...ids);
}

// ---- unsubscribe tokens ----------------------------------------------------

export async function refreshUnsubscribeToken(id) {
  const token = crypto.randomUUID();
  const row = await db
    .query(
      `UPDATE signers SET unsubscribe_token = ?, unsubscribe_token_created_at = ?
       WHERE id = ? RETURNING unsubscribe_token`,
    )
    .get(token, nowIso(), id);
  return row?.unsubscribe_token || token;
}

export async function refreshUnsubscribeTokenByEmail(email) {
  const token = crypto.randomUUID();
  const row = await db
    .query(
      `UPDATE signers SET unsubscribe_token = ?, unsubscribe_token_created_at = ?
       WHERE email = ? RETURNING unsubscribe_token`,
    )
    .get(token, nowIso(), email);
  return row?.unsubscribe_token || null;
}

export async function getUnsubscribeState(token) {
  const row = await db
    .query(
      `SELECT id, email, newsletter, verified FROM signers
       WHERE unsubscribe_token = ? AND unsubscribe_token_created_at > ?`,
    )
    .get(token, isoAgo(90 * DAY));
  return boolify(row || null, ["newsletter", "verified"]);
}

export async function optOutNewsletter(token) {
  const row = await db
    .query(
      `UPDATE signers
       SET newsletter = 0, unsubscribe_token = NULL, unsubscribe_token_created_at = NULL
       WHERE unsubscribe_token = ? AND unsubscribe_token_created_at > ?
       RETURNING id`,
    )
    .get(token, isoAgo(90 * DAY));
  return Boolean(row);
}

export async function deleteSignerByUnsubscribeToken(token) {
  const row = await db
    .query(
      `DELETE FROM signers
       WHERE unsubscribe_token = ? AND unsubscribe_token_created_at > ? RETURNING id`,
    )
    .get(token, isoAgo(90 * DAY));
  return Boolean(row);
}

// Resolve email from either a signer or zoom unsubscribe token.
export async function resolveEmailFromToken(token, source) {
  if (source === "zoom") {
    const zoom = await db
      .query(`SELECT email FROM zoom_registrations WHERE unsubscribe_token = ?`)
      .get(token);
    if (zoom) return zoom.email;
  }
  const signer = await db
    .query(
      `SELECT email FROM signers
       WHERE unsubscribe_token = ? AND unsubscribe_token_created_at > ?`,
    )
    .get(token, isoAgo(90 * DAY));
  if (signer) return signer.email;
  if (source !== "zoom") {
    const zoom = await db
      .query(`SELECT email FROM zoom_registrations WHERE unsubscribe_token = ?`)
      .get(token);
    if (zoom) return zoom.email;
  }
  return null;
}

export async function getUnifiedUnsubscribeState(token, source) {
  const email = await resolveEmailFromToken(token, source);
  if (!email) return null;

  const signer = await db
    .query(
      `SELECT name, kreisverband, occupation, newsletter, show_publicly, verified
    FROM signers WHERE email = ?`,
    )
    .get(email);
  const zoom = await db
    .query(
      `SELECT name, kreisverband, delegierter FROM zoom_registrations WHERE email = ?`,
    )
    .get(email);

  const masked = email.replace(
    /^(.)(.*)(@.*)$/,
    (_, a, b, c) => a + b.replace(/./g, "*") + c,
  );

  return {
    emailMasked: masked,
    source: source === "zoom" ? "zoom" : "newsletter",
    newsletter: Boolean(signer?.newsletter),
    hasZoom: Boolean(zoom),
    canDeleteSigner: Boolean(signer?.verified),
    hasSigner: Boolean(signer),
    // Current editable values for the self-service settings form.
    name: signer?.name ?? "",
    kreisverband: signer?.kreisverband ?? "",
    occupation: signer?.occupation ?? "",
    showPublicly: Boolean(signer?.show_publicly ?? true),
    zoomName: zoom?.name ?? "",
    zoomKv: zoom?.kreisverband ?? "",
    delegierter: Boolean(zoom?.delegierter ?? false),
  };
}

// Update an existing signer's editable fields. The unsubscribe token (already
// resolved to this email) is the authorization — no `verified` guard, since
// editing a confirmed signature is the whole point. Resetting `state` to ''
// when the Kreisverband changes lets the state backfill re-resolve it.
export async function updateSignerByEmail(
  email,
  { name, kreisverband, occupation, newsletter, showPublicly },
) {
  const row = await db
    .query(
      `UPDATE signers SET
        name = ?,
        kreisverband = ?,
        occupation = ?,
        newsletter = ?,
        show_publicly = ?,
        state = CASE WHEN kreisverband IS NOT ? THEN '' ELSE state END
      WHERE email = ?
      RETURNING id`,
    )
    .get(
      name,
      kreisverband,
      occupation,
      B(newsletter),
      B(showPublicly),
      kreisverband,
      email,
    );
  return Boolean(row);
}

export async function updateZoomByEmail(
  email,
  { name, kreisverband, delegierter },
) {
  const row = await db
    .query(
      `UPDATE zoom_registrations SET
        name = ?,
        kreisverband = ?,
        delegierter = ?
      WHERE email = ?
      RETURNING id`,
    )
    .get(name, kreisverband, B(delegierter), email);
  return Boolean(row);
}

export async function optOutNewsletterByEmail(email) {
  const row = await db
    .query(`UPDATE signers SET newsletter = 0 WHERE email = ? RETURNING id`)
    .get(email);
  return Boolean(row);
}

export async function deleteZoomByEmail(email) {
  const row = await db
    .query(`DELETE FROM zoom_registrations WHERE email = ? RETURNING id`)
    .get(email);
  return Boolean(row);
}

// ---- occupations -----------------------------------------------------------

export function normalizeOccupation(occ) {
  let s = occ.trim();
  s = s.replace(/\*innen$|\*in$|:innen$|:in$|\/innen$|\/in$/i, "");
  s = s.replace(/innen$|in$/i, (m, offset, str) => {
    const before = str.slice(0, offset);
    if (before.length >= 2) return "";
    return m;
  });
  s = s.replace(/er$|e$/i, (m, offset) => {
    if (offset >= 3) return "";
    return m;
  });
  return s.toLowerCase();
}

function addGendersternchen(label) {
  if (/[*:/]in(nen)?$/i.test(label)) return label;
  const femMatch = label.match(/^(.+?)(innen|in)$/i);
  if (femMatch && femMatch[1].length >= 2) {
    return `${femMatch[1]}*${femMatch[2].toLowerCase()}`;
  }
  const adjErMatch = label.match(/^(.+[dt])er$/i);
  if (adjErMatch && adjErMatch[1].length >= 3) {
    return `${adjErMatch[1]}e*r`;
  }
  const adjEMatch = label.match(/^(.+[dt])e$/i);
  if (adjEMatch && adjEMatch[1].length >= 3) {
    return `${label}*r`;
  }
  if (label.length >= 4 && /[^aeioüö]e$/i.test(label)) {
    return `${label.slice(0, -1)}*in`;
  }
  return `${label}*in`;
}

export async function getOccupations() {
  const rows = await db
    .query(
      `SELECT occupation, COUNT(*) AS count FROM signers
       WHERE verified = 1 AND occupation != '' AND show_publicly = 1
       GROUP BY occupation ORDER BY count DESC, occupation ASC`,
    )
    .all();
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

export async function getDistinctOccupations() {
  return await db
    .query(
      `SELECT occupation, COUNT(*) AS count FROM signers
       WHERE verified = 1 AND occupation != ''
       GROUP BY occupation ORDER BY count DESC, occupation ASC`,
    )
    .all();
}

export async function mergeOccupation(fromOcc, toOcc) {
  const rows = await db
    .query(
      `UPDATE signers SET occupation = ? WHERE occupation = ? RETURNING id`,
    )
    .all(toOcc, fromOcc);
  return rows.length;
}

export async function insertOccNotTypo(canonical, outlier) {
  await db
    .query(
      `INSERT INTO occupation_not_typo (canonical, outlier) VALUES (?, ?)
     ON CONFLICT DO NOTHING`,
    )
    .run(canonical, outlier);
}

export async function loadOccNotTypo() {
  return await db
    .query(`SELECT canonical, outlier FROM occupation_not_typo`)
    .all();
}

// ---- kreisverband / state --------------------------------------------------

export async function getKreisverbandStats() {
  return await db
    .query(
      `SELECT
        CASE WHEN kreisverband = '' THEN 'Ohne Kreisverband' ELSE kreisverband END AS kreisverband,
        COALESCE(NULLIF(state, ''), '') AS state,
        COUNT(*) AS count
      FROM signers
      WHERE verified = 1 AND show_publicly = 1
      GROUP BY 1, 2
      ORDER BY count DESC, kreisverband ASC`,
    )
    .all();
}

export async function getDistinctKreisverbands() {
  return await db
    .query(
      `SELECT kreisverband, COUNT(*) AS count FROM signers
       WHERE verified = 1 AND kreisverband != ''
       GROUP BY kreisverband ORDER BY count DESC, kreisverband ASC`,
    )
    .all();
}

export async function mergeKreisverband(fromKv, toKv) {
  const rows = await db
    .query(
      `UPDATE signers SET kreisverband = ?, state = '' WHERE kreisverband = ? RETURNING id`,
    )
    .all(toKv, fromKv);
  return rows.length;
}

export async function updateSignerState(id, state) {
  await db.query(`UPDATE signers SET state = ? WHERE id = ?`).run(state, id);
}

export async function getSignersNeedingState(limit = null) {
  if (limit) {
    return await db
      .query(
        `SELECT s.id, s.kreisverband FROM signers s
         WHERE s.verified = 1 AND s.kreisverband != '' AND s.state = ''
         ORDER BY s.created_at DESC LIMIT ?`,
      )
      .all(limit);
  }
  return await db
    .query(
      `SELECT s.id, s.kreisverband FROM signers s
       WHERE s.verified = 1 AND s.kreisverband != '' AND s.state = ''
       ORDER BY s.created_at DESC`,
    )
    .all();
}

export async function getUnresolvedKvs() {
  return await db
    .query(
      `SELECT kreisverband, COUNT(*) AS count FROM signers
       WHERE verified = 1 AND kreisverband != '' AND state = ''
       GROUP BY kreisverband ORDER BY count DESC, kreisverband ASC`,
    )
    .all();
}

export async function getStateStats() {
  return await db
    .query(
      `SELECT
        CASE WHEN state = '' THEN 'Unbekannt' ELSE state END AS state,
        COUNT(*) AS count
      FROM signers
      WHERE verified = 1 AND show_publicly = 1
      GROUP BY 1 ORDER BY count DESC, state ASC`,
    )
    .all();
}

export async function ensureKvStateCacheTable() {
  await db.run(
    `CREATE TABLE IF NOT EXISTS kv_state_cache (
      kreisverband  TEXT PRIMARY KEY,
      state         TEXT NOT NULL DEFAULT '',
      source        TEXT NOT NULL DEFAULT 'nominatim',
      resolved_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS kv_not_typo (
      canonical     TEXT NOT NULL,
      outlier       TEXT NOT NULL,
      created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (canonical, outlier)
    )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS occupation_not_typo (
      canonical     TEXT NOT NULL,
      outlier       TEXT NOT NULL,
      created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (canonical, outlier)
    )`,
  );
}

export async function insertKvNotTypo(canonical, outlier) {
  await db
    .query(
      `INSERT INTO kv_not_typo (canonical, outlier) VALUES (?, ?)
     ON CONFLICT DO NOTHING`,
    )
    .run(canonical, outlier);
}

export async function loadKvNotTypo() {
  return await db.query(`SELECT canonical, outlier FROM kv_not_typo`).all();
}

export async function upsertKvStateCache(
  kreisverband,
  state,
  source = "nominatim",
) {
  await db
    .query(
      `INSERT INTO kv_state_cache (kreisverband, state, source, resolved_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (kreisverband) DO UPDATE
       SET state = excluded.state, source = excluded.source, resolved_at = ?`,
    )
    .run(kreisverband, state, source, nowIso(), nowIso());
}

export async function clearEmptyKvCacheEntries() {
  const rows = await db
    .query(`DELETE FROM kv_state_cache WHERE state = '' RETURNING kreisverband`)
    .all();
  return rows.length;
}

export async function loadKvStateCache() {
  return await db
    .query(`SELECT kreisverband, state FROM kv_state_cache WHERE state != ''`)
    .all();
}

export async function bulkUpdateSignerStateByKv(kreisverband, state) {
  const rows = await db
    .query(
      `UPDATE signers SET state = ? WHERE kreisverband = ? AND state = '' RETURNING id`,
    )
    .all(state, kreisverband);
  return rows.length;
}

export async function getStateResolutionStats() {
  return await db
    .query(
      `SELECT
        COUNT(DISTINCT s.kreisverband) FILTER (WHERE s.state != '') AS "resolvedKvs",
        COUNT(DISTINCT s.kreisverband) FILTER (WHERE s.state = '') AS "unresolvedKvs",
        COUNT(*) FILTER (WHERE s.state = '') AS "unresolvedSigners",
        COUNT(*) FILTER (WHERE s.state != '') AS "resolvedSigners"
      FROM signers s
      WHERE s.verified = 1 AND s.kreisverband != ''`,
    )
    .get();
}

// ---- health / lifecycle ----------------------------------------------------

export async function healthCheck() {
  try {
    await db.query("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

export async function close() {
  await db.close();
}
