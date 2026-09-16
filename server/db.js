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
import { db, nowIso, isoAgo, onMutation } from "../db/connection.js";
import { cached, invalidate } from "./cache.js";
import { deleteJobsByPayload } from "../db/jobs.js";
import {
  recordErasure,
  forgetErasure,
  purgeErasureLog,
  ERASE,
  NEWSLETTER_OPT_OUT,
  TREFFEN_OPT_OUT,
  HIDE_PUBLICLY,
} from "../db/erasure-log.js";
import cfg from "../config/letter.config.js";
import { resolvePrivacy } from "../config/privacy.js";

const DAY = 24 * 60 * 60 * 1000;

// How many signers the typo-tolerant search fallback will score in JS. Only
// reached when nothing contains the search term at all.
const FUZZY_SCAN_LIMIT = Number(process.env.FUZZY_SCAN_LIMIT || 20000);

// Public reads are cached and de-duplicated while in flight (server/cache.js).
// Any write drops the cache, so a confirmation or deletion is visible to the
// very next read — except writes tagged `/* public-neutral */`, which cannot
// change a public response and therefore must not throw the cache away.
//
// The tagged ones matter: a sign-up writes an *unverified* row plus a couple of
// token columns, and every public read counts only `verified = 1`. Before this,
// a burst of sign-ups invalidated everything several times a second and each
// poll re-ran every aggregate — the load test collapsed at 200 open tabs on a
// workload that now handles thousands.
onMutation(invalidate);

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

// A multi-word query ("anna schmitt") can never be close to any single name
// word, so when the whole query doesn't match, each word is matched on its own
// and all of them have to hit; the score is their average.
function fuzzyMatch(name, kv, q) {
  const whole = fuzzyMatchTerm(name, kv, q);
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  if (whole.match || terms.length < 2) return whole;
  let total = 0;
  for (const term of terms) {
    const r = fuzzyMatchTerm(name, kv, term);
    if (!r.match) return whole;
    total += r.score;
  }
  return { match: true, score: total / terms.length };
}

