//
// Migrated from postgres.js. Key translation rules applied throughout:
//   * Timestamps are ISO-8601 UTC TEXT. Bind Dates via `iso()`, compare against
//     JS-computed cutoffs (`isoAgo`) instead of `NOW() - INTERVAL '…'`.
//   * Booleans are stored as 0/1; response-facing rows are coerced back to JS
//     booleans via `boolify`.
//   * `campaigns.recipient_ids` is a JSON-array TEXT column (Postgres INTEGER[]).
import {
  db,
  nowIso,
  isoAgo,
  onMutation,
  openEncrypted,
  DB_PATH,
  inDatabaseTransaction,
} from "../db/connection.js";
import { createHash } from "node:crypto";
import {
  createMeetingRepository,
  MAILING_LEASE_MS,
  MAX_MAILING_ATTEMPTS,
  meetingMailing,
} from "./meeting-repository.js";
import { cached, invalidate } from "./cache.js";
import { parseCopyKey } from "../config/editable.js";
import { isCampaignTemplate } from "../config/campaign-templates.js";
import { deleteJobsByPayload, deleteJobsWithPayload } from "../db/jobs.js";
import {
  emailHmac,
  recordErasure,
  forgetErasure,
  purgeErasureLog,
  ERASE,
  NEWSLETTER_OPT_OUT,
  TREFFEN_OPT_OUT,
  HIDE_PUBLICLY,
  HIDE_SIGNER_DETAILS,
  HIDE_INVITE_NAME,
  BLOCK_SIGNING,
  UNBLOCK_SIGNING,
  CLEAR_OCCUPATION,
  CLEAR_SIGNER_FUNCTION,
} from "../db/erasure-log.js";
import {
  recordAdminAction as recordAction,
  listAdminActions as listActions,
  purgeAdminActions,
  forgetDeletedSigners,
  lastAdminActionAt as lastActionAt,
} from "../db/admin-actions.js";
import { eraseSubject, erasureTables } from "../db/erasure.js";
import {
  canonicalMailbox,
  erasureSubject,
  mailboxDomains,
} from "../db/email-identity.js";
import cfg from "../config/letter.config.js";
import { normalizeLang } from "../config/i18n.js";
import { resolvePrivacy } from "../config/privacy.js";
import { SELECTION_LIMIT } from "../config/selection.js";

export { MAILING_LEASE_MS, MAX_MAILING_ATTEMPTS };
export const meetingRepository = createMeetingRepository(db);

const DAY = 24 * 60 * 60 * 1000;

// How many signers the typo-tolerant search fallback will score in JS. Only
// reached when nothing contains the search term at all.
const FUZZY_SCAN_LIMIT = Number(process.env.FUZZY_SCAN_LIMIT || 20000);

// Public reads are cached and de-duplicated while in flight (server/cache.js).
// Any write drops the cache, so a confirmation or deletion is visible to the
// very next read, except writes tagged `/* public-neutral */`, which cannot
// change a public response and therefore must not throw the cache away.
//
// The tagged ones matter: a sign-up writes an *unverified* row plus a couple of
// token columns, and every public read counts only `verified = 1`. Before this,
// a burst of sign-ups invalidated everything several times a second and each
// poll re-ran every aggregate; the load test collapsed at 200 open tabs on a
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

// Full Levenshtein edit distance (strings here are short: names / KV labels).
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
    const variants = [
      ...new Set([ch, ch.toLowerCase(), ch.toUpperCase()]),
    ].filter((c) => [...c].length === 1);
    out +=
      variants.length > 1 || "*?[".includes(ch) ? `[${variants.join("")}]` : ch;
  }
  return `${out}*`;
}

// ---- public signers list ---------------------------------------------------

export async function getSigners(opts) {
  const {
    filter = "alle",
    search = "",
    limit = 18,
    offset = 0,
    sort = "desc",
  } = opts;
  return cached(
    `signers:${filter}:${search.trim().toLowerCase()}:${limit}:${offset}:${sort}`,
    () => querySigners({ filter, search, limit, offset, sort }),
  );
}

// Function and organisation are public only with the signer's own recorded
// choice (show_signer_details = 1). Being a first signer, by mark or by
// position, decides nothing about the details; a letter with only
// publicFirstSignerDetails shows them for its marked first signers alone.
function publicSignerDetailsCondition() {
  if (cfg.features.publicSignerDetails) return "(s.show_signer_details = 1)";
  if (cfg.features.publicFirstSignerDetails)
    return "(s.show_signer_details = 1 AND s.first_signer = 1)";
  return "(0)";
}

// The region next to a public name, and the state resolved from it. Where
// the form offers "only my name" or "my name with my details"
// (publicSignerDetails), the region is one of the details. Every other letter
// shows it with the name, as its one checkbox says.
function publicRegionColumns() {
  if (!cfg.features.publicSignerDetails)
    return { region: "s.kreisverband", state: "s.state" };
  const shown = "s.show_signer_details = 1";
  return {
    region: `CASE WHEN ${shown} THEN s.kreisverband ELSE '' END`,
    state: `CASE WHEN ${shown} THEN s.state ELSE '' END`,
  };
}

// Whom a public count of roles, organisations, regions or states covers.
// Where the form offers "only my name", a count of 1 names the one signer
// who has that value, so only signers who chose their details are counted.
// Every other letter counts everyone with a public name, as its one checkbox
// and its policy say.
function publicDetailCountCondition() {
  return cfg.features.publicSignerDetails ? "show_signer_details = 1" : "1";
}

// Whose own choice the condition above reads, and who is therefore asked on
// their settings page: everyone on a letter with publicSignerDetails, marked
// first signers on one with only publicFirstSignerDetails. Nobody else's
// stored choice is shown or changed there.
function choosesPublicSignerDetails(signer) {
  return Boolean(
    cfg.features.publicSignerDetails ||
    (cfg.features.publicFirstSignerDetails && signer?.first_signer === 1),
  );
}