// Mirrors the old SQL fuzzy clause + match_score:
//   match  -> substring OR per-word name Levenshtein OR whole-KV Levenshtein
//   score  -> best similarity ratio in [0,1] used for ranking
function fuzzyMatchTerm(name, kv, q) {
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

// GLOB pattern matching `term` anywhere, case-insensitively for any letter
// with a one-character upper/lower pair (ASCII and umlauts alike). GLOB's own
// metacharacters are wrapped in a class so they match literally.
function caselessGlob(term) {
  let out = "*";
  for (const ch of term) {
    if (ch === "]") {
      out += "[]]";
      continue;
    }
    const variants = [...new Set([ch, ch.toLowerCase(), ch.toUpperCase()])].filter(
      (c) => [...c].length === 1,
    );
    out += variants.length > 1 || "*?[".includes(ch) ? `[${variants.join("")}]` : ch;
  }
  return `${out}*`;
}

// ---- public signers list ---------------------------------------------------

export async function getSigners(opts) {
  const { filter = "alle", search = "", limit = 18, offset = 0, sort = "desc" } = opts;
  return cached(
    `signers:${filter}:${search.trim().toLowerCase()}:${limit}:${offset}:${sort}`,
    () => querySigners({ filter, search, limit, offset, sort }),
  );
}

async function querySigners({ filter, search, limit, offset, sort }) {
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

  // Substring hits — the overwhelmingly common case — are found in SQL, which
  // scans in C and returns only what it matched. The old code pulled every
  // verified signer into JS and scored each one: at 100k signers that was ~100k
  // objects and a Levenshtein pass per search, which measured at seconds per
  // request and several hundred MB of RSS.
  //
  // SQLite's lower()/LIKE only fold ASCII, so lower('Özdemir') stays 'Özdemir'
  // and would never match the JS-lowercased 'özdemir'. A term with any
  // non-ASCII character is matched with GLOB instead, spelling every letter as
  // a [lower/upper] class (`*[öÖ][zZ]…*`): still exact and case-insensitive,
  // and still counted and paged in SQL, so a one-letter "ö" typed into the
  // search box can't pull the whole table into JS.
  const nonAscii = /[^\x00-\x7f]/.test(searchClean);
  const pattern = nonAscii
    ? caselessGlob(searchClean)
    : `%${searchClean.replace(/[\\%_]/g, "\\$&")}%`;
  const substrWhere = nonAscii
    ? `${whereSql} AND (s.name GLOB ? OR s.kreisverband GLOB ?)`
    : `${whereSql} AND (lower(s.name) LIKE ? ESCAPE '\\' OR lower(s.kreisverband) LIKE ? ESCAPE '\\')`;

  const { total: substrTotal } = await db
    .query(`SELECT COUNT(*) AS total FROM signers s WHERE ${substrWhere}`)
    .get(...params, pattern, pattern);

  if (substrTotal > 0) {
    const signers = await db
      .query(
        `SELECT s.name, s.kreisverband, s.state, s.created_at
         FROM signers s WHERE ${substrWhere}
         ORDER BY s.created_at ${sortDir} LIMIT ? OFFSET ?`,
      )
      .all(...params, pattern, pattern, limit, offset);
    return { signers, total: substrTotal };
  }

  // Nothing contains the term, so it is probably misspelled: fall back to fuzzy
  // scoring, which is the only way "Schmidt" can be found by typing "Schmitt".
  // Bounded to the most recent FUZZY_SCAN_LIMIT signers so a stream of junk
  // queries can't pin the CPU on a table of any size.
  const rows = await db
    .query(
      `SELECT s.name, s.kreisverband, s.state, s.created_at
       FROM signers s WHERE ${whereSql}
       ORDER BY s.created_at DESC LIMIT ?`,
    )
    .all(...params, FUZZY_SCAN_LIMIT);

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
  return cached("stats", queryStats);
}

async function queryStats() {
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
  // Rendered into every transactional email, so it runs on each sign-up too.
  return cached("newsletter-stats", queryNewsletterStats);
}

async function queryNewsletterStats() {
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
  // A pending (unconfirmed) sign-up is only replaced once its link expired.
  // Before that, a second request for the same address — which proves nothing
  // about who sent it — must not change the name, public display or newsletter
  // choice the real person is about to confirm; the caller re-sends the
  // original confirmation instead.
  const row = await db
    .query(
      `INSERT INTO signers /* public-neutral */
         (name, email, kreisverband, occupation, newsletter, show_publicly, verification_token, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET name = excluded.name,
             kreisverband = excluded.kreisverband,
             occupation = excluded.occupation,
             newsletter = excluded.newsletter,
             show_publicly = excluded.show_publicly,
             verification_token = excluded.verification_token,
             token_expires_at = excluded.token_expires_at,
             created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE signers.verified = 0 AND signers.token_expires_at <= ?
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
      nowIso(),
    );
  if (row) return { ok: true, alreadyVerified: false };
  const existing = await db
    .query(`SELECT verified FROM signers WHERE email = ?`)
    .get(email);
  if (existing?.verified) return { ok: false, alreadyVerified: true };
  // The original confirmation is mailed again and says it is valid for the full
  // period, so the kept link gets that period from now. The entered values stay.
  await db
    .query(
      `UPDATE signers /* public-neutral */ SET token_expires_at = ?
       WHERE email = ? AND verified = 0`,
    )
    .run(iso(expiresAt), email);
  return { ok: true, alreadyVerified: false, pendingKept: true };
}

// What an unconfirmed sign-up will publish, shown on the confirmation page
// before the button is pressed.
export async function getPendingSignerByToken(token) {
  return boolify(
    (await db
      .query(
        `SELECT name, kreisverband, occupation, newsletter, show_publicly
         FROM signers
         WHERE verification_token = ? AND verified = 0 AND token_expires_at > ?`,
      )
      .get(token, nowIso())) || null,
    ["newsletter", "show_publicly"],
  );
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
      `UPDATE signers /* public-neutral */ SET verification_token = ?, token_expires_at = ?
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

// Start a deletion for an address we hold data for — a signature, a Treffen
// registration, or both. Returns the request id, or null when the address is
// unknown (the caller answers the same either way).
export async function createDeletionRequest(email, token, expiresAt) {
  const known = await db
    .query(
      `SELECT 1 FROM signers WHERE email = ?
       UNION ALL SELECT 1 FROM zoom_registrations WHERE email = ? LIMIT 1`,
    )
    .get(email, email);
  if (!known) return null;
  const row = await db
    .query(
      `INSERT INTO deletion_requests /* public-neutral */ (email, token, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET token = excluded.token, expires_at = excluded.expires_at
       RETURNING id`,
    )
    .get(email, token, iso(expiresAt));
  return row.id;
}

export async function getDeletionRequestForMail(id) {
  return (
    (await db
      .query(
        `SELECT id, email, token, expires_at FROM deletion_requests WHERE id = ?`,
      )
      .get(id)) || null
  );
}

// Erase everything stored for an address: signature, Treffen registration,
// pending deletion request and any queued mail about them.
export async function eraseEmail(email) {
  const signer = await db
    .query(`DELETE FROM signers WHERE email = ? RETURNING id`)
    .get(email);
  const zoom = await db
    .query(`DELETE FROM zoom_registrations WHERE email = ? RETURNING id`)
    .get(email);
  const request = await db
    .query(
      `DELETE FROM deletion_requests /* public-neutral */ WHERE email = ? RETURNING id`,
    )
    .get(email);
  const pending = await db
    .query(`DELETE FROM zoom_pending /* public-neutral */ WHERE email = ? RETURNING id`)
    .get(email);
  await db
    .query(`DELETE FROM mailing_deliveries /* public-neutral */ WHERE email = ?`)
    .run(email);
  if (pending) await deleteJobsByPayload("emails", "pendingId", pending.id);
  if (signer) await deleteEmailJobsForSigner(signer.id);
  if (request) await deleteJobsByPayload("emails", "requestId", request.id);
  if (signer || zoom) await recordErasure(db, email, ERASE);
  return Boolean(signer || zoom);
}

export async function deleteByDeletionToken(token) {
  const req = await db
    .query(
      `SELECT email FROM deletion_requests WHERE token = ? AND expires_at > ?`,
    )
    .get(token, nowIso());
  if (!req) return false;
  await eraseEmail(req.email);
  return true;
}

export async function deleteExpiredDeletionRequests() {
  const res = await db
    .query(
      `DELETE FROM deletion_requests /* public-neutral */ WHERE expires_at < ?`,
    )
    .run(nowIso());
  return res?.changes ?? 0;
}

export async function getSignerIdByEmail(email) {
  const row = await db.query(`SELECT id FROM signers WHERE email = ?`).get(email);
  return row ? row.id : null;
}

// Everything a queued transactional mail needs, read when it is sent — so the
// job payload holds only the signer id, and a mail for a row that has since
// been deleted is simply not sent.
export async function getSignerForMail(id) {
  return (
    (await db
      .query(
        `SELECT id, name, email, verified, verification_token, token_expires_at
         FROM signers WHERE id = ?`,
      )
      .get(id)) || null
  );
}

export async function deleteEmailJobsForSigner(id) {
  return deleteJobsByPayload("emails", "signerId", id);
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
             delegierter = excluded.delegierter,
             -- Every caller proved the address; a renewed registration counts
             -- as made now, so a previous event's purge leaves it alone.
             created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       RETURNING id`,
    )
    .get(name, email, kv || "", B(delegierter));
  // Registering again reverses an earlier Treffen opt-out.
  await forgetErasure(db, email, TREFFEN_OPT_OUT);
  return { ok: true, id: row.id };
}

export async function getZoomRegistrationCount() {
  return cached("zoom-count", () =>
    db.query(`SELECT COUNT(*) AS count FROM zoom_registrations`).get(),
  );
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

// One stable token per registration: reused on every mail so the links in older
// mails keep working. Only created when the row has none yet.
export async function issueZoomUnsubscribeToken(id) {
  const row = await db
    .query(
      `UPDATE zoom_registrations /* public-neutral */
       SET unsubscribe_token = COALESCE(unsubscribe_token, ?)
       WHERE id = ? RETURNING unsubscribe_token`,
    )
    .get(crypto.randomUUID(), id);
  return row?.unsubscribe_token || null;
}

export async function deleteZoomRegistrationByUnsubscribeToken(token) {
  const row = await db
    .query(
      `DELETE FROM zoom_registrations WHERE unsubscribe_token = ? RETURNING email`,
    )
    .get(token);
  if (row) await recordErasure(db, row.email, TREFFEN_OPT_OUT);
  return Boolean(row);
}

// ---- Treffen sign-up with double opt-in ------------------------------------

// Record a sign-up from the public form. Nothing is written to
// zoom_registrations until the address confirms, so an unauthenticated request
// can neither register someone else nor change an existing registration.
// Returns { status: "registered" } when the address is already registered,
// otherwise { status: "pending", id } — an unexpired pending sign-up is kept as
// it was (its link is simply mailed again), an expired one is replaced.
export async function insertZoomPending(args, attempt = 0) {
  const { name, email, kv, delegierter, token, expiresAt } = args;
  const registered = await getCurrentZoomRegistrationByEmail(email);
  if (registered) return { status: "registered", id: registered.id };
  const row = await db
    .query(
      `INSERT INTO zoom_pending /* public-neutral */
         (name, email, kreisverband, delegierter, token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET name = excluded.name,
             kreisverband = excluded.kreisverband,
             delegierter = excluded.delegierter,
             token = excluded.token,
             expires_at = excluded.expires_at,
             created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE zoom_pending.expires_at <= ?
       RETURNING id`,
    )
    .get(name, email, kv || "", B(delegierter), token, iso(expiresAt), nowIso());
  if (row) return { status: "pending", id: row.id };
  // An unexpired sign-up is kept; its link is mailed again with the full
  // validity from now, which the mail states.
  const existing = await db
    .query(
      `UPDATE zoom_pending /* public-neutral */ SET expires_at = ?
       WHERE email = ? RETURNING id`,
    )
    .get(iso(expiresAt), email);
  if (existing) return { status: "pending", id: existing.id };
  // Confirmed or purged by a concurrent request in between: start over once.
  if (attempt === 0) return insertZoomPending(args, 1);
  throw new Error("Treffen sign-up changed concurrently");
}

export async function getZoomPendingForMail(id) {
  return (
    boolify(
      (await db
        .query(
          `SELECT id, name, email, kreisverband, delegierter, token, expires_at
           FROM zoom_pending WHERE id = ?`,
        )
        .get(id)) || null,
      ["delegierter"],
    )
  );
}

export async function getZoomRegistrationForMail(id) {
  return (
    (await db
      .query(`SELECT id, name, email FROM zoom_registrations WHERE id = ?`)
      .get(id)) || null
  );
}

export async function getZoomPendingByToken(token) {
  return boolify(
    (await db
      .query(
        `SELECT id, name, email, kreisverband, delegierter FROM zoom_pending
         WHERE token = ? AND expires_at > ?`,
      )
      .get(token, nowIso())) || null,
    ["delegierter"],
  );
}

// The confirmation link was used: move the sign-up into zoom_registrations.
// Overwriting an existing registration is fine here — the request proved it
// controls the address. Returns the registration, or null for a bad link.
export async function confirmZoomPending(token) {
  // No transaction: the connection is shared with concurrent requests. The
  // DELETE … RETURNING claims the link atomically, so it works exactly once.
  const pending = await db
    .query(
      `DELETE FROM zoom_pending /* public-neutral */
       WHERE token = ? AND expires_at > ?
       RETURNING name, email, kreisverband, delegierter`,
    )
    .get(token, nowIso());
  if (!pending) return null;
  const reg = await insertZoomRegistration({
    name: pending.name,
    email: pending.email,
    kv: pending.kreisverband,
    delegierter: Boolean(pending.delegierter),
  });
  return {
    id: reg.id,
    name: pending.name,
    email: pending.email,
    delegierter: Boolean(pending.delegierter),
  };
}

export async function deleteExpiredZoomPending() {
  const res = await db
    .query(`DELETE FROM zoom_pending /* public-neutral */ WHERE expires_at < ?`)
    .run(nowIso());
  return res?.changes ?? 0;
}

// When the date of a Treffen that already happened is replaced, the
// registrations made until then belong to that event and must go at its
// deadline (`purgeAt`), not at the new event's. Each replacement records its own
// { purgeAt, createdBefore }, so changing the date again doesn't move an earlier
// event's deadline onto later registrations.
const PREVIOUS_PURGES_KEY = "treffen_previous_purges";

async function getPreviousTreffenPurges() {
  const row = await db
    .query(`SELECT value FROM app_settings WHERE key = ?`)
    .get(PREVIOUS_PURGES_KEY);
  return row ? JSON.parse(row.value) : [];
}

async function setPreviousTreffenPurges(list) {
  if (list.length === 0) {
    await db
      .query(`DELETE FROM app_settings /* public-neutral */ WHERE key = ?`)
      .run(PREVIOUS_PURGES_KEY);
    return;
  }
  await db
    .query(
      `INSERT INTO app_settings /* public-neutral */ (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(PREVIOUS_PURGES_KEY, JSON.stringify(list), nowIso());
}

export async function scheduleTreffenPurge(purgeAt) {
  const list = await getPreviousTreffenPurges();
  list.push({ purgeAt: purgeAt.toISOString(), createdBefore: nowIso() });
  await setPreviousTreffenPurges(list);
}

export async function purgePreviousTreffenRegistrations() {
  const list = await getPreviousTreffenPurges();
  const now = nowIso();
  const due = list.filter((m) => m.purgeAt <= now);
  if (due.length === 0) return 0;
  let removed = 0;
  for (const m of due) {
    const res = await db
      .query(`DELETE FROM zoom_registrations WHERE created_at < ?`)
      .run(m.createdBefore);
    removed += res?.changes ?? 0;
  }
  await setPreviousTreffenPurges(list.filter((m) => m.purgeAt > now));
  return removed;
}

// A registration made for an earlier Treffen whose date was replaced — it only
// waits for that event's deadline and does not count as registered for the
// current one, so the person can sign up again (which renews it).
async function isForPreviousTreffen(createdAt) {
  const list = await getPreviousTreffenPurges();
  return list.some((m) => createdAt < m.createdBefore);
}

// The registration for the current Treffen, or null.
export async function getCurrentZoomRegistrationByEmail(email) {
  const row = await db
    .query(
      `SELECT id, delegierter, unsubscribe_token, created_at FROM zoom_registrations
       WHERE email = ?`,
    )
    .get(email);
  if (!row || (await isForPreviousTreffen(row.created_at))) return null;
  return boolify(row, ["delegierter"]);
}

// Treffen registrations are only kept for the event itself: once
// `purgeAt` has passed, all of them are deleted. Checks first so the every-minute
// worker doesn't drop the public read cache when there is nothing to delete.
export async function purgeZoomRegistrationsAfter(purgeAt) {
  if (Date.now() < purgeAt.getTime()) return 0;
  const any = await db.query(`SELECT 1 FROM zoom_registrations LIMIT 1`).get();
  if (!any) return 0;
  const res = await db.query(`DELETE FROM zoom_registrations`).run();
  return res?.changes ?? 0;
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

// ---- mailing recovery ------------------------------------------------------
// A running send refreshes its heartbeat after every message or chunk. If the
// process dies mid-send the row stays 'sending'; once the heartbeat is older
// than MAILING_LEASE_MS it may be claimed again, and the delivery log
// (mailing_deliveries) makes the resumed send skip everyone already reached.
// Each claim counts as an attempt; a failure at MAX_MAILING_ATTEMPTS marks the
// mailing 'aborted' instead of 'failed', so a permanent error stops retrying.
export const MAILING_LEASE_MS = 10 * 60 * 1000;
export const MAX_MAILING_ATTEMPTS = 5;
// Wait after the Nth failed attempt before retrying, so a provider outage of a
// few minutes doesn't use up every attempt (~81 min from first failure to abort).
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

// SQL condition (plus its params) for "this mailing row may be claimed now":
// failed and past its backoff, or 'sending' with a stale heartbeat. `ts` is the
// row's heartbeat column. Rows from before the heartbeat existed (NULL) count
// as stale.
function retryableMailing(ts) {
  return {
    sql: `((status = 'failed' AND (${ts} IS NULL OR ${ts} < CASE attempts
             WHEN 0 THEN ? WHEN 1 THEN ? WHEN 2 THEN ? WHEN 3 THEN ? ELSE ? END))
          OR (status = 'sending' AND (${ts} IS NULL OR ${ts} < ?)))`,
    params: [
      nowIso(),
      ...RETRY_BACKOFF_MS.map((ms) => isoAgo(ms)),
      isoAgo(MAILING_LEASE_MS),
    ],
  };
}

export async function getDeliveredEmails(mailing) {
  const rows = await db
    .query(`SELECT email FROM mailing_deliveries WHERE mailing = ?`)
    .all(mailing);
  return new Set(rows.map((r) => r.email));
}

export async function markDelivered(mailing, emails) {
  if (!emails.length) return;
  const placeholders = emails.map(() => "(?, ?, ?)").join(", ");
  const now = nowIso();
  await db
    .query(
      `INSERT INTO mailing_deliveries /* public-neutral */ (mailing, email, sent_at)
       VALUES ${placeholders} ON CONFLICT (mailing, email) DO NOTHING`,
    )
    .run(...emails.flatMap((e) => [mailing, e, now]));
}

// The delivery log holds addresses, so rows go privacy.deliveryLogDays after
// sending (the privacy policy quotes it). Only a campaign still running or
// between retries keeps its rows — that state ends within hours (backoff, then
// 'aborted'). An aborted campaign doesn't hold them: its log ages out like any
// other, and retryAbortedCampaign refuses once that could have happened.
const DELIVERY_LOG_MS = resolvePrivacy(cfg).deliveryLogMs;

export async function deleteOldDeliveries() {
  const res = await db
    .query(
      `DELETE FROM mailing_deliveries /* public-neutral */
       WHERE sent_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM campaigns c
           WHERE 'campaign:' || c.id = mailing_deliveries.mailing
             AND c.status IN ('sending', 'failed'))`,
    )
    .run(isoAgo(DELIVERY_LOG_MS));
  return res?.changes ?? 0;
}

export async function countDelivered(mailing) {
  const row = await db
    .query(`SELECT COUNT(*) AS n FROM mailing_deliveries WHERE mailing = ?`)
    .get(mailing);
  return row?.n ?? 0;
}

// Race-safe claim: true when newly inserted, previously failed, or 'sending'
// with a stale heartbeat.
export async function claimZoomMailing(kind) {
  const now = nowIso();
  const inserted = await db
    .query(
      `INSERT INTO zoom_event_mailings (kind, status, attempts, updated_at)
       VALUES (?, 'sending', 1, ?)
       ON CONFLICT (kind) DO NOTHING
       RETURNING kind`,
    )
    .get(kind, now);
  if (inserted) return true;
  const retry = retryableMailing("updated_at");
  const row = await db
    .query(
      `UPDATE zoom_event_mailings
       SET status = 'sending', attempts = attempts + 1, updated_at = ?
       WHERE kind = ? AND ${retry.sql}
       RETURNING kind`,
    )
    .get(now, kind, ...retry.params);
  return Boolean(row);
}

export async function touchZoomMailing(kind) {
  await db
    .query(
      `UPDATE zoom_event_mailings /* public-neutral */ SET updated_at = ? WHERE kind = ?`,
    )
    .run(nowIso(), kind);
}

export async function markZoomMailing(kind, status, count = null) {
  const setSent = status === "sent" ? "sent_at = ?, " : "";
  const params = [status, MAX_MAILING_ATTEMPTS, status, count];
  if (status === "sent") params.push(nowIso());
  params.push(nowIso(), kind);
  await db
    .query(
      `UPDATE zoom_event_mailings
     SET status = CASE WHEN ? = 'failed' AND attempts >= ? THEN 'aborted' ELSE ? END,
         recipient_count = ?, ${setSent}updated_at = ?
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
  await db
    .query(
      `DELETE FROM mailing_deliveries WHERE mailing IN ('zoom-link', 'zoom-reminder')`,
    )
    .run();
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
  return cached("zoom-settings", async () => {
    const rows = await db
      .query(`SELECT key, value FROM app_settings WHERE key LIKE 'zoom_%'`)
      .all();
    const out = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  });
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
  return cached("milestones", queryMilestones);
}

async function queryMilestones() {
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

// ---- delegate field toggle (admin-editable) --------------------------------
// Whether the "Ich bin Delegierte*r" field is shown. Stored as app_settings
// zoom_show_delegierter ("1"/"0"); seeded from the active letter config. The
// server resolves the same key in getZoomConfig() (server/index.js); this helper
// exists so db.js code (self-service state) can read it without importing that.
export async function getShowDelegierter() {
  return cached("show-delegierter", async () => {
    const row = await db
      .query(`SELECT value FROM app_settings WHERE key = 'zoom_show_delegierter'`)
      .get();
    if (row?.value != null) return row.value === "1";
    return Boolean(cfg.zoom?.form?.showDelegierter);
  });
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
              c.sent_at, c.status, c.recipient_count, c.sent_offset, c.attempts, c.audience,
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

// Claimable: scheduled, failed past its backoff, or 'sending' whose heartbeat
// went stale. Shared by the claim and the reconciler.
function claimableCampaign() {
  const retry = retryableMailing("heartbeat_at");
  return { sql: `(status = 'scheduled' OR ${retry.sql})`, params: retry.params };
}

// Claim a single campaign for sending (used by the Honker job handler).
// Returns the row (recipient_ids parsed) or null if it isn't due/claimable.
export async function claimCampaignById(id) {
  const claimable = claimableCampaign();
  const row = await db
    .query(
      `UPDATE campaigns SET status = 'sending', attempts = attempts + 1, heartbeat_at = ?
       WHERE id = ? AND ${claimable.sql}
       RETURNING id, template_id, subject, scheduled_at, audience, sent_offset, recipient_ids, attempts`,
    )
    .get(nowIso(), id, ...claimable.params);
  if (!row) return null;
  row.recipient_ids = parseIds(row.recipient_ids);
  return row;
}

// Ids of campaigns whose send time has arrived (for the reconciler).
export async function getDueCampaignIds() {
  const claimable = claimableCampaign();
  const rows = await db
    .query(
      `SELECT id FROM campaigns WHERE scheduled_at <= ? AND ${claimable.sql}`,
    )
    .all(nowIso(), ...claimable.params);
  return rows.map((r) => r.id);
}

// Progress + heartbeat of a running send. sent_offset is the number of
// recipients reached so far (from the delivery log), not a list position.
export async function setCampaignProgress(id, deliveredCount) {
  await db
    .query(
      `UPDATE campaigns /* public-neutral */
       SET sent_offset = ?, recipient_count = ?, heartbeat_at = ? WHERE id = ?`,
    )
    .run(deliveredCount, deliveredCount, nowIso(), id);
}

export async function markCampaignSent(id, recipientCount) {
  await db
    .query(
      `UPDATE campaigns SET status = 'sent', sent_at = ?, recipient_count = ?, sent_offset = ? WHERE id = ?`,
    )
    .run(nowIso(), recipientCount, recipientCount, id);
}

export async function markCampaignFailed(id) {
  await db
    .query(
      `UPDATE campaigns
       SET status = CASE WHEN attempts >= ? THEN 'aborted' ELSE 'failed' END,
           heartbeat_at = ?
       WHERE id = ?`,
    )
    .run(MAX_MAILING_ATTEMPTS, nowIso(), id);
}

// Admin: give an aborted campaign a fresh set of attempts. Already-reached
// recipients are in the delivery log and are not mailed again — which only
// holds while that log is complete, so the retry is refused once the campaign's
// oldest delivery could have aged out (see deleteOldDeliveries).
export async function retryAbortedCampaign(id) {
  const row = await db
    .query(
      `UPDATE campaigns SET status = 'failed', attempts = 0
       WHERE id = ? AND status = 'aborted'
         AND NOT EXISTS (
           SELECT 1 FROM mailing_deliveries d
           WHERE d.mailing = 'campaign:' || campaigns.id AND d.sent_at < ?)
       RETURNING id`,
    )
    .get(id, isoAgo(DELIVERY_LOG_MS));
  return Boolean(row);
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

// Each signer has one stable unsubscribe token, reused in every mail, so a
// newsletter's one-click unsubscribe keeps working after the next newsletter
// (RFC 8058, Art. 7(3) / 21(3) DS-GVO). It is created only when missing and
// never rotated by a request. `unsubscribe_token_created_at` records when the
// token was last put into a mail to the address: opting out works with any
// token forever, but reading/editing/deleting data needs a token that was
// mailed within TOKEN_EDIT_WINDOW. Every mail carrying the token goes only to
// the address itself, so stamping it never hands access to anyone else.
const TOKEN_EDIT_WINDOW = resolvePrivacy(cfg).settingsLinkMs;

export async function issueUnsubscribeToken(id) {
  const row = await db
    .query(
      `UPDATE signers /* public-neutral */
       SET unsubscribe_token = COALESCE(unsubscribe_token, ?), unsubscribe_token_created_at = ?
       WHERE id = ? RETURNING unsubscribe_token`,
    )
    .get(crypto.randomUUID(), nowIso(), id);
  return row?.unsubscribe_token || null;
}

export async function issueUnsubscribeTokenByEmail(email) {
  const row = await db
    .query(
      `UPDATE signers /* public-neutral */
       SET unsubscribe_token = COALESCE(unsubscribe_token, ?), unsubscribe_token_created_at = ?
       WHERE email = ? RETURNING unsubscribe_token`,
    )
    .get(crypto.randomUUID(), nowIso(), email);
  return row?.unsubscribe_token || null;
}

export async function getUnsubscribeState(token) {
  const row = await db
    .query(
      `SELECT id, email, newsletter, verified FROM signers
       WHERE unsubscribe_token = ? AND unsubscribe_token_created_at > ?`,
    )
    .get(token, isoAgo(TOKEN_EDIT_WINDOW));
  return boolify(row || null, ["newsletter", "verified"]);
}

// One-click opt-out: no age limit, and the token stays valid so the settings
// link in the same mail keeps working afterwards.
export async function optOutNewsletter(token) {
  const row = await db
    .query(
      `UPDATE signers SET newsletter = 0
       WHERE unsubscribe_token = ? RETURNING email`,
    )
    .get(token);
  if (row) await recordErasure(db, row.email, NEWSLETTER_OPT_OUT);
  return Boolean(row);
}

// "Unterschrift vollständig löschen" on the settings page: erases the signature
// and everything else stored for that address, incl. a Treffen registration.
// Accepts a signer or a Treffen token, like the rest of the settings page.
export async function deleteSignerByUnsubscribeToken(token, source) {
  const email = await resolveEmailFromToken(token, source);
  if (!email) return false;
  await eraseEmail(email);
  return true;
}

// DSGVO data minimisation: drop sign-ups that were never email-confirmed once
// their verification token has expired (token TTL is 24h). Confirmed rows
// (verified = 1, token cleared) are never touched. Returns the number deleted.
export async function deleteExpiredUnverifiedSigners() {
  const res = await db
    .query(
      // Only ever removes unverified rows, which no public read counts — so it
      // must not drop the read cache every five minutes.
      `DELETE FROM signers /* public-neutral */ WHERE verified = 0 AND token_expires_at < ?`,
    )
    .run(nowIso());
  return res?.changes ?? 0;
}

// Upper bound on how long anything is kept (privacy.signerRetentionYears after
// signing / registering), independent of the campaign ending. Checks first so
// the daily run doesn't drop the public read cache when nothing is due.
// Returns the number of signatures and Treffen registrations deleted.
export async function deleteExpiredByAge(cutoff) {
  const at = iso(cutoff);
  const due = await db
    .query(
      `SELECT 1 FROM signers WHERE created_at < ?
       UNION ALL SELECT 1 FROM zoom_registrations WHERE created_at < ? LIMIT 1`,
    )
    .get(at, at);
  if (!due) return 0;
  const signers = await db
    .query(`DELETE FROM signers WHERE created_at < ?`)
    .run(at);
  const zoom = await db
    .query(`DELETE FROM zoom_registrations WHERE created_at < ?`)
    .run(at);
  return (signers?.changes ?? 0) + (zoom?.changes ?? 0);
}

// Resolve email from either a signer or zoom unsubscribe token. Signer tokens
// only count within TOKEN_EDIT_WINDOW unless `optOut` is set — opting out must
// work with a link from any mail, however old. Treffen tokens have no window;
// their rows are purged shortly after the event.
export async function resolveEmailFromToken(token, source, { optOut = false } = {}) {
  const access = await resolveTokenAccess(token, source);
  if (!access) return null;
  return access.editable || optOut ? access.email : null;
}

async function resolveTokenAccess(token, source) {
  if (!token) return null;
  const zoomLookup = async () => {
    const zoom = await db
      .query(`SELECT email FROM zoom_registrations WHERE unsubscribe_token = ?`)
      .get(token);
    return zoom ? { email: zoom.email, editable: true } : null;
  };
  if (source === "zoom") {
    const zoom = await zoomLookup();
    if (zoom) return zoom;
  }
  const signer = await db
    .query(
      `SELECT email, unsubscribe_token_created_at > ? AS fresh FROM signers
       WHERE unsubscribe_token = ?`,
    )
    .get(isoAgo(TOKEN_EDIT_WINDOW), token);
  if (signer) return { email: signer.email, editable: Boolean(signer.fresh) };
  if (source !== "zoom") return await zoomLookup();
  return null;
}

export async function getUnifiedUnsubscribeState(token, source) {
  const access = await resolveTokenAccess(token, source);
  if (!access) return null;
  const { email, editable } = access;

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

  const base = {
    emailMasked: masked,
    source: source === "zoom" ? "zoom" : "newsletter",
    newsletter: Boolean(signer?.newsletter),
    hasZoom: Boolean(zoom),
    editable,
  };
  // An old link still lets you opt out, but no longer shows or changes data.
  if (!editable) {
    return { ...base, canDeleteSigner: false, hasSigner: false };
  }

  return {
    ...base,
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
    // Whether the delegate field is currently enabled (admin toggle) — the
    // self-service page hides the checkbox when off.
    showDelegierter: await getShowDelegierter(),
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
  if (row) {
    if (newsletter) await forgetErasure(db, email, NEWSLETTER_OPT_OUT);
    else await recordErasure(db, email, NEWSLETTER_OPT_OUT);
    // Taking the name off the public list must survive a restore as well.
    if (showPublicly) await forgetErasure(db, email, HIDE_PUBLICLY);
    else await recordErasure(db, email, HIDE_PUBLICLY);
  }
  return Boolean(row);
}

// Used after a self-service edit to re-queue state resolution when the
// Kreisverband change reset `state`.
export async function getSignerStateByEmail(email) {
  return db
    .query(`SELECT id, kreisverband, state FROM signers WHERE email = ?`)
    .get(email);
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
  if (row) await recordErasure(db, email, NEWSLETTER_OPT_OUT);
  return Boolean(row);
}

export async function deleteZoomByEmail(email) {
  const row = await db
    .query(`DELETE FROM zoom_registrations WHERE email = ? RETURNING id`)
    .get(email);
  if (row) await recordErasure(db, email, TREFFEN_OPT_OUT);
  return Boolean(row);
}

// Erasure-log entries older than `before` (see db/erasure-log.js).
export async function purgeOldErasureLog(before) {
  return purgeErasureLog(db, before);
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
  return cached("occupations", queryOccupations);
}

async function queryOccupations() {
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
  return cached("kv-stats", queryKreisverbandStats);
}

async function queryKreisverbandStats() {
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
  return cached("state-stats", queryStateStats);
}

async function queryStateStats() {
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