async function querySigners({ filter, search, limit, offset, sort }) {
  limit = Math.min(Math.max(1, limit), 100);
  offset = Math.max(0, offset);

  const searchClean = search.trim().toLowerCase();
  const sortDir = sort === "asc" ? "ASC" : "DESC";

  const publicRegion = publicRegionColumns();
  const conds = ["s.verified = 1", "s.show_publicly = 1"];
  const params = [];
  if (filter === "heute") {
    conds.push("s.created_at > ?");
    params.push(isoAgo(DAY));
  } else if (filter === "kv") {
    conds.push(`${publicRegion.region} != ''`);
  }
  const whereSql = conds.join(" AND ");

  const detailsAllowed = publicSignerDetailsCondition();
  const details =
    cfg.features.publicFirstSignerDetails || cfg.features.publicSignerDetails
      ? `, CASE WHEN ${detailsAllowed} THEN s.signer_function END AS signerFunction,
         CASE WHEN ${detailsAllowed} THEN s.occupation END AS organisation`
      : "";
  const signerColumns = `s.name, ${publicRegion.region} AS kreisverband,
    ${publicRegion.state} AS state, s.created_at,
    s.first_signer = 1 AS firstSigner${details}`;

  if (!searchClean) {
    const { total } = await db
      .query(`SELECT COUNT(*) AS total FROM signers s WHERE ${whereSql}`)
      .get(...params);
    // The default view (everyone, oldest first) opens with the first
    // signers: those with a position in its order, then the other marked
    // ones oldest first, then everyone else. Every other view keeps its own
    // order and only labels them.
    const firstSignersFirst =
      filter === "alle" &&
      sortDir === "ASC" &&
      (await db
        .query(
          `SELECT 1 FROM first_signer_pins
           UNION ALL SELECT 1 FROM signers WHERE first_signer = 1 LIMIT 1`,
        )
        .get());
    const from = firstSignersFirst
      ? "signers s LEFT JOIN first_signer_pins p ON p.signer_id = s.id"
      : "signers s";
    const order = firstSignersFirst
      ? "p.position IS NULL, p.position, s.first_signer = 0, s.created_at ASC, s.id ASC"
      : `s.created_at ${sortDir}`;
    const signers = await db
      .query(
        `SELECT ${signerColumns}
         FROM ${from} WHERE ${whereSql}
         ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return { signers: boolifyAll(signers, ["firstSigner"]), total };
  }

  // Substring hits (the overwhelmingly common case) are found in SQL, which
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
    ? `${whereSql} AND (s.name GLOB ? OR ${publicRegion.region} GLOB ?)`
    : `${whereSql} AND (lower(s.name) LIKE ? ESCAPE '\\' OR lower(${publicRegion.region}) LIKE ? ESCAPE '\\')`;

  const { total: substrTotal } = await db
    .query(`SELECT COUNT(*) AS total FROM signers s WHERE ${substrWhere}`)
    .get(...params, pattern, pattern);

  if (substrTotal > 0) {
    const signers = await db
      .query(
        `SELECT ${signerColumns}
         FROM signers s WHERE ${substrWhere}
         ORDER BY s.created_at ${sortDir} LIMIT ? OFFSET ?`,
      )
      .all(...params, pattern, pattern, limit, offset);
    return {
      signers: boolifyAll(signers, ["firstSigner"]),
      total: substrTotal,
    };
  }

  // Nothing contains the term, so it is probably misspelled: fall back to fuzzy
  // scoring, which is the only way "Schmidt" can be found by typing "Schmitt".
  // Bounded to the most recent FUZZY_SCAN_LIMIT signers so a stream of junk
  // queries can't pin the CPU on a table of any size.
  const rows = await db
    .query(
      `SELECT ${signerColumns}
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
  return { signers: boolifyAll(signers, ["firstSigner"]), total };
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

export async function selectedNewsletterSigners(
  ids,
  filters = {},
  { limit = 25, offset = 0 } = {},
) {
  const selected = new Set(ids);
  const matching = await listNewsletterSignerIds({
    ...filters,
    cap: Number.MAX_SAFE_INTEGER,
  });
  const matchingCount = matching.ids.filter((id) => selected.has(id)).length;
  const { whereSql, params } = newsletterBase({});
  if (!ids.length)
    return {
      signers: [],
      total: 0,
      byLanguage: {},
      outsideFilter: 0,
      unavailable: 0,
    };
  const condition = `${whereSql} AND s.id IN (${ids.map(() => "?").join(",")})`;
  const byLanguage = await getCampaignLanguageCounts("selection", ids);
  const total = Object.values(byLanguage).reduce(
    (sum, count) => sum + count,
    0,
  );
  const signers = await db
    .query(
      `SELECT s.id, s.name, s.email FROM signers s WHERE ${condition} ORDER BY s.name, s.id LIMIT ? OFFSET ?`,
    )
    .all(
      ...params,
      ...ids,
      Math.min(100, Math.max(1, limit)),
      Math.max(0, offset),
    );
  return {
    signers,
    total,
    byLanguage,
    outsideFilter: Math.max(0, total - matchingCount),
    unavailable: ids.length - total,
  };
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
    "s.id, s.name, s.email, s.kreisverband, s.occupation, s.signer_function AS signerFunction, s.state, s.created_at";

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

// ---- admin list of every confirmed signature -------------------------------

// SQL for "one of `columns` contains `term`", ignoring case. A term with a
// non-ASCII letter needs GLOB (see querySigners).
function containsTerm(columns, term) {
  const nonAscii = /[^\x00-\x7f]/.test(term);
  const pattern = nonAscii
    ? caselessGlob(term)
    : `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const sql = columns
    .map((column) =>
      nonAscii ? `${column} GLOB ?` : `lower(${column}) LIKE ? ESCAPE '\\'`,
    )
    .join(" OR ");
  return { sql: `(${sql})`, params: columns.map(() => pattern) };
}

const ADMIN_SIGNER_COLUMNS = `s.id, s.name, s.email, s.kreisverband, s.occupation,
  s.signer_function AS signerFunction, s.lang, s.newsletter,
  s.show_publicly AS showPublicly,
  COALESCE(s.show_signer_details, 0) AS showSignerDetails,
  s.created_at AS createdAt, p.position AS position,
  s.first_signer AS firstSigner, s.email IS NULL AS handAdded`;
const ADMIN_SIGNER_FROM =
  "signers s LEFT JOIN first_signer_pins p ON p.signer_id = s.id";
const ADMIN_SIGNER_FLAGS = [
  "newsletter",
  "showPublicly",
  "showSignerDetails",
  "firstSigner",
  "handAdded",
];

// Names as a person would compare them: case, spacing and Unicode spelling
// aside.
const personName = (name) =>
  String(name)
    .normalize("NFKC")
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ")
    .trim();

// Confirmed signatures, with an address (`handAdded` false) or added by hand
// (true), whose name is one of `names` as personName compares them, oldest
// first. Entries added by hand are few and read whole. Signatures with an
// address are found in one scan: each name becomes a GLOB looser than the
// comparison (any case, any spacing), and the comparison then decides.
async function signersNamed(names, handAdded) {
  if (!names.length) return [];
  const wanted = new Set(names.map(personName));
  const patterns = handAdded
    ? []
    : [...new Set(names.map((name) => name.trim()))].map((name) =>
        name
          .split(/\s+/)
          .map((word) => caselessGlob(word).slice(1, -1))
          .join("*"),
      );
  const rows = await db
    .query(
      `SELECT ${ADMIN_SIGNER_COLUMNS} FROM ${ADMIN_SIGNER_FROM}
       WHERE s.verified = 1 AND s.email IS ${handAdded ? "NULL" : "NOT NULL"}
         ${patterns.length ? `AND (${patterns.map(() => "s.name GLOB ?").join(" OR ")})` : ""}
       ORDER BY s.created_at, s.id`,
    )
    .all(...patterns);
  return rows.filter((row) => wanted.has(personName(row.name)));
}

// The other side of a possible duplicate: for an entry added by hand, the
// signatures with an address and the same name; for such a signature, the
// entries added by hand with its name.
export async function possibleDuplicatesOf(signer) {
  return boolifyAll(
    (await signersNamed([signer.name], !signer.handAdded)).slice(0, 20),
    ADMIN_SIGNER_FLAGS,
  );
}

// Marks the admin rows that are a possible duplicate (see above).
async function withDuplicateHints(rows) {
  if (!rows.length) return rows;
  const named = new Set();
  for (const handAdded of [true, false]) {
    const names = rows
      .filter((row) => row.handAdded !== handAdded)
      .map((row) => row.name);
    for (const other of await signersNamed(names, handAdded))
      named.add(`${!handAdded}:${personName(other.name)}`);
  }
  for (const row of rows)
    row.possibleDuplicate = named.has(
      `${row.handAdded}:${personName(row.name)}`,
    );
  return rows;
}

function adminRows(rows) {
  return withDuplicateHints(boolifyAll(rows, ADMIN_SIGNER_FLAGS));
}

// The admin rows for `ids`, in that order.
export async function adminSignersByIds(ids) {
  if (!ids.length) return [];
  const rows = await db
    .query(
      `SELECT ${ADMIN_SIGNER_COLUMNS} FROM ${ADMIN_SIGNER_FROM}
       WHERE s.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return adminRows(ids.map((id) => byId.get(id)).filter(Boolean));
}

// `visibility`: "public" or "hidden" narrows to signatures shown or not shown
// on the public list. A search finds every word of it in the name, the address
// or the region. Only when nothing contains it are the newest
// FUZZY_SCAN_LIMIT signatures scored for a near miss ("Schmitt" for
// "Schmidt"), best match first; the result then says `fuzzy`.
//
// A search is one pass in signing order that returns the matching ids; their
// number is the total, and only the rows of the page shown are read in full.
// Counting with a separate COUNT(*) made SQLite walk the name index and fetch
// every row out of order: ~200 ms at 25k signatures against ~25 ms for the
// pass.
export async function listSigners({
  search = "",
  limit = 50,
  offset = 0,
  dateFrom = null,
  dateTo = null,
  visibility = "",
}) {
  limit = Math.min(Math.max(1, limit), 100);
  offset = Math.max(0, offset);
  const searchClean = search.trim().toLowerCase();
  const conds = ["s.verified = 1"];
  const params = [];
  if (visibility === "public") conds.push("s.show_publicly = 1");
  else if (visibility === "hidden") conds.push("s.show_publicly = 0");
  if (dateFrom) {
    conds.push("s.created_at >= ?");
    params.push(iso(dateFrom));
  }
  if (dateTo) {
    conds.push("s.created_at <= ?");
    params.push(iso(dateTo));
  }
  const where = conds.join(" AND ");
  const newestFirst = "ORDER BY s.created_at DESC, s.id DESC";
  if (!searchClean) {
    const { total } = await db
      .query(`SELECT COUNT(*) AS total FROM signers s WHERE ${where}`)
      .get(...params);
    const signers = await db
      .query(
        `SELECT ${ADMIN_SIGNER_COLUMNS} FROM ${ADMIN_SIGNER_FROM}
         WHERE ${where} ${newestFirst} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return { signers: await adminRows(signers), total };
  }

  const terms = searchClean
    .split(/\s+/)
    .slice(0, 6)
    .map((word) => containsTerm(["s.name", "s.email", "s.kreisverband"], word));
  const found = await db
    .query(
      `SELECT s.id FROM signers s
       WHERE ${[where, ...terms.map((term) => term.sql)].join(" AND ")}
       ${newestFirst}`,
    )
    .all(...params, ...terms.flatMap((term) => term.params));
  if (found.length)
    return {
      signers: await adminSignersByIds(
        found.slice(offset, offset + limit).map((row) => row.id),
      ),
      total: found.length,
    };

  const recent = await db
    .query(
      `SELECT s.id, s.name, s.kreisverband FROM signers s
       WHERE ${where} ${newestFirst} LIMIT ?`,
    )
    .all(...params, FUZZY_SCAN_LIMIT);
  const scored = [];
  for (const [index, row] of recent.entries()) {
    const { match, score } = fuzzyMatch(
      row.name,
      row.kreisverband,
      searchClean,
    );
    if (match) scored.push({ id: row.id, score, index });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    signers: await adminSignersByIds(
      scored.slice(offset, offset + limit).map((hit) => hit.id),
    ),
    total: scored.length,
    fuzzy: scored.length > 0,
  };
}

// The newest `cap` matching ids, with `total` matches and whether the cap cut
// any off.
export async function listNewsletterSignerIds({
  search = "",
  state = "",
  kv = "",
  dateFrom = null,
  dateTo = null,
  cap = SELECTION_LIMIT,
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
  return {
    ids: rows.slice(0, cap).map((r) => r.id),
    total: rows.length,
    truncated: rows.length > cap,
  };
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

// An unconfirmed sign-up has two clocks. token_expires_at says until when the
// link in a confirmation mail that went out works, and is empty until the
// mail service has taken a mail with the current token. mail_wait_until says
// until when the sign-up waits for a mail that was asked for and has not gone
// out. Asking for the mail again moves only the second, so it cannot make a
// link that went out valid for longer.
//
// Until a mail went out, the link works while the sign-up waits for one.
const LINK_VALID_UNTIL = "COALESCE(token_expires_at, mail_wait_until)";
// The sign-up ends when both clocks have run out. NULL for a row with
// neither, which then compares as neither ended nor running.
const signupEndsAt = (table = "") =>
  `MAX(COALESCE(${table}token_expires_at, ${table}mail_wait_until),
       COALESCE(${table}mail_wait_until, ${table}token_expires_at))`;

// Start page of the admin: confirmed sign-ups since `since`, and unconfirmed
// ones that have not run out, with those running out before `soon`.
export async function getSignatureActivity(since, soon) {
  const now = nowIso();
  return await db
    .query(
      `SELECT
        COUNT(*) FILTER (WHERE verified AND created_at >= ?) AS "signedSince",
        COUNT(*) FILTER (WHERE NOT verified AND ${signupEndsAt()} > ?) AS "pending",
        COUNT(*) FILTER (
          WHERE NOT verified AND ${signupEndsAt()} > ? AND ${signupEndsAt()} <= ?
        ) AS "pendingExpiringSoon"
      FROM signers`,
    )
    .get(iso(since), now, now, iso(soon));
}

// ---- signers: insert / verify / delete -------------------------------------

export async function isSigningBlocked(email) {
  const row = await db
    .query(`SELECT 1 FROM erasure_log WHERE email_hmac = ? AND kind = ?`)
    .get(emailHmac(canonicalMailbox(email)), BLOCK_SIGNING);
  return Boolean(row);
}

// "Sperre aufheben" in the admin. Returns whether a block was lifted. The
// lifting is logged too: a backup taken while the address was blocked still
// holds the block, and a restore would bring it back without it.
export async function unblockSigning(email) {
  const mailbox = canonicalMailbox(email);
  return db.transaction(
    async () => {
      const res = await db
        .query(
          `DELETE FROM erasure_log /* public-neutral */ WHERE email_hmac = ? AND kind = ?`,
        )
        .run(emailHmac(mailbox), BLOCK_SIGNING);
      if (!res?.changes) return false;
      await recordErasure(db, mailbox, UNBLOCK_SIGNING);
      await recordAction(db, "signer.unblock", { count: 1 });
      return true;
    },
    { immediate: true },
  );
}

// "Gesperrte Adressen" in the admin: how many there are and when each was
// blocked. A block is a keyed hash, so there is no address to show.
export async function listSigningBlocks({ limit = 50, offset = 0 } = {}) {
  const { total } = await db
    .query(`SELECT COUNT(*) AS total FROM erasure_log WHERE kind = ?`)
    .get(BLOCK_SIGNING);
  const rows = await db
    .query(
      `SELECT at FROM erasure_log WHERE kind = ?
       ORDER BY at DESC LIMIT ? OFFSET ?`,
    )
    .all(BLOCK_SIGNING, Math.min(Math.max(1, limit), 100), Math.max(0, offset));
  return { total, blocks: rows.map((row) => row.at) };
}

export async function insertSigner({
  name,
  email,
  kv,
  occupation,
  signerFunction = "",
  newsletter,
  showPublicly,
  showSignerDetails = false,
  token,
  expiresAt,
  inviteRef = null,
  inviteShowName = false,
  lang = null,
}) {
  if (await isSigningBlocked(email))
    return { ok: false, alreadyVerified: false, blocked: true };
  // A pending (unconfirmed) sign-up is only replaced once it has run out.
  // Before that, a second request for the same address, which proves nothing
  // about who sent it, must not change the name, public display or newsletter
  // choice the real person is about to confirm; the caller re-sends the
  // original confirmation instead. `expiresAt` is until when the sign-up
  // waits for its confirmation mail.
  const row = await db
    .query(
      `INSERT INTO signers /* public-neutral */
         (name, email, kreisverband, occupation, signer_function, newsletter, show_publicly, show_signer_details, verification_token, mail_wait_until, pending_ref, invite_show_name, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET name = excluded.name,
             kreisverband = excluded.kreisverband,
             occupation = excluded.occupation,
             signer_function = excluded.signer_function,
             newsletter = excluded.newsletter,
             show_publicly = excluded.show_publicly,
             show_signer_details = excluded.show_signer_details,
             verification_token = excluded.verification_token,
             token_expires_at = NULL,
             mail_wait_until = excluded.mail_wait_until,
             pending_ref = excluded.pending_ref,
             invite_show_name = excluded.invite_show_name,
             lang = excluded.lang,
             created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE signers.verified = 0 AND ${signupEndsAt("signers.")} <= ?
       RETURNING id, verified`,
    )
    .get(
      name,
      email,
      kv,
      occupation || "",
      signerFunction,
      B(newsletter),
      B(showPublicly),
      B(showPublicly && showSignerDetails),
      token,
      iso(expiresAt),
      inviteRef,
      B(inviteShowName),
      lang,
      nowIso(),
    );
  if (row) return { ok: true, alreadyVerified: false };
  const existing = await db
    .query(`SELECT verified FROM signers WHERE email = ?`)
    .get(email);
  if (existing?.verified) return { ok: false, alreadyVerified: true };
  // The original confirmation is mailed again, so the kept sign-up waits for
  // that mail from now. The entered values stay, and so does the validity of
  // a link that already went out.
  await db
    .query(
      `UPDATE signers /* public-neutral */ SET mail_wait_until = ?
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
        `SELECT name, kreisverband, occupation, signer_function AS signerFunction, newsletter, show_publicly, show_signer_details, invite_show_name, lang
         FROM signers
         WHERE verification_token = ? AND verified = 0 AND ${LINK_VALID_UNTIL} > ?`,
      )
      .get(token, nowIso())) || null,
    ["newsletter", "show_publicly", "invite_show_name"],
  );
}

// A confirmation mail says how long its link is valid, so the link counts
// from when the mail service took the mail that carries it. Until then the
// sign-up only waits for that mail (see mailWaitExpiry in server/index.js),
// and with the mail out that wait is over. A mail that carries a token since
// replaced starts nothing.
//
// The same mail can be recorded twice, and an earlier mail after a later one,
// when a job is run again. So the link's time only ever moves forward:
// recording a mail again changes nothing.
export async function startConfirmationWindow(id, token, expiresAt) {
  const until = iso(expiresAt);
  await db
    .query(
      `UPDATE signers /* public-neutral */
       SET token_expires_at = ?, mail_wait_until = NULL
       WHERE id = ? AND verified = 0 AND verification_token = ?
         AND (token_expires_at IS NULL OR token_expires_at < ?)`,
    )
    .run(until, id, token, until);
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
      `UPDATE signers /* public-neutral */
       SET verification_token = ?, token_expires_at = NULL, mail_wait_until = ?
       WHERE email = ? AND verified = 0 RETURNING name`,
    )
    .get(token, iso(expiresAt), email);
  return row ? row.name : null;
}

// Crockford base32: no I, L, O or U, so a code read aloud or retyped survives.
const INVITE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const INVITE_CODE_LENGTH = 8;

// 8 characters = 40 random bits: enumerating codes to find signers' names
// takes ~10^12 tries, against the 4-character version's 1.7M.
export function generateInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
  return Array.from(bytes, (b) => INVITE_ALPHABET[b & 31]).join("");
}

export function isInviteCode(value) {
  return (
    typeof value === "string" &&
    value.length === INVITE_CODE_LENGTH &&
    [...value].every((c) => INVITE_ALPHABET.includes(c))
  );
}

// What the invite modal shows as the first name: the first word of the one
// name field. Shown to the signer on the confirm page before they agree, since
// "Berger, Anna" would otherwise put a surname on the link.
export function inviteDisplayName(name) {
  return String(name || "")
    .trim()
    .split(/\s/)[0];
}

export function hashStatsToken(token) {
  return new Bun.CryptoHasher("sha256").update(String(token)).digest("hex");
}

export async function confirmSigner(token) {
  // The row's inviter is read first, since SQLite's RETURNING only sees the new
  // values. The UPDATE is what claims the token, so only the request that
  const pending = await db
    .query(`SELECT pending_ref FROM signers WHERE verification_token = ?`)
    .get(token);
  const row = await db
    .query(
      `UPDATE signers
       SET verified = 1, verification_token = NULL, token_expires_at = NULL,
           mail_wait_until = NULL,
           invite_code = COALESCE(invite_code, ?), pending_ref = NULL
       WHERE verification_token = ? AND verified = 0 AND ${LINK_VALID_UNTIL} > ?
       RETURNING id, kreisverband, invite_code, lang`,
    )
    .get(
      cfg.features.inviteLinks ? generateInviteCode() : null,
      token,
      nowIso(),
    );
  if (!row) return null;
  const ref = pending?.pending_ref;
  if (ref && ref !== row.invite_code) {
    await db
      .query(
        `UPDATE signers /* public-neutral */ SET invite_count = invite_count + 1
         WHERE invite_code = ? AND verified = 1`,
      )
      .run(ref);
  }
  return {
    id: row.id,
    kreisverband: row.kreisverband,
    inviteCode: row.invite_code,
    lang: row.lang,
  };
}

// What an invite link shows: the inviter's first name when they opted in,
// otherwise nothing personal. null for unknown or unconfirmed codes.
export async function getInviteByCode(code) {
  if (!isInviteCode(code)) return null;
  const row = await db
    .query(
      `SELECT name, invite_show_name FROM signers
       WHERE invite_code = ? AND verified = 1`,
    )
    .get(code);
  if (!row) return null;
  return {
    firstName: row.invite_show_name ? inviteDisplayName(row.name) : null,
  };
}

export async function issueInviteStatsToken(
  id,
  token = crypto.randomUUID().replaceAll("-", ""),
) {
  const row = await db
    .query(
      `UPDATE signers /* public-neutral */ SET invite_stats_hash = ?
       WHERE id = ? AND verified = 1 AND invite_code IS NOT NULL
       RETURNING invite_code`,
    )
    .get(hashStatsToken(token), id);
  return row ? { token, inviteCode: row.invite_code } : null;
}

export async function getInviteStats(code, token) {
  if (!isInviteCode(code) || typeof token !== "string" || !token) return null;
  const row = await db
    .query(
      `SELECT invite_count FROM signers
       WHERE invite_code = ? AND invite_stats_hash = ? AND verified = 1`,
    )
    .get(code, hashStatsToken(token));
  return row ? { count: row.invite_count } : null;
}

// Start a deletion for an address we hold data for: a signature, a Treffen
// registration, or both. Returns the request id, or null when the address is
// unknown (the caller answers the same either way).
export async function createDeletionRequest(
  email,
  token,
  expiresAt,
  lang = null,
) {
  const known = await db
    .query(
      `SELECT 1 FROM signers WHERE email = ?
       UNION ALL SELECT 1 FROM zoom_registrations WHERE email = ?
       UNION ALL SELECT 1 FROM zoom_pending WHERE email = ?
       UNION ALL SELECT 1 FROM mailing_deliveries WHERE email = ? LIMIT 1`,
    )
    .get(email, email, email, email);
  if (!known) {
    const tables = await erasureTables(db);
    if (!tables.has("email_attempts")) return null;
    const columns = await db.query("PRAGMA table_info(email_attempts)").all();
    if (!columns.some((column) => column.name === "subject_hmac")) return null;
    const attempt = await db
      .query("SELECT 1 FROM email_attempts WHERE subject_hmac=? LIMIT 1")
      .get(emailHmac(email));
    if (!attempt) return null;
  }
  const row = await db
    .query(
      `INSERT INTO deletion_requests /* public-neutral */ (email, token, expires_at, lang)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET token = excluded.token, expires_at = excluded.expires_at,
             lang = excluded.lang
       RETURNING id`,
    )
    .get(email, token, iso(expiresAt), lang);
  return row.id;
}

export async function getDeletionRequestForMail(id) {
  return (
    (await db
      .query(
        `SELECT id, email, token, expires_at, lang, created_at FROM deletion_requests WHERE id = ?`,
      )
      .get(id)) || null
  );
}

// Erase everything stored for an address: signature, Treffen registration,
// pending deletion request and any queued mail about them.
async function eraseAuthorizedEmail(email) {
  const changes = await eraseSubject(db, { email });
  await recordErasure(db, email, ERASE);
  return changes > 0;
}

// Sign-ups, confirmed or not, that reach `mailbox` under any spelling (a plus
// tag, Gmail dots), newest first.
async function mailboxSignups(mailbox, columns) {
  const rows = [];
  for (const domain of mailboxDomains(mailbox)) {
    const suffix = `@${domain}`;
    rows.push(
      ...(await db
        .query(
          `SELECT ${columns} FROM ${ADMIN_SIGNER_FROM}
           WHERE substr(lower(trim(s.email)), ?) = ?`,
        )
        .all(-suffix.length, suffix)),
    );
  }
  return rows
    .filter((row) => canonicalMailbox(row.email) === mailbox)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// What is left of a mailbox once one of its sign-ups was removed. A block
// covers every spelling from then on, but those made before it are still
// there.
async function mailboxVariants(mailbox) {
  return boolifyAll(
    await mailboxSignups(
      mailbox,
      "s.id, s.name, s.email, s.verified, s.created_at AS createdAt",
    ),
    ["verified"],
  );
}

// An entry added by hand has no address to block; it is skipped.
async function removeAndBlock(id) {
  const row = await db
    .query(`SELECT email FROM signers WHERE id = ? AND email IS NOT NULL`)
    .get(id);
  if (!row) return null;
  const mailbox = canonicalMailbox(row.email);
  await eraseAuthorizedEmail(row.email);
  await recordErasure(db, mailbox, BLOCK_SIGNING);
  return mailbox;
}

// "Entfernen und sperren" in the admin: a fake signature goes away like a
// self-requested deletion, and its address may not sign again. Returns null
// for an unknown id, otherwise { variants }: the other sign-ups of the same
// mailbox, for the admin to remove as well.
export async function removeAndBlockSigner(id) {
  return db.transaction(
    async () => {
      const mailbox = await removeAndBlock(id);
      if (!mailbox) return null;
      await recordAction(db, "signer.remove-block", { targetId: id, count: 1 });
      return { variants: await mailboxVariants(mailbox) };
    },
    { immediate: true },
  );
}

// The same for a selection, all or nothing. Ids already gone are skipped.
export async function removeAndBlockSigners(ids) {
  return db.transaction(
    async () => {
      const mailboxes = new Set();
      let removed = 0;
      for (const id of ids) {
        const mailbox = await removeAndBlock(id);
        if (!mailbox) continue;
        removed++;
        mailboxes.add(mailbox);
      }
      if (removed)
        await recordAction(db, "signer.remove-block", { count: removed });
      const variants = [];
      for (const mailbox of mailboxes)
        variants.push(...(await mailboxVariants(mailbox)));
      return { removed, variants };
    },
    { immediate: true },
  );
}

// "Löschen ohne Sperre": everything stored for the address goes, as if the
// person had asked for it, and the address may sign again. An entry added by
// hand has nothing but its row; the log keeps it gone after a restore.
export async function eraseSigner(id) {
  return db.transaction(
    async () => {
      const row = await db
        .query(`SELECT id, email FROM signers WHERE id = ?`)
        .get(id);
      if (!row) return false;
      if (row.email) await eraseAuthorizedEmail(row.email);
      else await eraseHandEntry(row);
      await recordAction(db, "signer.erase", { targetId: id, count: 1 });
      return true;
    },
    { immediate: true },
  );
}

async function eraseHandEntry(row) {
  await db.query(`DELETE FROM signers WHERE id = ?`).run(row.id);
  await recordErasure(db, erasureSubject(row), ERASE);
  await forgetDeletedSigners(db);
}

// ---- admin: one signature ---------------------------------------------------

const consentMissing = () =>
  Object.assign(
    new Error(
      "Bestätige, dass die Zustimmung der Person vorliegt, bevor du etwas öffentlich schaltest.",
    ),
    { status: 400 },
  );

// The edit panel in the admin. `patch` holds the fields to change, already
// cleaned like a sign-up: name, kreisverband, occupation, signerFunction,
// lang, showPublicly, showSignerDetails, and newsletter (only `false`:
// subscribing takes the person's own confirmation, see the opt-in mail).
//
// Taking something off is immediate and survives a restore. Putting the name
// or the details on the public list for someone who had them off needs
// `consent`; when and how the person agreed is kept on the signature. Every
// change is logged with its old and new value.
//
// Returns null for an unknown or unconfirmed id, otherwise
// { signer, changes, regionChanged }.
export async function updateSignerByAdmin(
  id,
  patch,
  { consent = false, consentNote = "" } = {},
) {
  return db.transaction(
    async () => {
      const row = await db
        .query(
          `SELECT id, email, name, kreisverband, occupation, signer_function,
                  lang, show_publicly, show_signer_details, newsletter
           FROM signers WHERE id = ? AND verified = 1`,
        )
        .get(id);
      if (!row) return null;
      const before = {
        name: row.name,
        occupation: row.occupation || "",
        signerFunction: row.signer_function,
        kreisverband: row.kreisverband || "",
        lang: row.lang,
        showPublicly: Boolean(row.show_publicly),
        showSignerDetails: row.show_signer_details === 1,
        newsletter: Boolean(row.newsletter),
      };
      const after = { ...before };
      for (const key of Object.keys(before))
        if (patch[key] !== undefined) after[key] = patch[key];
      if (!after.showPublicly) after.showSignerDetails = false;
      after.newsletter = before.newsletter && patch.newsletter !== false;
      const changes = {};
      for (const key of Object.keys(before))
        if (after[key] !== before[key])
          changes[key] = [before[key], after[key]];
      if (!Object.keys(changes).length)
        return { signer: await adminSigner(id), changes, regionChanged: false };

      const madePublic =
        (changes.showPublicly && after.showPublicly) ||
        (changes.showSignerDetails && after.showSignerDetails);
      if (madePublic && !consent) throw consentMissing();

      const subject = erasureSubject(row);
      const consentAt = madePublic ? nowIso() : null;
      await db
        .query(
          `UPDATE signers SET name = ?, kreisverband = ?, occupation = ?,
             signer_function = ?, lang = ?, show_publicly = ?,
             show_signer_details = ?, newsletter = ?,
             state = CASE WHEN kreisverband IS NOT ? THEN '' ELSE state END,
             admin_consent_at = COALESCE(?, admin_consent_at),
             admin_consent_note = CASE WHEN ? IS NULL THEN admin_consent_note ELSE ? END
           WHERE id = ?`,
        )
        .run(
          after.name,
          after.kreisverband,
          after.occupation,
          after.signerFunction,
          after.lang,
          B(after.showPublicly),
          changes.showSignerDetails
            ? B(after.showSignerDetails)
            : row.show_signer_details,
          B(after.newsletter),
          after.kreisverband,
          consentAt,
          consentAt,
          consentNote,
          id,
        );
      if (changes.showPublicly) {
        if (after.showPublicly) await forgetErasure(db, subject, HIDE_PUBLICLY);
        else await recordErasure(db, subject, HIDE_PUBLICLY);
      }
      if (changes.showSignerDetails) {
        if (after.showSignerDetails)
          await forgetErasure(db, subject, HIDE_SIGNER_DETAILS);
        else await recordErasure(db, subject, HIDE_SIGNER_DETAILS);
      }
      if (changes.newsletter)
        await recordErasure(db, subject, NEWSLETTER_OPT_OUT);
      await rememberClearedDetails(subject, before, after);
      await recordAction(db, "signer.edit", {
        targetId: id,
        detail: { changes, ...(madePublic && { consentNote }) },
      });
      return {
        signer: await adminSigner(id),
        changes,
        regionChanged: Boolean(changes.kreisverband),
      };
    },
    { immediate: true },
  );
}

// An organisation or function someone had taken off must not come back with
// a restored backup; one they entered again must stay.
async function rememberClearedDetails(subject, before, after) {
  for (const [kind, field] of [
    [CLEAR_OCCUPATION, "occupation"],
    [CLEAR_SIGNER_FUNCTION, "signerFunction"],
  ]) {
    if (after[field] === undefined || after[field] === before[field]) continue;
    if (after[field]) await forgetErasure(db, subject, kind);
    else await recordErasure(db, subject, kind);
  }
}

async function adminSigner(id) {
  const row = await db
    .query(
      `SELECT ${ADMIN_SIGNER_COLUMNS}, s.admin_consent_at AS consentAt,
              s.admin_consent_note AS consentNote
       FROM ${ADMIN_SIGNER_FROM} WHERE s.id = ? AND s.verified = 1`,
    )
    .get(id);
  return row ? (await adminRows([row]))[0] : null;
}

// One confirmed signature as the edit panel shows it, with what the log holds
// about it.
export async function getSignerForAdmin(id) {
  const signer = await adminSigner(id);
  if (!signer) return null;
  const { actions } = await listActions(db, { signerId: id, limit: 20 });
  return { ...signer, history: actions };
}

// "Adresse nachschlagen" in the admin: everything stored for a mailbox, the
// unconfirmed sign-ups included, and why a mail may not have arrived.
export async function lookupSignups(email) {
  const signups = boolifyAll(
    await mailboxSignups(
      canonicalMailbox(email),
      `${ADMIN_SIGNER_COLUMNS}, s.verified,
       CASE WHEN s.verified = 0 THEN ${LINK_VALID_UNTIL} END AS confirmationExpiresAt`,
    ),
    [...ADMIN_SIGNER_FLAGS, "verified"],
  );
  const tables = await erasureTables(db);
  const addresses = [...new Set([email, ...signups.map((row) => row.email)])];
  const mail = tables.has("email_attempts")
    ? await db
        .query(
          `SELECT status, COALESCE(created_at, updated_at) AS at
           FROM email_attempts
           WHERE subject_hmac IN (${addresses.map(() => "?").join(",")})
           ORDER BY at DESC LIMIT 10`,
        )
        .all(...addresses.map((address) => emailHmac(address)))
    : [];
  const ids = new Set(signups.map((row) => row.id));
  let queued = 0;
  if (tables.has("_honker_live") && ids.size) {
    for (const job of await db
      .query(`SELECT payload FROM _honker_live WHERE queue = 'emails'`)
      .all()) {
      try {
        if (ids.has(JSON.parse(job.payload)?.signerId)) queued++;
      } catch {
        // not a mail of ours
      }
    }
  }
  const meeting = (await db
    .query(`SELECT 1 FROM zoom_registrations WHERE lower(trim(email)) = ?`)
    .get(email))
    ? "registered"
    : (await db
          .query(`SELECT 1 FROM zoom_pending WHERE lower(trim(email)) = ?`)
          .get(email))
      ? "pending"
      : null;
  return {
    blocked: await isSigningBlocked(email),
    signups,
    mail,
    queued,
    meeting,
  };
}

// ---- admin: exports and log ---------------------------------------------------

// What the public list shows about each signature, and nothing else: function
// and organisation only where the person agreed to them being public, and the
// region as the list shows it.
export async function exportPublicSigners() {
  const detailsAllowed = publicSignerDetailsCondition();
  const publicRegion = publicRegionColumns();
  const rows = await db
    .query(
      `SELECT s.name, ${publicRegion.region} AS kreisverband,
              ${publicRegion.state} AS state, s.created_at AS createdAt,
              CASE WHEN ${detailsAllowed} THEN s.signer_function ELSE '' END AS signerFunction,
              CASE WHEN ${detailsAllowed} THEN s.occupation ELSE '' END AS organisation
       FROM signers s WHERE s.verified = 1 AND s.show_publicly = 1
       ORDER BY s.created_at, s.id`,
    )
    .all();
  await recordAction(db, "export.signers", { count: rows.length });
  return rows;
}

export async function exportMeetingRegistrations() {
  const rows = boolifyAll(
    await db
      .query(
        `SELECT name, kreisverband, delegierter, created_at AS createdAt
         FROM zoom_registrations ORDER BY created_at, id`,
      )
      .all(),
    ["delegierter"],
  );
  await recordAction(db, "export.meeting-registrations", {
    count: rows.length,
  });
  return rows;
}

export function recordAdminAction(action, entry) {
  return recordAction(db, action, entry);
}

export function lastAdminActionAt(action, targetId) {
  return lastActionAt(db, action, targetId);
}

export function listAdminActions(page) {
  return listActions(db, page);
}

export function purgeOldAdminActions(before) {
  return purgeAdminActions(db, before);
}

export async function eraseEmail(email) {
  return db.transaction(() => eraseAuthorizedEmail(email), { immediate: true });
}

// The language of a deletion request (for its link page), or null.
export async function getDeletionRequestLang(token) {
  const row = await db
    .query(`SELECT lang FROM deletion_requests WHERE token = ?`)
    .get(token);
  return row?.lang ?? null;
}

export async function deleteByDeletionToken(token) {
  return db.transaction(
    async () => {
      const req = await db
        .query(
          `SELECT email FROM deletion_requests WHERE token=? AND expires_at>?`,
        )
        .get(token, nowIso());
      if (!req) return false;
      await eraseAuthorizedEmail(req.email);
      return true;
    },
    { immediate: true },
  );
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
  const row = await db
    .query(`SELECT id FROM signers WHERE email = ?`)
    .get(email);
  return row ? row.id : null;
}

export async function getSignerForMail(id) {
  return (
    (await db
      .query(
        `SELECT id, name, email, verified, newsletter, verification_token,
                ${signupEndsAt()} AS signup_ends_at, invite_code, lang, created_at
         FROM signers WHERE id = ? AND email IS NOT NULL`,
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
        `SELECT id, name, email, kreisverband, lang FROM signers
         WHERE unsubscribe_token = ? AND verified = 1`,
      )
      .get(token)) || null
  );
}

export async function insertZoomRegistration({
  name,
  email,
  kv,
  delegierter,
  lang = null,
}) {
  const current = await getCurrentZoomRegistrationByEmail(email);
  const row = await db
    .query(
      `INSERT INTO zoom_registrations (name, email, kreisverband, delegierter, lang)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET name = excluded.name,
             lang = excluded.lang,
             kreisverband = excluded.kreisverband,
             delegierter = excluded.delegierter,
             created_at = CASE WHEN ? THEN zoom_registrations.created_at
               ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END
       RETURNING id`,
    )
    .get(name, email, kv || "", B(delegierter), lang, B(Boolean(current)));
  // Registering again reverses an earlier Treffen opt-out.
  await forgetErasure(db, email, TREFFEN_OPT_OUT);
  return { ok: true, id: row.id };
}

export async function getZoomRegistrationCount() {
  return cached("zoom-count", () =>
    db.query(`SELECT COUNT(*) AS count FROM zoom_registrations`).get(),
  );
}

// `search` narrows the page to names and addresses containing it; `matches` is
// how many there are, `total` stays the number of all registrations.
export async function listZoomRegistrations({
  limit = 100,
  offset = 0,
  search = "",
} = {}) {
  const term = search.trim().toLowerCase();
  const filter = term
    ? containsTerm(["name", "email"], term)
    : { sql: "1", params: [] };
  const [{ zoomCount, zoomDelegateCount }, { matches }, registrations] =
    await Promise.all([
      getZoomCounts(),
      db
        .query(
          `SELECT COUNT(*) AS matches FROM zoom_registrations WHERE ${filter.sql}`,
        )
        .get(...filter.params),
      db
        .query(
          `SELECT id, name, email, kreisverband, delegierter, created_at
           FROM zoom_registrations WHERE ${filter.sql}
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(
          ...filter.params,
          Math.min(Math.max(1, limit), 200),
          Math.max(0, offset),
        ),
    ]);
  return {
    registrations: boolifyAll(registrations, ["delegierter"]),
    total: zoomCount,
    delegates: zoomDelegateCount,
    matches,
  };
}

// "Entfernen" on one row of the admin's meeting list: what the person's own
// "vom Treffen abmelden" link does, logged the same way so that restoring a
// backup does not bring the registration back. The signature is not touched.
export async function removeZoomRegistration(id) {
  return db.transaction(
    async () => {
      const row = await db
        .query(`DELETE FROM zoom_registrations WHERE id = ? RETURNING email`)
        .get(id);
      if (!row) return false;
      await recordErasure(db, row.email, TREFFEN_OPT_OUT);
      await deleteJobsByPayload("emails", "registrationId", id);
      return true;
    },
    { immediate: true },
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
        `SELECT id, name, email, unsubscribe_token, lang, created_at FROM zoom_registrations
         WHERE delegierter = 1 ORDER BY created_at ASC`,
      )
      .all();
  }
  return await db
    .query(
      `SELECT id, name, email, unsubscribe_token, lang, created_at FROM zoom_registrations
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
// otherwise { status: "pending", id }; an unexpired pending sign-up is kept as
// it was (its link is simply mailed again), an expired one is replaced.
export async function insertZoomPending(args, attempt = 0) {
  const { name, email, kv, delegierter, token, expiresAt, lang = null } = args;
  const registered = await getCurrentZoomRegistrationByEmail(email);
  if (registered) return { status: "registered", id: registered.id };
  const row = await db
    .query(
      `INSERT INTO zoom_pending /* public-neutral */
         (name, email, kreisverband, delegierter, token, expires_at, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
         SET name = excluded.name,
             lang = excluded.lang,
             kreisverband = excluded.kreisverband,
             delegierter = excluded.delegierter,
             token = excluded.token,
             expires_at = excluded.expires_at,
             created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE zoom_pending.expires_at <= ?
       RETURNING id`,
    )
    .get(
      name,
      email,
      kv || "",
      B(delegierter),
      token,
      iso(expiresAt),
      lang,
      nowIso(),
    );
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
  return boolify(
    (await db
      .query(
        `SELECT id, name, email, kreisverband, delegierter, token, expires_at, lang, created_at
           FROM zoom_pending WHERE id = ?`,
      )
      .get(id)) || null,
    ["delegierter"],
  );
}

export async function getZoomRegistrationForMail(id) {
  return (
    (await db
      .query(
        `SELECT id, name, email, lang, created_at FROM zoom_registrations WHERE id = ?`,
      )
      .get(id)) || null
  );
}

export async function getZoomPendingByToken(token) {
  return boolify(
    (await db
      .query(
        `SELECT id, name, email, kreisverband, delegierter, lang FROM zoom_pending
         WHERE token = ? AND expires_at > ?`,
      )
      .get(token, nowIso())) || null,
    ["delegierter"],
  );
}

// The confirmation link was used: move the sign-up into zoom_registrations.
// Overwriting an existing registration is fine here: the request proved it
// controls the address. Returns the registration, or null for a bad link.
export async function confirmZoomPending(token) {
  if (!inDatabaseTransaction())
    throw new Error("Confirm meeting registration inside durableWork.run");
  const pending = await db
    .query(
      `DELETE FROM zoom_pending /* public-neutral */
       WHERE token = ? AND expires_at > ?
       RETURNING name, email, kreisverband, delegierter, lang`,
    )
    .get(token, nowIso());
  if (!pending) return null;
  const reg = await insertZoomRegistration({
    name: pending.name,
    email: pending.email,
    kv: pending.kreisverband,
    delegierter: Boolean(pending.delegierter),
    lang: pending.lang,
  });
  return {
    id: reg.id,
    name: pending.name,
    email: pending.email,
    delegierter: Boolean(pending.delegierter),
    lang: pending.lang,
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

// A registration made for an earlier Treffen whose date was replaced; it only
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
// between retries keeps its rows; that state ends within hours (backoff, then
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

export async function claimZoomMailing(kind, generation) {
  return meetingRepository.claim(
    kind,
    generation ?? (await meetingRepository.generation()),
  );
}

export async function touchZoomMailing(kind, generation) {
  return meetingRepository.touch(
    kind,
    generation ?? (await meetingRepository.generation()),
  );
}

export async function markZoomMailing(
  kind,
  status,
  count = null,
  failure = null,
  generation,
) {
  return meetingRepository.mark(
    kind,
    generation ?? (await meetingRepository.generation()),
    status,
    count,
    failure,
  );
}

export async function listZoomMailings(generation) {
  return meetingRepository.list(generation);
}

async function advanceZoomGeneration() {
  const generation = await meetingRepository.generation();
  await db
    .query(
      `INSERT INTO app_settings (key,value,updated_at) VALUES ('zoom_generation',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    )
    .run(String(generation + 1), nowIso());
  for (const kind of ["link", "reminder", "confirmation"])
    await db
      .query("DELETE FROM mailing_deliveries WHERE mailing=?")
      .run(meetingMailing(kind, generation));
  return generation + 1;
}

export async function resetZoomMailings() {
  return db.transaction(
    async () => {
      const generation = await advanceZoomGeneration();
      const settings = await getZoomSettings();
      await saveZoomSetting(
        "zoom_revision",
        Number(settings.zoom_revision || 0) + 1,
      );
      return generation;
    },
    { immediate: true },
  );
}

// "Alle Zoom-Anmeldungen löschen": the confirmed registrations, and with them
// the sign-ups still waiting for their confirmation click, whose link would
// otherwise register that person again afterwards. Mail queued for either
// goes too. Returns the number of confirmed registrations removed.
export async function clearZoomRegistrations() {
  return db.transaction(
    async () => {
      const { count } = await db
        .query("SELECT COUNT(*) AS count FROM zoom_registrations")
        .get();
      await db.query("DELETE FROM zoom_registrations").run();
      await db.query("DELETE FROM zoom_pending /* public-neutral */").run();
      for (const subject of ["registrationId", "pendingId"])
        await deleteJobsWithPayload("emails", subject);
      await advanceZoomGeneration();
      const settings = await getZoomSettings();
      await saveZoomSetting(
        "zoom_revision",
        Number(settings.zoom_revision || 0) + 1,
      );
      return count;
    },
    { immediate: true },
  );
}

export async function getZoomSettings() {
  const rows = await db
    .query("SELECT key,value FROM app_settings WHERE key LIKE 'zoom_%'")
    .all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function saveZoomSetting(key, value) {
  await db
    .query(
      `INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    )
    .run(key, String(value), nowIso());
}

export async function setZoomSettings(
  partial,
  expectedRevision,
  { resetMailings = false } = {},
) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
    throw Object.assign(
      new Error("Die geladene Terminrevision fehlt. Bitte neu laden."),
      { status: 400 },
    );
  return db.transaction(
    async () => {
      const settings = await getZoomSettings();
      const current = Number(settings.zoom_revision || 0);
      if (current !== expectedRevision)
        throw Object.assign(
          new Error(
            "Der Termin wurde inzwischen geändert. Deine Eingaben bleiben erhalten. Vergleiche den aktuellen Stand.",
          ),
          { status: 409 },
        );
      const previousAt =
        settings.zoom_event_at ||
        process.env.ZOOM_EVENT_AT ||
        cfg.zoom?.eventAt ||
        "";
      const dateChanged =
        partial.zoom_event_at != null &&
        new Date(partial.zoom_event_at || 0).getTime() !==
          new Date(previousAt || 0).getTime();
      if (
        dateChanged &&
        previousAt &&
        new Date(previousAt).getTime() <= Date.now()
      )
        await scheduleTreffenPurge(
          new Date(
            new Date(previousAt).getTime() +
              resolvePrivacy(cfg).treffenRetentionMs,
          ),
        );
      if (dateChanged || resetMailings) await advanceZoomGeneration();
      for (const [key, value] of Object.entries(partial))
        if (
          key !== "zoom_revision" &&
          key !== "zoom_generation" &&
          value != null
        )
          await saveZoomSetting(key, value);
      await saveZoomSetting("zoom_revision", current + 1);
      return current + 1;
    },
    { immediate: true },
  );
}

// ---- editable texts & mode (admin "Texte & Modus", config/editable.js) -----
// One app_settings row per overridden config path: key `copy:<path>` for the
// default language, `copy:<lang>:<path>` for another (copyKey in
// config/editable.js), value JSON. Paths without a row use the deployed config.

// Overrides for one language (null or absent: the default).
export async function getCopyOverrides(lang = null) {
  const all = await cached("copy-overrides", async () => {
    const rows = await db
      .query(`SELECT key, value FROM app_settings WHERE key LIKE 'copy:%'`)
      .all();
    const out = {};
    for (const row of rows) {
      const key = parseCopyKey(row.key);
      if (!key) continue;
      try {
        (out[key.lang ?? ""] ??= {})[key.path] = JSON.parse(row.value);
      } catch {
        // A corrupt row falls back to the config value.
      }
    }
    return out;
  });
  return { ...(all[lang ?? ""] || {}) };
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
      .query(
        `SELECT value FROM app_settings WHERE key = 'zoom_show_delegierter'`,
      )
      .get();
    if (row?.value != null) return row.value === "1";
    return Boolean(cfg.zoom?.form?.showDelegierter);
  });
}

// ---- email templates -------------------------------------------------------

const SYSTEM_SLUGS_SQL =
  "slug IN ('verification', 'deletion', 'open-letter-update', 'invite')";

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

// ---- campaigns -------------------------------------------------------------

// Campaign texts in further languages (multiLanguage only), stored as JSON
// {"en": {"templateId": 7, "subject": "…"}}; a language without an entry gets
// the default text. Listed only with the flag on, so the admin API answers as
// before otherwise.
const CAMPAIGN_I18N = Boolean(cfg.features?.multiLanguage);

function parseCampaignI18n(value) {
  try {
    const parsed = JSON.parse(value || "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function listCampaigns() {
  const rows = await db
    .query(
      `SELECT c.id, c.template_id, t.name AS template_name, c.subject,${CAMPAIGN_I18N ? " c.i18n," : ""} c.scheduled_at,
              c.sent_at, c.status, c.recipient_count, c.sent_offset, c.audience_size, c.attempts, c.audience, c.failure,
              c.delivery_expires_at IS NOT NULL AS started,
              COALESCE(json_array_length(c.recipient_ids), 0) AS selection_count, c.created_at
       FROM campaigns c
       LEFT JOIN email_templates t ON t.id = c.template_id
       ORDER BY c.scheduled_at DESC, c.created_at DESC`,
    )
    .all();
  if (CAMPAIGN_I18N) {
    for (const row of rows) row.i18n = parseCampaignI18n(row.i18n);
  }
  for (const row of rows) {
    row.failure = parseCampaignI18n(row.failure);
    row.started = Boolean(row.started);
  }
  return rows;
}

export async function createCampaign({
  templateId,
  subject,
  scheduledAt,
  audience = "newsletter",
  recipientIds = null,
  i18n = null,
  requestKey = null,
  sendNow = false,
}) {
  for (const id of [
    templateId,
    ...Object.values(i18n || {})
      .map((entry) => entry.templateId)
      .filter(Boolean),
  ])
    if (!isCampaignTemplate(await getEmailTemplate(id))) return null;
  const ids =
    audience === "selection" && Array.isArray(recipientIds)
      ? JSON.stringify(recipientIds)
      : null;
  const requestHash = requestKey
    ? createHash("sha256")
        .update(
          JSON.stringify([
            templateId,
            subject,
            sendNow ? "immediate" : iso(scheduledAt),
            audience,
            recipientIds
              ? [...new Set(recipientIds)].sort((a, b) => a - b)
              : null,
            Object.entries(i18n || {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([lang, entry]) => [
                lang,
                entry.templateId || null,
                entry.subject || null,
              ]),
          ]),
        )
        .digest("hex")
    : null;
  const row = await db
    .query(
      `INSERT INTO campaigns (template_id, subject, scheduled_at, audience, recipient_ids, i18n, request_key, request_hash)
       SELECT id, ?, ?, ?, ?, ?, ?, ? FROM email_templates WHERE id = ?
       ON CONFLICT(request_key) WHERE request_key IS NOT NULL DO NOTHING
       RETURNING id, template_id, subject,${CAMPAIGN_I18N ? " i18n," : ""} scheduled_at, sent_at, status, recipient_count, audience, created_at`,
    )
    .get(
      subject,
      iso(scheduledAt),
      audience,
      ids,
      i18n && Object.keys(i18n).length ? JSON.stringify(i18n) : null,
      requestKey,
      requestHash,
      templateId,
    );
  if (!row && requestKey) {
    const previous = await db
      .query(
        "SELECT id, template_id, subject, i18n, scheduled_at, sent_at, status, recipient_count, audience, created_at, request_hash FROM campaigns WHERE request_key=?",
      )
      .get(requestKey);
    if (previous && previous.request_hash !== requestHash) {
      const error = new Error(
        `Aus diesem Entwurf ist bereits Kampagne #${previous.id} entstanden; sie bleibt, wie sie ist. Für eine weitere Nachricht setze den Entwurf zurück.`,
      );
      error.status = 409;
      throw error;
    }
    if (previous) {
      delete previous.request_hash;
      if (CAMPAIGN_I18N) previous.i18n = parseCampaignI18n(previous.i18n);
      else delete previous.i18n;
      return { ...previous, replayed: true };
    }
  }
  if (row && CAMPAIGN_I18N) row.i18n = parseCampaignI18n(row.i18n);
  return row || null;
}

// Campaigns that will still send with one of these templates without anyone
// pressing a button: scheduled, being sent, or waiting for their next attempt.
// An aborted one only resumes through its retry review, which names the
// template it is about to use.
export async function getPendingCampaignsUsing(templateIds, connection = db) {
  const ids = new Set(templateIds.map(Number));
  const rows = await connection
    .query(
      `SELECT id, template_id, subject, scheduled_at, status, i18n FROM campaigns
       WHERE status IN ('scheduled', 'sending', 'failed')
       ORDER BY scheduled_at, id`,
    )
    .all();
  return rows
    .filter(
      (row) =>
        ids.has(row.template_id) ||
        Object.values(parseCampaignI18n(row.i18n) || {}).some((entry) =>
          ids.has(Number(entry?.templateId)),
        ),
    )
    .map(({ id, subject, scheduled_at, status }) => ({
      id,
      subject,
      scheduled_at,
      status,
    }));
}

// Load a single campaign (for the job worker), with recipient_ids parsed.
export async function getCampaignById(id) {
  const row = await db
    .query(
      `SELECT id, template_id, subject,${CAMPAIGN_I18N ? " i18n," : ""} scheduled_at, sent_at, status,
              recipient_count, audience, sent_offset, recipient_ids, created_at
       FROM campaigns WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;
  row.recipient_ids = parseIds(row.recipient_ids);
  if (CAMPAIGN_I18N) row.i18n = parseCampaignI18n(row.i18n);
  return row;
}

export async function cancelCampaign(id) {
  const row = await db
    .query(
      `UPDATE campaigns SET status = 'cancelled' WHERE id = ? AND status = 'scheduled' RETURNING id`,
    )
    .get(id);
  return Boolean(row);
}

// "Versand stoppen" in the admin. A send that has begun stops where it is: one
// that is running, one waiting for its next try, and one put back to
// 'scheduled' while the mail service was unavailable (deferCampaign). The
// worker notices between recipients. Whoever was reached stays in the delivery
// log, so "Erneut versuchen" picks up with the rest. Returns how many were
// reached, or null when the campaign had not begun or is already over.
export async function stopCampaign(id) {
  const row = await db
    .query(
      `UPDATE campaigns SET status = 'aborted', failure = '{"category":"stopped-by-admin"}'
       WHERE id = ? AND (status IN ('sending', 'failed')
         OR (status = 'scheduled' AND delivery_expires_at IS NOT NULL))
       RETURNING id`,
    )
    .get(id);
  return row ? countDelivered(`campaign:${id}`) : null;
}

export async function isCampaignSending(id) {
  const row = await db
    .query(`SELECT 1 FROM campaigns WHERE id = ? AND status = 'sending'`)
    .get(id);
  return Boolean(row);
}

// Claimable: scheduled, failed past its backoff, or 'sending' whose heartbeat
// went stale. Shared by the claim and the reconciler.
function claimableCampaign() {
  const retry = retryableMailing("heartbeat_at");
  return {
    sql: `(status = 'scheduled' OR ${retry.sql})`,
    params: retry.params,
  };
}

// Claim a single campaign for sending (used by the Honker job handler).
// Returns the row (recipient_ids parsed) or null if it isn't due/claimable.
export async function claimCampaignById(id) {
  const claimable = claimableCampaign();
  const now = nowIso();
  await db
    .query(
      `UPDATE campaigns SET status='aborted', failure='{"category":"delivery-tracking-expired"}' WHERE id=? AND delivery_expires_at <= ? AND status NOT IN ('sent','aborted')`,
    )
    .run(id, now);
  const row = await db
    .query(
      `UPDATE campaigns SET status = 'sending', attempts = attempts + 1, heartbeat_at = ?,
         delivery_expires_at = COALESCE(delivery_expires_at, ?)
       WHERE id = ? AND ${claimable.sql}
         AND (delivery_expires_at IS NULL OR delivery_expires_at > ?)
       RETURNING id, template_id, subject, i18n, scheduled_at, audience, sent_offset, recipient_ids, attempts`,
    )
    .get(
      now,
      new Date(Date.now() + DELIVERY_LOG_MS).toISOString(),
      id,
      ...claimable.params,
      now,
    );
  if (!row) return null;
  row.recipient_ids = parseIds(row.recipient_ids);
  row.i18n = parseCampaignI18n(row.i18n);
  return row;
}

export async function deferCampaign(id, retryAfterS) {
  await db
    .query(
      "UPDATE campaigns /* public-neutral */ SET status='scheduled', attempts=MAX(0,attempts-1), scheduled_at=? WHERE id=? AND status='sending'",
    )
    .run(new Date(Date.now() + retryAfterS * 1000).toISOString(), id);
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

export async function setCampaignAudienceSize(id, size) {
  await db
    .query(
      `UPDATE campaigns /* public-neutral */ SET audience_size = ? WHERE id = ?`,
    )
    .run(size, id);
}

// Only a running send completes: one the admin stopped during its last
// recipient stays stopped, with its progress counted.
export async function markCampaignSent(id, recipientCount) {
  const done = await db
    .query(
      `UPDATE campaigns SET status = 'sent', sent_at = ?, recipient_count = ?, sent_offset = ?, failure = NULL
       WHERE id = ? AND status = 'sending'`,
    )
    .run(nowIso(), recipientCount, recipientCount, id);
  if (!done.changes)
    await db
      .query(`UPDATE campaigns SET sent_offset = ? WHERE id = ?`)
      .run(recipientCount, id);
}

// Only a running send fails: one the admin stopped meanwhile stays stopped
// instead of going back to "wird erneut versucht".
export async function markCampaignFailed(
  id,
  failure = { category: "unknown" },
) {
  await db
    .query(
      `UPDATE campaigns
       SET status = CASE WHEN attempts >= ? THEN 'aborted' ELSE 'failed' END,
           heartbeat_at = ?, failure = ?
       WHERE id = ? AND status = 'sending'`,
    )
    .run(MAX_MAILING_ATTEMPTS, nowIso(), JSON.stringify(failure), id);
}

// Admin: give an aborted campaign a fresh set of attempts. Already-reached
// recipients are in the delivery log and are not mailed again, which only
// holds while that log is complete, so the retry is refused once the campaign's
// oldest delivery could have aged out (see deleteOldDeliveries).
export async function retryAbortedCampaign(id) {
  const row = await db
    .query(
      `UPDATE campaigns SET status = 'failed', attempts = 0
       WHERE id = ? AND status = 'aborted'
         AND (delivery_expires_at IS NULL OR delivery_expires_at > ?)
         AND NOT EXISTS (
           SELECT 1 FROM mailing_deliveries d
           WHERE d.mailing = 'campaign:' || campaigns.id AND d.sent_at < ?)
       RETURNING id`,
    )
    .get(id, nowIso(), isoAgo(DELIVERY_LOG_MS));
  return Boolean(row);
}

// ---- newsletter / zoom recipients ------------------------------------------

const RECIPIENT_TABLES = new Map([
  ["signer", "signers"],
  ["meeting", "zoom_registrations"],
  ["pending", "zoom_pending"],
  ["deletion", "deletion_requests"],
]);

function recipientIdentity(recipient) {
  const table = RECIPIENT_TABLES.get(recipient?.source);
  const createdAt = recipient?.createdAt ?? recipient?.created_at;
  if (!table || !recipient.id || !recipient.email || !createdAt) return null;
  return { table, args: [recipient.id, recipient.email, createdAt] };
}

export async function getRecipientIdentity(
  source,
  id,
  { connection = db } = {},
) {
  const table = RECIPIENT_TABLES.get(source);
  if (!table) return null;
  const row = await connection
    .query(`SELECT id,email,created_at FROM ${table} WHERE id=?`)
    .get(id);
  return row
    ? {
        source,
        id: row.id,
        email: row.email,
        createdAt: row.created_at,
        subjectHmac: emailHmac(row.email),
      }
    : null;
}

export async function authorizeRecipient(
  recipient,
  { audience, kind, token, connection = db } = {},
) {
  const identity = recipientIdentity(recipient);
  if (!identity) return false;
  const { table, args } = identity;
  let consent = "1=1";
  const extra = [];
  if (audience) {
    if (["newsletter", "selection", "email_not_zoom"].includes(audience)) {
      if (recipient.source !== "signer") return false;
      consent = "verified=1 AND newsletter=1";
      if (audience === "email_not_zoom")
        consent +=
          " AND NOT EXISTS (SELECT 1 FROM zoom_registrations z WHERE z.email=signers.email)";
    } else if (["zoom", "zoom_delegates"].includes(audience)) {
      if (recipient.source !== "meeting") return false;
      if (audience === "zoom_delegates") consent = "delegierter=1";
    } else return false;
  } else if (kind === "verification") {
    if (recipient.source !== "signer" || !token) return false;
    consent = `verified=0 AND verification_token=? AND ${signupEndsAt()}>?`;
    extra.push(token, nowIso());
  } else if (
    recipient.source === "pending" ||
    recipient.source === "deletion"
  ) {
    if (!token) return false;
    consent = "token=? AND expires_at>?";
    extra.push(token, nowIso());
  } else if (recipient.source === "signer") {
    consent =
      kind === "invite"
        ? "verified=1 AND invite_code IS NOT NULL"
        : "verified=1";
  }
  const row = await connection
    .query(
      `SELECT 1 FROM ${table} WHERE id=? AND email=? AND created_at=? AND ${consent}`,
    )
    .get(...args, ...extra);
  return Boolean(row);
}

export async function markDeliveredForRecipient(
  mailing,
  recipient,
  { connection = db } = {},
) {
  const identity = recipientIdentity(recipient);
  if (!identity) return false;
  const result = await connection
    .query(
      `INSERT INTO mailing_deliveries /* public-neutral */ (mailing,email,sent_at)
    SELECT ?,email,? FROM ${identity.table} WHERE id=? AND email=? AND created_at=?
    ON CONFLICT(mailing,email) DO NOTHING`,
    )
    .run(mailing, nowIso(), ...identity.args);
  return result.changes > 0;
}

export async function issueUnsubscribeTokenForRecipient(
  recipient,
  { connection = db } = {},
) {
  const identity = recipientIdentity(recipient);
  if (!identity || !["signer", "meeting"].includes(recipient.source))
    return null;
  const signer = recipient.source === "signer";
  const row = await connection
    .query(
      `UPDATE ${identity.table} /* public-neutral */
    SET unsubscribe_token=COALESCE(unsubscribe_token,?)${signer ? ", unsubscribe_token_created_at=?" : ""}
    WHERE id=? AND email=? AND created_at=? RETURNING unsubscribe_token`,
    )
    .get(crypto.randomUUID(), ...(signer ? [nowIso()] : []), ...identity.args);
  return row?.unsubscribe_token ?? null;
}

export async function getNewsletterRecipientByEmail(email) {
  return (
    (await db
      .query(
        `SELECT id, name, email, lang, created_at FROM signers
         WHERE email = ? AND verified = 1 AND newsletter = 1`,
      )
      .get(email)) || null
  );
}

export async function getZoomRecipientByEmail(email) {
  return (
    (await db
      .query(
        `SELECT id, name, email, lang, created_at FROM zoom_registrations WHERE email = ?`,
      )
      .get(email)) || null
  );
}

export async function getNewsletterRecipients() {
  return await db
    .query(
      `SELECT id, name, email, unsubscribe_token, lang, created_at FROM signers
       WHERE verified = 1 AND newsletter = 1 ORDER BY created_at ASC`,
    )
    .all();
}

export async function getCampaignLanguageCounts(audience, ids = []) {
  if (audience === "selection" && ids.length === 0) return {};
  const [table, condition] = {
    newsletter: ["signers s", "s.verified = 1 AND s.newsletter = 1"],
    email_not_zoom: [
      "signers s",
      "s.verified = 1 AND s.newsletter = 1 AND NOT EXISTS (SELECT 1 FROM zoom_registrations z WHERE z.email = s.email)",
    ],
    zoom: ["zoom_registrations s", "1 = 1"],
    zoom_delegates: ["zoom_registrations s", "s.delegierter = 1"],
    selection: [
      "signers s",
      `s.verified = 1 AND s.newsletter = 1 AND s.id IN (${ids.map(() => "?").join(",")})`,
    ],
  }[audience];
  const rows = await db
    .query(
      `SELECT s.lang, COUNT(*) AS count FROM ${table} WHERE ${condition} GROUP BY s.lang`,
    )
    .all(...(audience === "selection" ? ids : []));
  const counts = {};
  for (const row of rows) {
    const language = normalizeLang(cfg, row.lang);
    counts[language] = (counts[language] || 0) + row.count;
  }
  return counts;
}

export async function getNewsletterNotZoomRecipients() {
  return await db
    .query(
      `SELECT id, name, email, unsubscribe_token, lang, created_at FROM signers s
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
      `SELECT id, name, email, unsubscribe_token, lang, created_at FROM signers
       WHERE verified = 1 AND newsletter = 1 AND id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .all(...ids);
}

export function getCampaignRecipients(campaign) {
  const audience = campaign.audience || "newsletter";
  if (audience === "zoom" || audience === "zoom_delegates")
    return getZoomRecipients({ delegatesOnly: audience === "zoom_delegates" });
  if (audience === "selection")
    return getNewsletterRecipientsByIds(campaign.recipient_ids || []);
  if (audience === "email_not_zoom") return getNewsletterNotZoomRecipients();
  return getNewsletterRecipients();
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

// The link in the mail the admin sends with "Newsletter-Einwilligung
// anfragen". It carries the signer's settings token, which already lets its
// holder switch the newsletter on, so it is valid exactly as long.
export async function getNewsletterOptIn(token) {
  return boolify(
    (await db
      .query(
        `SELECT id, name, newsletter, lang FROM signers
         WHERE unsubscribe_token = ? AND unsubscribe_token_created_at > ?
           AND verified = 1`,
      )
      .get(token, isoAgo(TOKEN_EDIT_WINDOW))) || null,
    ["newsletter"],
  );
}

// The person's own click on that page: the consent the newsletter needs.
export async function confirmNewsletterOptIn(token) {
  return db.transaction(
    async () => {
      const signer = await getNewsletterOptIn(token);
      if (!signer) return null;
      if (signer.newsletter) return signer;
      const row = await db
        .query(`UPDATE signers SET newsletter = 1 WHERE id = ? RETURNING email`)
        .get(signer.id);
      await forgetErasure(db, row.email, NEWSLETTER_OPT_OUT);
      await recordAction(db, "signer.newsletter-confirmed", {
        targetId: signer.id,
      });
      return signer;
    },
    { immediate: true },
  );
}

// "Unterschrift vollständig löschen" on the settings page: erases the signature
// and everything else stored for that address, incl. a Treffen registration.
// Accepts a signer or a Treffen token, like the rest of the settings page.
export async function deleteSignerByUnsubscribeToken(token, source) {
  return db.transaction(
    async () => {
      const email = await resolveEmailFromToken(token, source);
      if (!email) return false;
      await eraseAuthorizedEmail(email);
      return true;
    },
    { immediate: true },
  );
}

// Sign-ups that ran out without the mail service ever taking a confirmation
// mail with their link: the person did everything right and their signature
// was lost. A link that was replaced by a new one counts like no link.
// Only how many per UTC day, never who, as JSON {"2026-11-22": 3} under this
// app_settings key, for the last UNMAILED_DAYS days.
const UNMAILED_KEY = "signups_expired_unmailed";
const UNMAILED_DAYS = 30;

async function readExpiredUnmailed(now) {
  const row = await db
    .query(`SELECT value FROM app_settings WHERE key = ?`)
    .get(UNMAILED_KEY);
  const oldest = new Date(now.getTime() - UNMAILED_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);
  return Object.fromEntries(
    Object.entries(row ? JSON.parse(row.value) : {}).filter(
      ([day]) => day > oldest,
    ),
  );
}

// For the start page of the admin.
export async function getExpiredUnmailedSignups(now = new Date()) {
  const days = await readExpiredUnmailed(now);
  return {
    count: Object.values(days).reduce((sum, n) => sum + n, 0),
    lastDay: Object.keys(days).sort().at(-1) ?? null,
    days: UNMAILED_DAYS,
  };
}

// DSGVO data minimisation: drop sign-ups that were never email-confirmed once
// they have run out: their link has expired and no mail is awaited. Confirmed
// rows (verified = 1, token cleared) are never touched. Returns the number
// deleted.
// This is the only place an unconfirmed sign-up ends without the person or the
// team asking for it, so it is where the lost ones are counted.
export async function deleteExpiredUnverifiedSigners(now = new Date()) {
  return db.transaction(
    async () => {
      // No mail with the current link ever went out for a sign-up whose
      // link never started to count. Other mail to the address says nothing
      // about that.
      const expired = await db
        .query(
          `SELECT token_expires_at IS NULL AS unmailed FROM signers
           WHERE verified = 0 AND ${signupEndsAt()} < ?`,
        )
        .all(iso(now));
      if (!expired.length) return 0;
      const unmailed = expired.filter((signup) => signup.unmailed).length;
      await db
        .query(
          // Only ever removes unverified rows, which no public read counts, so it
          // must not drop the read cache every five minutes.
          `DELETE FROM signers /* public-neutral */ WHERE verified = 0 AND ${signupEndsAt()} < ?`,
        )
        .run(iso(now));
      if (unmailed) {
        const days = await readExpiredUnmailed(now);
        const today = iso(now).slice(0, 10);
        days[today] = (days[today] || 0) + unmailed;
        await db
          .query(
            `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE
               SET value = excluded.value, updated_at = excluded.updated_at`,
          )
          .run(UNMAILED_KEY, JSON.stringify(days), iso(now));
      }
      return expired.length;
    },
    { immediate: true },
  );
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
  await forgetDeletedSigners(db);
  return (signers?.changes ?? 0) + (zoom?.changes ?? 0);
}

// Resolve email from either a signer or zoom unsubscribe token. Signer tokens
// only count within TOKEN_EDIT_WINDOW unless `optOut` is set; opting out must
// work with a link from any mail, however old. Treffen tokens have no window;
// their rows are purged shortly after the event.
export async function resolveEmailFromToken(
  token,
  source,
  { optOut = false } = {},
) {
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

// The signer's stored region, used to keep a legacy value on self-edit.
export async function getSignerKreisverband(email) {
  const row = await db
    .query(`SELECT kreisverband FROM signers WHERE email = ?`)
    .get(email);
  return row?.kreisverband ?? "";
}

export async function getUnifiedUnsubscribeState(token, source) {
  const access = await resolveTokenAccess(token, source);
  if (!access) return null;
  const { email, editable } = access;

  const signer = await db
    .query(
      `SELECT name, kreisverband, occupation, signer_function AS signerFunction, newsletter, show_publicly,
              ${publicSignerDetailsCondition()} AS showSignerDetails, first_signer, invite_show_name, invite_code, verified
         FROM signers s WHERE email = ?`,
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
    ...(cfg.sign.fields.signerFunction && {
      signerFunction: signer?.signerFunction ?? "",
    }),
    // Present only for a signer who has this choice; the page asks then.
    ...(choosesPublicSignerDetails(signer) && {
      showSignerDetails: Boolean(
        signer?.show_publicly && signer?.showSignerDetails,
      ),
    }),
    showPublicly: Boolean(signer?.show_publicly ?? true),
    inviteShowName: Boolean(signer?.invite_show_name),
    hasInviteCode: Boolean(signer?.invite_code),
    zoomName: zoom?.name ?? "",
    zoomKv: zoom?.kreisverband ?? "",
    delegierter: Boolean(zoom?.delegierter ?? false),
    // Whether the delegate field is currently enabled (admin toggle); the
    // self-service page hides the checkbox when off.
    showDelegierter: await getShowDelegierter(),
  };
}

// Update an existing signer's editable fields. The unsubscribe token (already
// resolved to this email) is the authorization; no `verified` guard, since
// editing a confirmed signature is the whole point. Resetting `state` to ''
// when the Kreisverband changes lets the state backfill re-resolve it.
export async function updateSignerByEmail(
  email,
  {
    name,
    kreisverband,
    occupation,
    signerFunction,
    newsletter,
    showPublicly,
    showSignerDetails,
    inviteShowName,
  },
) {
  // inviteShowName is undefined when invite links are off: left unchanged.
  const inviteName = inviteShowName === undefined ? null : B(inviteShowName);
  return db.transaction(
    async () => {
      const before = await db
        .query(
          `SELECT occupation, signer_function AS signerFunction, first_signer
           FROM signers WHERE email = ?`,
        )
        .get(email);
      // Hiding the name hides the details with it. Left unchanged for a
      // signer who has no such choice, and when the request names none.
      const detailsChoice = showPublicly ? showSignerDetails : false;
      const visibleDetails =
        choosesPublicSignerDetails(before) && detailsChoice !== undefined
          ? B(detailsChoice)
          : null;
      const row = await db
        .query(
          `UPDATE signers SET
          name = ?,
          kreisverband = ?,
          occupation = ?,
          signer_function = COALESCE(?, signer_function),
          newsletter = ?,
          show_publicly = ?,
          show_signer_details = COALESCE(?, show_signer_details),
          invite_show_name = COALESCE(?, invite_show_name),
          state = CASE WHEN kreisverband IS NOT ? THEN '' ELSE state END
        WHERE email = ?
        RETURNING id`,
        )
        .get(
          name,
          kreisverband,
          occupation,
          signerFunction ?? null,
          B(newsletter),
          B(showPublicly),
          visibleDetails,
          inviteName,
          kreisverband,
          email,
        );
      if (row) {
        if (newsletter) await forgetErasure(db, email, NEWSLETTER_OPT_OUT);
        else await recordErasure(db, email, NEWSLETTER_OPT_OUT);
        // Taking the name off the public list must survive a restore as well.
        if (showPublicly) await forgetErasure(db, email, HIDE_PUBLICLY);
        else await recordErasure(db, email, HIDE_PUBLICLY);
        if (visibleDetails === 1)
          await forgetErasure(db, email, HIDE_SIGNER_DETAILS);
        else if (visibleDetails === 0)
          await recordErasure(db, email, HIDE_SIGNER_DETAILS);
        // Withdrawn consent to the name on the invite link, likewise.
        if (inviteShowName === false)
          await recordErasure(db, email, HIDE_INVITE_NAME);
        else if (inviteShowName)
          await forgetErasure(db, email, HIDE_INVITE_NAME);
        await rememberClearedDetails(email, before, {
          occupation,
          signerFunction,
        });
      }
      return Boolean(row);
    },
    { immediate: true },
  );
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
export async function purgeOldErasureLog(before, blocksBefore) {
  return purgeErasureLog(db, before, blocksBefore);
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

export async function getSignerFunctions() {
  return cached("signer-functions", () =>
    db
      .query(
        `SELECT signer_function AS label, COUNT(*) AS count FROM signers
       WHERE verified = 1 AND show_publicly = 1 AND signer_function != ''
         AND ${publicDetailCountCondition()}
       GROUP BY signer_function ORDER BY count DESC, signer_function ASC`,
      )
      .all(),
  );
}

async function queryOccupations() {
  const rows = await db
    .query(
      `SELECT occupation, COUNT(*) AS count FROM signers
       WHERE verified = 1 AND occupation != '' AND show_publicly = 1
         AND ${publicDetailCountCondition()}
       GROUP BY occupation ORDER BY count DESC, occupation ASC`,
    )
    .all();
  if (cfg.sign.fields.signerFunction) return rows;
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
  return db.transaction(
    async () => {
      const rows = await db
        .query(
          `UPDATE signers SET occupation = ? WHERE occupation = ? RETURNING id`,
        )
        .all(toOcc, fromOcc);
      return recordMerge("occupation", fromOcc, toOcc, rows.length, {
        ids: rows.map((row) => row.id),
      });
    },
    { immediate: true },
  );
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
        AND ${publicDetailCountCondition()}
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
  return db.transaction(
    async () => {
      // The merge clears the state for re-resolution, so taking it back needs
      // the one each signature had.
      const rows = await db
        .query(`SELECT id, state FROM signers WHERE kreisverband = ?`)
        .all(fromKv);
      await db
        .query(
          `UPDATE signers SET kreisverband = ?, state = '' WHERE kreisverband = ?`,
        )
        .run(toKv, fromKv);
      return recordMerge("kreisverband", fromKv, toKv, rows.length, {
        states: rows.map((row) => [row.id, row.state || ""]),
      });
    },
    { immediate: true },
  );
}

// "Bundesland zuweisen": the Land for every signature of a Kreisverband that
// has none yet, remembered in the resolution cache for later sign-ups.
export async function assignKvState(kreisverband, state) {
  return db.transaction(
    async () => {
      const cache =
        (await db
          .query(
            `SELECT state, source FROM kv_state_cache WHERE kreisverband = ?`,
          )
          .get(kreisverband)) || null;
      await upsertKvStateCache(kreisverband, state, "manual");
      const rows = await db
        .query(
          `UPDATE signers SET state = ? WHERE kreisverband = ? AND state = '' RETURNING id`,
        )
        .all(state, kreisverband);
      return recordMerge("state", kreisverband, state, rows.length, {
        ids: rows.map((row) => row.id),
        cache,
      });
    },
    { immediate: true },
  );
}

// ---- taking a merge back ---------------------------------------------------

// How long a merge can be taken back; its record is deleted after that.
const MERGE_UNDO_MS = 30 * DAY;

async function recordMerge(kind, from, to, updated, detail) {
  if (!updated) return { updated, undoId: null };
  const { id } = await db
    .query(
      `INSERT INTO admin_merges /* public-neutral */ (kind, from_value, to_value, detail, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(kind, from, to, JSON.stringify(detail), nowIso());
  return { updated, undoId: id };
}

// Each restores only signatures that still hold what the merge gave them: one
// edited or erased since stays as it is, and so does a state set since.
const UNDO_MERGE = {
  async occupation({ from_value, to_value }, { ids }) {
    const res = await db
      .query(
        `UPDATE signers SET occupation = ?
         WHERE occupation = ? AND id IN (SELECT value FROM json_each(?))`,
      )
      .run(from_value, to_value, JSON.stringify(ids));
    return res.changes;
  },
  async kreisverband({ from_value, to_value }, { states }) {
    const byState = Map.groupBy(states, ([, state]) => state);
    let restored = 0;
    for (const [state, group] of byState) {
      const res = await db
        .query(
          `UPDATE signers SET kreisverband = ?,
             state = CASE WHEN state = '' THEN ? ELSE state END
           WHERE kreisverband = ? AND id IN (SELECT value FROM json_each(?))`,
        )
        .run(
          from_value,
          state,
          to_value,
          JSON.stringify(group.map(([id]) => id)),
        );
      restored += res.changes;
    }
    return restored;
  },
  async state({ from_value, to_value }, { ids, cache }) {
    // Left in place, the cache entry would assign the Land again. A later
    // assignment has replaced it already and stays.
    const current = await db
      .query(`SELECT state, source FROM kv_state_cache WHERE kreisverband = ?`)
      .get(from_value);
    if (current?.state === to_value && current.source === "manual") {
      if (cache)
        await upsertKvStateCache(from_value, cache.state, cache.source);
      else
        await db
          .query(`DELETE FROM kv_state_cache WHERE kreisverband = ?`)
          .run(from_value);
    }
    const res = await db
      .query(
        `UPDATE signers SET state = ''
         WHERE kreisverband = ? AND state = ? AND id IN (SELECT value FROM json_each(?))`,
      )
      .run(from_value, to_value, JSON.stringify(ids));
    return res.changes;
  },
};

// Returns { kind, restored }, "undone" for a merge already taken back, or
// null for one that is unknown or older than the undo period.
export async function undoMerge(id) {
  return db.transaction(
    async () => {
      const merge = await db
        .query(`SELECT * FROM admin_merges WHERE id = ?`)
        .get(id);
      if (!merge) return null;
      if (merge.undone_at) return "undone";
      const restored = await UNDO_MERGE[merge.kind](
        merge,
        JSON.parse(merge.detail),
      );
      await db
        .query(
          `UPDATE admin_merges /* public-neutral */ SET undone_at = ? WHERE id = ?`,
        )
        .run(nowIso(), id);
      return { kind: merge.kind, restored };
    },
    { immediate: true },
  );
}

export async function deleteExpiredMerges() {
  const res = await db
    .query(`DELETE FROM admin_merges /* public-neutral */ WHERE created_at < ?`)
    .run(isoAgo(MERGE_UNDO_MS));
  return res?.changes ?? 0;
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
        AND ${publicDetailCountCondition()}
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
