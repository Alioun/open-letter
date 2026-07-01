import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SignJWT, jwtVerify } from "jose";
import cfg, { LETTER_NAME } from "../config/letter.config.js";
import { renderIndexHtml, analyticsOrigin } from "../config/html.js";
import {
  getSigners,
  getStats,
  getMilestones,
  setMilestones,
  getNewsletterStats,
  getOccupations,
  getKreisverbandStats,
  insertSigner,
  insertZoomRegistration,
  getSignerForZoomInvite,
  getZoomRegistrationCount,
  listZoomRegistrations,
  getZoomCounts,
  getZoomRecipients,
  refreshZoomUnsubscribeToken,
  deleteZoomRegistrationByUnsubscribeToken,
  getZoomRegistrationByEmail,
  claimZoomMailing,
  markZoomMailing,
  listZoomMailings,
  resetZoomMailings,
  clearZoomRegistrations,
  getZoomSettings,
  setZoomSettings,
  confirmSigner,
  refreshVerificationToken,
  getVerifiedSignerName,
  createDeletionToken,
  deleteSigner,
  healthCheck,
  close,
  listEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  listCampaigns,
  createCampaign,
  cancelCampaign,
  claimCampaignById,
  getDueCampaignIds,
  markCampaignSent,
  markCampaignFailed,
  incrementCampaignOffset,
  getNewsletterRecipients,
  getNewsletterNotZoomRecipients,
  getNewsletterRecipientsByIds,
  listNewsletterSigners,
  listNewsletterSignerIds,
  getNewsletterSignerFilters,
  getNewsletterRecipientByEmail,
  getZoomRecipientByEmail,
  refreshUnsubscribeToken,
  refreshUnsubscribeTokenByEmail,
  getUnsubscribeState,
  getUnifiedUnsubscribeState,
  getShowDelegierter,
  resolveEmailFromToken,
  optOutNewsletter,
  optOutNewsletterByEmail,
  deleteZoomByEmail,
  updateSignerByEmail,
  updateZoomByEmail,
  deleteSignerByUnsubscribeToken,
  getStateStats,
  ensureKvStateCacheTable,
  getStateResolutionStats,
  getDistinctKreisverbands,
  mergeKreisverband,
  insertKvNotTypo,
  loadKvNotTypo,
  getUnresolvedKvs,
  clearEmptyKvCacheEntries,
  upsertKvStateCache,
  bulkUpdateSignerStateByKv,
  getDistinctOccupations,
  mergeOccupation,
  insertOccNotTypo,
  loadOccNotTypo,
  normalizeOccupation,
} from "./db.js";
import {
  sendVerificationEmail,
  sendZoomConfirmationEmail,
  sendDeletionEmail,
  sendRenderedEmail,
  sendBatchEmails,
  buildUnsubscribeHeaders,
  renderEmailHtml,
  interpolateTemplate,
  renderTemplateBySlug,
  sendAlreadySignedEmail,
  zoomCalendarButton,
  messageDelayMs,
  batchDelayMs,
} from "./email.js";
import { buildZoomIcs } from "./ics.js";
import { checkRateLimit } from "./ratelimit.js";
import { runBackup } from "./backup.js";
import {
  initJobs,
  enqueue as enqueueJob,
  registerSchedule,
  startWorker,
  stopWorker,
} from "../db/jobs.js";
import {
  enqueueStateResolution,
  startStateWorker,
  triggerBackfill,
  getQueueLength,
  clearProcessedKvs,
} from "./nominatim.js";
import { initStateCache } from "./states.js";
import { findOutlierGroups } from "./levenshtein.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || BASE_URL)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const isDev = process.env.NODE_ENV !== "production";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

// Zoom event defaults come from the active letter config; env overrides win.
// Empty when no date is set yet (date TBD) — the meeting then counts as "open"
// so the signup form/CTA still show. A real date is set in the admin.
const ZOOM_LINK = sanitizeUrl(process.env.ZOOM_LINK || "");
const ZOOM_EVENT_AT_DEFAULT =
  process.env.ZOOM_EVENT_AT || cfg.zoom?.eventAt || "";
const ZOOM_EVENT_DURATION_MIN_DEFAULT = parseInt(
  process.env.ZOOM_EVENT_DURATION_MIN || String(cfg.zoom?.durationMin || 90),
  10,
);
const ZOOM_ICS_URL = `${BASE_URL}/api/termin.ics`;

// Human German label for the event date/time, e.g. "9. Juni, 20:00 Uhr".
function formatZoomLabel(date) {
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "long",
  }).format(date);
  const time = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${day}, ${time} Uhr`;
}

// Confirmation-mail phrasing derived from the link-mail offset.
function offsetPhrase(hours) {
  if (hours % 24 === 0) {
    const days = hours / 24;
    if (days === 1) return "einen Tag";
    const words = {
      2: "zwei",
      3: "drei",
      4: "vier",
      5: "fünf",
      6: "sechs",
      7: "sieben",
    };
    return `${words[days] || days} Tage`;
  }
  if (hours === 1) return "eine Stunde";
  return `${hours} Stunden`;
}

// Effective Zoom config: DB settings override env defaults.
async function getZoomConfig() {
  let s = {};
  try {
    s = await getZoomSettings();
  } catch (err) {
    console.error("[zoom] getZoomSettings failed, using defaults:", err);
  }
  const rawEventAt = s.zoom_event_at || ZOOM_EVENT_AT_DEFAULT;
  // No date set yet → keep a safe epoch Date internally, but expose it as "unset"
  // (null iso/label, dateSet=false) so the client's zoomOpen check treats the
  // meeting as still upcoming.
  const eventAt = new Date(rawEventAt || 0);
  const dateSet = Boolean(rawEventAt) && !Number.isNaN(eventAt.getTime());
  const durationMin = parseInt(
    s.zoom_duration_min || String(ZOOM_EVENT_DURATION_MIN_DEFAULT),
    10,
  );
  const linkOffsetHours = parseInt(s.zoom_link_offset_hours || "24", 10);
  const reminderOffsetHours = parseInt(s.zoom_reminder_offset_hours || "2", 10);
  // Runtime-editable event fallback label (shown when no date is set yet).
  const eventLabelFallback = s.zoom_event_label || cfg.zoom?.eventLabel || "";
  return {
    eventAt,
    eventAtIso: dateSet ? eventAt.toISOString() : null,
    dateSet,
    durationMin,
    linkOffsetHours,
    reminderOffsetHours,
    link: s.zoom_link || ZOOM_LINK,
    label: dateSet ? formatZoomLabel(eventAt) : eventLabelFallback,
    // Raw fallback label, exposed to the admin form so it can be edited.
    eventLabelFallback,
    // Date phrase for email copy: " am 12. Juli, 19 Uhr" when a date is set, or
    // "" when it's still TBD — so templates read cleanly either way.
    whenPhrase: dateSet ? ` am ${formatZoomLabel(eventAt)}` : "",
    icsUrl: ZOOM_ICS_URL,
    // Nav/CTA label for the Treffen (admin-editable, falls back to config).
    navLabel: s.zoom_nav_label || cfg.zoom?.navLabel || "Treffen",
    // Delegate field toggle — admin-editable, seeded from the letter config.
    showDelegierter:
      s.zoom_show_delegierter != null
        ? s.zoom_show_delegierter === "1"
        : Boolean(cfg.zoom?.form?.showDelegierter),
    // Meeting mode + in-person location, admin-editable over the letter config.
    mode: (s.zoom_mode || cfg.zoom?.mode) === "inperson" ? "inperson" : "online",
    location: {
      name: s.zoom_location_name ?? cfg.zoom?.location?.name ?? "",
      address: s.zoom_location_address ?? cfg.zoom?.location?.address ?? "",
      mapsUrl: sanitizeUrl(
        s.zoom_location_maps_url ?? cfg.zoom?.location?.mapsUrl ?? "",
      ),
    },
  };
}

const ADMIN_PATH = normalizeAdminPath(process.env.ADMIN_PATH);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";
const API_TOKEN_SECRET = process.env.API_TOKEN_SECRET;

if (!ADMIN_PATH || !ADMIN_PASSWORD || !ADMIN_JWT_SECRET) {
  throw new Error(
    "ADMIN_PATH, ADMIN_PASSWORD, and ADMIN_JWT_SECRET must be set.",
  );
}
if (ADMIN_JWT_SECRET.length < 32) {
  throw new Error("ADMIN_JWT_SECRET must be at least 32 characters long.");
}
if (!isDev && !TRUST_PROXY) {
  console.warn(
    "[security] TRUST_PROXY is not set — set TRUST_PROXY=true when running behind a reverse proxy for accurate IP rate-limiting.",
  );
}
if (!isDev && !API_TOKEN_SECRET) {
  throw new Error(
    "API_TOKEN_SECRET must be set in production and must be distinct from ADMIN_JWT_SECRET.",
  );
}
if (!isDev && API_TOKEN_SECRET === ADMIN_JWT_SECRET) {
  throw new Error(
    "API_TOKEN_SECRET must not equal ADMIN_JWT_SECRET in production.",
  );
}

// Generate the homepage + admin HTML from the active letter config, then let
// Bun bundle them. Writing only on change keeps git clean for the default
// letter and avoids dev-watch reload loops. A read-only FS falls back to any
// pre-existing generated file.
function writeIfChanged(relPath, content) {
  const path = fileURLToPath(new URL("../" + relPath, import.meta.url));
  let existing = null;
  try {
    existing = readFileSync(path, "utf8");
  } catch {}
  if (existing === content) return;
  try {
    writeFileSync(path, content);
  } catch (err) {
    if (existing == null) throw err;
    console.warn(
      `[html] could not regenerate ${relPath}, using existing:`,
      err.message,
    );
  }
}

writeIfChanged(
  "index.generated.html",
  renderIndexHtml(
    readFileSync(new URL("../index.template.html", import.meta.url), "utf8"),
    cfg,
    LETTER_NAME,
  ),
);
writeIfChanged(
  "admin.generated.html",
  readFileSync(new URL("../admin.template.html", import.meta.url), "utf8")
    .replace("{{LANG}}", cfg.brand.lang || "de")
    .replace("{{LETTER}}", LETTER_NAME),
);

const { default: homepage } = await import("../index.generated.html");
const { default: admin } = await import("../admin.generated.html");

const adminRoute = `/${ADMIN_PATH}`;
const jwtSecret = new TextEncoder().encode(ADMIN_JWT_SECRET);

// Public-API session tokens. The public frontend fetches a short-lived signed
// token from /api/session and sends it on every public API call, so the
// endpoints reject direct, token-less access from bots/scrapers. This is a
// deterrent layer (a determined client can still fetch a token), not a hard
// boundary — the per-IP rate limits on the endpoints are the real throttle.
// Separate secret so public tokens can never be confused with admin tokens;
// falls back to ADMIN_JWT_SECRET so existing deployments keep booting.
const apiTokenSecret = new TextEncoder().encode(
  API_TOKEN_SECRET || ADMIN_JWT_SECRET,
);
const PUBLIC_TOKEN_TTL_SECONDS = 30 * 60;
// Escape hatch: set REQUIRE_API_TOKEN=false to disable the gate (e.g. if a
// client integration breaks) without redeploying the frontend.
const REQUIRE_API_TOKEN = process.env.REQUIRE_API_TOKEN !== "false";

function normalizeAdminPath(path) {
  const value = String(path || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!value || value.includes("/") || value.includes("?") || value === "api") {
    return "";
  }
  return value;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getBaseUrl(req) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const origin = `${proto}://${host}`;
  return ALLOWED_ORIGINS.has(origin) ? origin : BASE_URL;
}

function sanitize(str, max = 100) {
  return String(str || "")
    .trim()
    .replace(/<[^>]*>/g, "")
    .slice(0, max);
}

function sanitizeHtml(str, max = 120000) {
  return String(str || "").slice(0, max);
}

// Parse the shared filter params for the admin newsletter-signer list.
function parseSignerFilters(req) {
  const params = new URL(req.url).searchParams;
  const parseDate = (key) => {
    const raw = params.get(key);
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return {
    search: sanitize(params.get("search") || "", 120),
    state: sanitize(params.get("state") || "", 80),
    kv: sanitize(params.get("kv") || "", 120),
    dateFrom: parseDate("from"),
    dateTo: parseDate("to"),
  };
}

function sanitizeEmail(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { ...securityHeaders, ...headers },
  });
}

// Allow the configured analytics host (script load + beacon) only when set.
const analyticsHost = analyticsOrigin(cfg);
const scriptSrc = ["'self'", analyticsHost].filter(Boolean).join(" ");
const connectSrc = ["'self'", analyticsHost].filter(Boolean).join(" ");

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  ...(isDev
    ? {}
    : {
        "Content-Security-Policy": `default-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; img-src 'self' data:; connect-src ${connectSrc}; frame-src 'self' about:`,
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      }),
};

function getClientIp(req) {
  if (TRUST_PROXY) {
    // When behind a single trusted reverse proxy, prefer X-Real-IP first.
    // Fall back to the right-most X-Forwarded-For address (the proxy-added hop)
    // to avoid trusting a client-supplied left-most value.
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const parts = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return parts[parts.length - 1] || "unknown";
    }
    return "unknown";
  }
  return req.headers.get("x-real-ip") || "unknown";
}

const MAX_BODY_BYTES = 128 * 1024;
function bodyTooLarge(req) {
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  return len > MAX_BODY_BYTES;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function concatUint8Arrays(chunks) {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function parseJsonBody(req) {
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (len > MAX_BODY_BYTES) throw new Error("Payload too large");

  const bodyStream = req.body;
  if (bodyStream && typeof bodyStream.getReader === "function") {
    const reader = bodyStream.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        size += value.byteLength || value.length || 0;
        if (size > MAX_BODY_BYTES) throw new Error("Payload too large");
        chunks.push(value);
      }
    }
    const text = new TextDecoder().decode(concatUint8Arrays(chunks));
    return JSON.parse(text);
  }

  return await parseJsonBody(req);
}

async function constantTimePasswordMatches(submitted) {
  const [left, right] = await Promise.all([
    sha256Hex(String(submitted || "")),
    sha256Hex(ADMIN_PASSWORD),
  ]);
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

async function createAdminToken() {
  return await new SignJWT({ scope: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(jwtSecret);
}

async function requireAdmin(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, jwtSecret);
    return payload.sub === "admin" && payload.scope === "admin";
  } catch {
    return false;
  }
}

async function createPublicToken() {
  return await new SignJWT({ scope: "public" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PUBLIC_TOKEN_TTL_SECONDS}s`)
    .sign(apiTokenSecret);
}

// True when the request carries a valid, unexpired public (or admin) token.
// Accepts the token via X-Api-Token or an Authorization: Bearer header.
async function hasValidPublicToken(req) {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const token = req.headers.get("x-api-token") || bearer;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, apiTokenSecret);
    return payload.scope === "public" || payload.scope === "admin";
  } catch {
    return false;
  }
}

// Guard for public endpoints: enforces a per-IP rate limit, then (unless
// disabled) requires a valid public session token. Returns an error Response
// when the request should be rejected, or null when it may proceed.
async function denyPublic(req, bucket, max, windowMs) {
  const ip = getClientIp(req);
  const { allowed, retryAfter } = checkRateLimit(ip, bucket, max, windowMs);
  if (!allowed) {
    return json({ error: "Zu viele Anfragen." }, 429, {
      "Retry-After": String(retryAfter),
    });
  }
  if (REQUIRE_API_TOKEN && !(await hasValidPublicToken(req))) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

function denyRate(req, bucket, max, windowMs) {
  const { allowed, retryAfter } = checkRateLimit(
    getClientIp(req),
    bucket,
    max,
    windowMs,
  );
  if (!allowed) {
    return json({ error: "Zu viele Anfragen." }, 429, {
      "Retry-After": String(retryAfter),
    });
  }
  return null;
}

// Token-only guard for public endpoints that already run their own rate limit.
async function denyToken(req) {
  if (REQUIRE_API_TOKEN && !(await hasValidPublicToken(req))) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

async function adminJson(req, handler) {
  if (!(await requireAdmin(req))) return json({ error: "Unauthorized" }, 401);
  try {
    return await handler();
  } catch (err) {
    console.error("Admin API error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}

function maskEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  const maskedLocal =
    local.length <= 2 ? `${local[0] || ""}*` : `${local.slice(0, 2)}***`;
  return `${maskedLocal}@${domain}`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Whether the join link may be surfaced yet: only once the link window has
// opened (eventAt − linkOffsetHours). Guards against a TBD date (eventAt is an
// epoch fallback then, so a naive comparison would always be "open").
function isLinkWindowOpen(zc) {
  if (!zc?.dateSet) return false;
  const eventMs = zc.eventAt?.getTime?.();
  if (!eventMs || Number.isNaN(eventMs)) return false;
  const linkMs = (zc.linkOffsetHours || 0) * 60 * 60 * 1000;
  return Date.now() >= eventMs - linkMs;
}

// The mode-aware {{linkInfo}} block for meeting emails. For online meetings it
// shows the join link — but only once the link window has opened (before that,
// or when `pending`, it says the link follows by email); for in-person meetings
// it shows the location/address. Always appends the calendar button. `zc` is the
// getZoomConfig() result.
function buildMeetingInfo(zc, { pending = false, timingText = "vor dem Termin" } = {}) {
  const calBtn = zoomCalendarButton(ZOOM_ICS_URL);
  if (zc?.mode === "inperson") {
    const loc = zc.location || {};
    const where = [loc.name, loc.address].filter(Boolean).map(escapeHtml).join(", ");
    const wherePart = where
      ? `<p>Wir treffen uns <strong>vor Ort</strong>: ${where}.</p>`
      : `<p>Den genauen Ort schicken wir dir rechtzeitig vor dem Termin per E-Mail.</p>`;
    const mapPart = loc.mapsUrl
      ? `<p><a href="${escapeHtml(loc.mapsUrl)}">Auf der Karte ansehen</a></p>`
      : "";
    return wherePart + mapPart + calBtn;
  }
  // online
  if (pending) {
    return (
      `<p>Den <strong>Einwahllink bekommst du ${timingText} vor dem Termin</strong> per E-Mail.</p>` +
      calBtn
    );
  }
  const safeLink = sanitizeUrl(zc?.link || "");
  // Only reveal the actual link once the link window has opened; otherwise the
  // invite email (sent well ahead) would leak the link before it's time.
  const linkPart =
    safeLink && isLinkWindowOpen(zc)
      ? `<p>Hier geht's direkt zum Treffen: <a href="${escapeHtml(safeLink)}">${escapeHtml(safeLink)}</a></p>`
      : `<p>Den Einwahllink schicken wir dir rechtzeitig vor dem Termin per E-Mail.</p>`;
  return linkPart + calBtn;
}

function buildZoomEventIcs(zc, { includeLink = false } = {}) {
  const brand = cfg.brand?.name || "Initiative";
  const summary = `Treffen - ${brand}`;
  if (zc?.mode === "inperson") {
    const loc = zc.location || {};
    const where = [loc.name, loc.address].filter(Boolean).join(", ");
    const desc = where
      ? `Treffen der ${brand}.\nOrt: ${where}`
      : `Treffen der ${brand}.\nDen genauen Ort bekommst du per E-Mail.`;
    return buildZoomIcs({
      start: zc.eventAt,
      durationMin: zc.durationMin,
      summary,
      description: desc,
      url: loc.mapsUrl || "",
      location: where || "Vor Ort",
      uid: `zoom-${zc.eventAt.getTime()}@gehaltsdeckel.jetzt`,
    });
  }
  const link = includeLink ? zc.link : "";
  const desc = link
    ? `Online-Treffen der ${brand}.\nEinwahl: ${link}`
    : `Online-Treffen der ${brand}.\nDen Einwahllink bekommst du per E-Mail.`;
  return buildZoomIcs({
    start: zc.eventAt,
    durationMin: zc.durationMin,
    summary,
    description: desc,
    url: link,
    location: "Online",
    uid: `zoom-${zc.eventAt.getTime()}@gehaltsdeckel.jetzt`,
  });
}

function zoomUnsubPage(inner) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Zoom-Verteiler — Gehaltsdeckel jetzt</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f4f1ec; color:#6f003c; font-family:Inter,Arial,sans-serif; padding:24px; }
  .card { max-width:520px; background:#fff; border:1px solid #6f003c; box-shadow:10px 10px 0 #ff0000; padding:40px; }
  h1 { font-family:"Work Sans",Arial,sans-serif; font-weight:900; font-size:28px; margin:0 0 16px; }
  p { font-size:16px; line-height:1.6; margin:0 0 16px; }
  button { font-family:"Work Sans",Arial,sans-serif; font-weight:700; font-size:15px; color:#fff; background:#ff0000; border:none; padding:14px 22px; cursor:pointer; }
  button:hover { background:#cc0000; }
</style></head><body><div class="card">${inner}</div></body></html>`;
}

async function sendCampaign(campaign) {
  const template = await getEmailTemplate(campaign.template_id);
  if (!template) {
    console.error(
      `[campaign] ${campaign.id} template ${campaign.template_id} not found — aborting`,
    );
    await markCampaignFailed(campaign.id, 0);
    return;
  }

  const audience = campaign.audience || "newsletter";
  const isZoom = audience === "zoom" || audience === "zoom_delegates";
  const isSelection = audience === "selection";
  const isNotZoom = audience === "email_not_zoom";

  const recipients = isZoom
    ? await getZoomRecipients({ delegatesOnly: audience === "zoom_delegates" })
    : isSelection
      ? await getNewsletterRecipientsByIds(campaign.recipient_ids || [])
      : isNotZoom
        ? await getNewsletterNotZoomRecipients()
        : await getNewsletterRecipients();
  const stats = await getNewsletterStats();
  const signerCount = stats.signerCount?.toLocaleString("de-DE") || "0";
  const zoomCfg = await getZoomConfig();
  const zoomLinkInfo = zoomCfg ? buildMeetingInfo(zoomCfg) : "";

  // Resume from where a previous run left off (0 for fresh start).
  const resumeOffset = campaign.sent_offset ?? 0;
  const todo = recipients.slice(resumeOffset);
  let sent = 0;

  console.log(
    `[campaign] ${campaign.id} starting — ${recipients.length} total, resuming from offset=${resumeOffset}, remaining=${todo.length}, audience=${audience}`,
  );

  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    const chunkIndex = Math.floor((resumeOffset + i) / 100);

    const payloads = [];
    const skipped = [];
    for (const recipient of batch) {
      try {
        const firstName = recipient.name.split(/\s/)[0];
        let variables;
        let optOutUrl;
        if (isZoom) {
          const token = await refreshZoomUnsubscribeToken(recipient.id);
          const unsubscribeUrl = `${BASE_URL}/abmelden/${token}?from=zoom`;
          optOutUrl = `${BASE_URL}/api/zoom-abmelden/${token}/opt-out`;
          variables = {
            name: recipient.name,
            firstName,
            eventLabel: zoomCfg.label,
            eventWhen: zoomCfg.whenPhrase,
            zoomLink: zoomCfg.link,
            linkInfo: zoomLinkInfo,
            unsubscribeUrl,
          };
        } else {
          const token = await refreshUnsubscribeToken(recipient.id);
          const unsubscribeUrl = `${BASE_URL}/abmelden/${token}`;
          optOutUrl = `${BASE_URL}/api/unsubscribe/${token}/opt-out`;
          variables = {
            name: recipient.name,
            firstName,
            signerCount,
            eventLabel: zoomCfg?.label || "",
            eventWhen: zoomCfg?.whenPhrase || "",
            linkInfo: zoomLinkInfo,
            unsubscribeUrl,
            ...treffenSignupUrls(token, zoomCfg?.showDelegierter),
          };
        }
        payloads.push({
          to: recipient.email,
          subject: interpolateTemplate(campaign.subject, variables),
          html: renderEmailHtml(template.html_body, variables),
          headers: buildUnsubscribeHeaders(optOutUrl),
        });
      } catch (prepErr) {
        console.error(
          `[campaign] ${campaign.id} skipping recipient ${recipient.id} (prep failed):`,
          prepErr,
        );
        skipped.push(recipient.id);
      }
    }

    if (payloads.length === 0) {
      // All skipped — advance offset and continue.
      await incrementCampaignOffset(campaign.id, batch.length);
      sent += batch.length;
      continue;
    }

    try {
      await sendBatchEmails(
        payloads,
        `campaign-${campaign.id}/chunk-${chunkIndex}`,
      );
      sent += batch.length;
      await incrementCampaignOffset(campaign.id, batch.length);
      console.log(
        `[campaign] ${campaign.id} progress — ${resumeOffset + sent}/${recipients.length} sent${skipped.length ? `, ${skipped.length} skipped` : ""}`,
      );
    } catch (sendErr) {
      console.error(
        `[campaign] ${campaign.id} batch send failed at chunk ${chunkIndex}:`,
        sendErr,
      );
      // Persist how many we've sent so far, then mark failed for retry.
      await markCampaignFailed(campaign.id);
      return;
    }

    if (i + 100 < todo.length) await sleep(batchDelayMs);
  }

  console.log(
    `[campaign] ${campaign.id} done — ${resumeOffset + sent}/${recipients.length} sent`,
  );
  await markCampaignSent(campaign.id, resumeOffset + sent);
}

// Campaign sending is driven by Honker durable jobs (see the boot section).
// Each campaign is processed by a `campaigns` queue job; a reconciler re-enqueues
// any due/failed campaign so sends survive restarts and transient failures.
async function handleCampaignJob({ campaignId }) {
  const campaign = await claimCampaignById(campaignId);
  if (!campaign) return; // already sending/sent, or cancelled (row deleted)
  await sendCampaign(campaign);
}

// ---- Zoom event mailings (link 1 day before + ICS, reminder 2 hours before) ----

// Renders one zoom event mail (kind 'link' | 'reminder') for a recipient using
// the given unsubscribe token. Shared by the worker and the admin test-send so
// both exercise the exact same rendering (incl. the .ics attachment for 'link').
async function buildZoomMailPayload(kind, recipient, token, cfg) {
  const unsubscribeUrl = `${BASE_URL}/abmelden/${token}?from=zoom`;
  const optOutUrl = `${BASE_URL}/api/zoom-abmelden/${token}/opt-out`;
  const slug = kind === "link" ? "zoom_link" : "zoom_reminder";
  const rendered = await renderTemplateBySlug(slug, {
    name: recipient.name,
    firstName: recipient.name.split(/\s/)[0],
    eventLabel: cfg.label,
    linkInfo: buildMeetingInfo(cfg),
    unsubscribeUrl,
  });
  const payload = {
    to: recipient.email,
    subject: rendered.subject,
    html: rendered.html,
    headers: buildUnsubscribeHeaders(optOutUrl),
  };
  if (kind === "link") {
    const icsB64 = Buffer.from(
      buildZoomEventIcs(cfg, { includeLink: true }),
      "utf-8",
    ).toString("base64");
    payload.attachments = [
      {
        filename: "termin.ics",
        content: icsB64,
        content_type: "text/calendar; method=PUBLISH; charset=utf-8",
      },
    ];
  }
  return payload;
}

async function sendZoomSignupEmail({ regId, name, email, cfg }) {
  const mailings = await listZoomMailings();
  const reminderSent = mailings.some(
    (m) => m.kind === "reminder" && m.status === "sent",
  );
  const linkSent = mailings.some(
    (m) => m.kind === "link" && m.status === "sent",
  );
  // If the link window is already open, a fresh signup would otherwise get the
  // "link comes later" confirmation and never receive the link (the scheduled
  // link mail already went out). Send them the link mail right away instead.
  const windowOpen = isLinkWindowOpen(cfg) && Boolean(cfg.link);

  if (reminderSent || linkSent || windowOpen) {
    const kind = reminderSent ? "reminder" : "link";
    const unsubToken = await refreshZoomUnsubscribeToken(regId);
    const payload = await buildZoomMailPayload(
      kind,
      { name, email },
      unsubToken,
      cfg,
    );
    await sendRenderedEmail(payload);
  } else {
    await sendZoomConfirmationEmail({
      to: email,
      name,
      eventLabel: cfg.label,
      eventWhen: cfg.whenPhrase,
      linkInfo: buildMeetingInfo(cfg, {
        pending: true,
        timingText: offsetPhrase(cfg.linkOffsetHours),
      }),
    });
  }
}

async function sendZoomLinkMails(cfg) {
  const recipients = await getZoomRecipients();
  let sent = 0;
  console.log(
    `[zoom-mail] link mailing starting — ${recipients.length} recipients`,
  );
  for (const recipient of recipients) {
    try {
      const token = await refreshZoomUnsubscribeToken(recipient.id);
      const payload = await buildZoomMailPayload("link", recipient, token, cfg);
      await sendRenderedEmail(payload);
      sent++;
    } catch (err) {
      console.error(`[zoom-mail] link send failed for one recipient:`, err);
    }
    await sleep(messageDelayMs); // pace sends to respect provider rate limits
  }
  console.log(
    `[zoom-mail] link mailing done — ${sent}/${recipients.length} sent`,
  );
  return sent;
}

async function sendZoomReminderMails(cfg) {
  const recipients = await getZoomRecipients();
  let sent = 0;
  console.log(
    `[zoom-mail] reminder starting — ${recipients.length} recipients`,
  );
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100);
    const chunkIndex = Math.floor(i / 100);
    const payloads = [];
    for (const recipient of batch) {
      const token = await refreshZoomUnsubscribeToken(recipient.id);
      payloads.push(
        await buildZoomMailPayload("reminder", recipient, token, cfg),
      );
    }
    await sendBatchEmails(payloads, `zoom-reminder/chunk-${chunkIndex}`);
    sent += payloads.length;
    if (i + 100 < recipients.length) await sleep(batchDelayMs);
  }
  console.log(`[zoom-mail] reminder done — ${sent}/${recipients.length} sent`);
  return sent;
}

let zoomMailingRunning = false;

async function runZoomMailingWorker() {
  if (zoomMailingRunning) return;
  const cfg = await getZoomConfig();
  if (!cfg.dateSet) return; // no date yet → nothing to schedule
  const eventMs = cfg.eventAt.getTime();
  if (Number.isNaN(eventMs)) return;
  const linkMs = cfg.linkOffsetHours * 60 * 60 * 1000;
  const reminderMs = cfg.reminderOffsetHours * 60 * 60 * 1000;
  const now = Date.now();
  zoomMailingRunning = true;
  try {
    // Link + ICS (needs the actual Zoom link)
    if (now >= eventMs - linkMs && now < eventMs) {
      if (!cfg.link) {
        console.warn(
          "[zoom-mail] link window open but ZOOM_LINK is not set — skipping (will retry once configured)",
        );
      } else if (await claimZoomMailing("link")) {
        try {
          const count = await sendZoomLinkMails(cfg);
          await markZoomMailing("link", "sent", count);
        } catch (err) {
          console.error("[zoom-mail] link mailing failed:", err);
          await markZoomMailing("link", "failed");
        }
      }
    }
    // Reminder
    if (now >= eventMs - reminderMs && now < eventMs) {
      if (await claimZoomMailing("reminder")) {
        try {
          const count = await sendZoomReminderMails(cfg);
          await markZoomMailing("reminder", "sent", count);
        } catch (err) {
          console.error("[zoom-mail] reminder failed:", err);
          await markZoomMailing("reminder", "failed");
        }
      }
    }
  } catch (err) {
    console.error("Zoom mailing worker error:", err);
  } finally {
    zoomMailingRunning = false;
  }
}

// runZoomMailingWorker is invoked by the Honker `maintenance` queue (see boot).

// Build/version info for GET /api/version — lets you confirm which commit is
// actually live after a deploy (staging vs prod). The commit is baked at build
// time via GIT_COMMIT (see Dockerfile), with common platform env fallbacks, then
// a local `git` fallback for non-container runs; "unknown" if none resolve.
const SERVER_STARTED_AT = new Date().toISOString();
function resolveCommit() {
  const fromEnv =
    process.env.GIT_COMMIT ||
    process.env.SOURCE_COMMIT ||
    process.env.SOURCE_VERSION ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    process.env.GIT_SHA;
  if (fromEnv) return String(fromEnv).trim();
  try {
    const out = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    });
    if (out.success) return out.stdout.toString().trim();
  } catch {}
  return "unknown";
}
const GIT_COMMIT = resolveCommit();

// One-click Treffen-signup links for invite emails. When the delegate field is
// off we drop the ?delegiert query entirely (the endpoint defaults to
// non-delegate); when it's on we keep explicit ?delegiert=0 / =1 so the two
// buttons register the right status. `zoomJaDelegiertUrl` is "" when off so the
// {{#zoomJaDelegiertUrl}} section in the template is stripped.
function treffenSignupUrls(idOrToken, showDelegierter) {
  const base = `${BASE_URL}/api/treffen-anmelden/${idOrToken}`;
  return {
    zoomJaUrl: showDelegierter ? `${base}?delegiert=0` : base,
    zoomJaDelegiertUrl: showDelegierter ? `${base}?delegiert=1` : "",
  };
}

const server = Bun.serve({
  port: PORT,
  development: isDev,

  routes: {
    "/": homepage,
    [adminRoute]: admin,
    "/abmelden/:token": homepage,

    "/og.png": {
      async GET() {
        const { readFile } = await import("node:fs/promises");
        try {
          const buf = await readFile(
            new URL("../public/og.png", import.meta.url),
          );
          return new Response(buf, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=86400",
            },
          });
        } catch {
          return new Response("", { status: 404 });
        }
      },
    },

    "/api/version": {
      GET(req) {
        const blocked = denyRate(req, "version", 60, 60 * 1000);
        if (blocked) return blocked;
        return json(
          {
            commit: GIT_COMMIT,
            letter: LETTER_NAME,
            env: process.env.NODE_ENV || "development",
            runtime: `bun ${Bun.version}`,
            startedAt: SERVER_STARTED_AT,
          },
          200,
          { "Cache-Control": "no-store" },
        );
      },
    },

    "/robots.txt": {
      GET() {
        const body = [
          "User-agent: *",
          "Allow: /",
          "",
          "Disallow: /api/",
          `Disallow: /${ADMIN_PATH}`,
          "",
          `Sitemap: ${BASE_URL}/sitemap.xml`,
        ].join("\n");
        return new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },

    "/sitemap.xml": {
      GET() {
        const now = new Date().toISOString().split("T")[0];
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          "  <url>",
          `    <loc>${BASE_URL}/</loc>`,
          `    <lastmod>${now}</lastmod>`,
          "    <changefreq>daily</changefreq>",
          "    <priority>1.0</priority>",
          "  </url>",
          "</urlset>",
        ].join("\n");
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      },
    },

    "/api/health": {
      async GET() {
        const db = await healthCheck();
        return json({ ok: db, db }, db ? 200 : 503);
      },
    },

    // Issues a short-lived public session token for the frontend. Rate-limited
    // per IP so a bot can't farm tokens; the endpoints themselves are also
    // per-IP rate-limited, which is the actual throttle on data access.
    "/api/session": {
      async GET(req) {
        const ip = getClientIp(req);
        const { allowed, retryAfter } = checkRateLimit(
          ip,
          "session",
          60,
          15 * 60 * 1000,
        );
        if (!allowed) {
          return json({ error: "Zu viele Anfragen." }, 429, {
            "Retry-After": String(retryAfter),
          });
        }
        return json({
          token: await createPublicToken(),
          expiresIn: PUBLIC_TOKEN_TTL_SECONDS,
        });
      },
    },

    "/api/stats": {
      async GET(req) {
        const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
        if (blocked) return blocked;
        try {
          const [stats, milestones] = await Promise.all([
            getStats(),
            getMilestones(),
          ]);
          const goal =
            milestones.find((m) => m > stats.total) ??
            milestones[milestones.length - 1];
          return json({ ...stats, milestones, goal });
        } catch (err) {
          console.error("GET /api/stats error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/occupations": {
      async GET(req) {
        const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
        if (blocked) return blocked;
        try {
          const occupations = await getOccupations();
          return json(occupations);
        } catch (err) {
          console.error("GET /api/occupations error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/kreisverband-stats": {
      async GET(req) {
        const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
        if (blocked) return blocked;
        try {
          const stats = await getKreisverbandStats();
          return json(stats);
        } catch (err) {
          console.error("GET /api/kreisverband-stats error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/state-stats": {
      async GET(req) {
        const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
        if (blocked) return blocked;
        try {
          const stats = await getStateStats();
          return json(stats);
        } catch (err) {
          console.error("GET /api/state-stats error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/signers": {
      async GET(req) {
        const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
        if (blocked) return blocked;
        try {
          const url = new URL(req.url);
          const filter = url.searchParams.get("filter") || "alle";
          const search = url.searchParams.get("search") || "";
          const limit = parseInt(url.searchParams.get("limit") || "18", 10);
          const offset = parseInt(url.searchParams.get("offset") || "0", 10);
          const sort = url.searchParams.get("sort") || "desc";
          const result = await getSigners({
            filter,
            search,
            limit,
            offset,
            sort,
          });
          return json(result);
        } catch (err) {
          console.error("GET /api/signers error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/sign": {
      async POST(req) {
        try {
          const ip = getClientIp(req);
          const { allowed, retryAfter } = checkRateLimit(
            ip,
            "sign",
            30,
            15 * 60 * 1000,
          );
          if (!allowed) {
            return json(
              { error: "Zu viele Anfragen. Bitte versuche es später erneut." },
              429,
              { "Retry-After": String(retryAfter) },
            );
          }

          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const name = sanitize(body.name);
          const email = sanitizeEmail(body.email);
          const kv = sanitize(body.kv || "").replace(/^KV\s*/i, "");
          const occupation = sanitize(body.occupation || "");
          const newsletter = Boolean(body.newsletter);
          const showPublicly = body.agree === true;

          if (name.length < 2) {
            return json(
              { error: "Name muss mindestens 2 Zeichen lang sein." },
              400,
            );
          }
          if (!isValidEmail(email)) {
            return json(
              { error: "Bitte gib eine gültige E-Mail-Adresse an." },
              400,
            );
          }

          const token = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

          const { ok, alreadyVerified } = await insertSigner({
            name,
            email,
            kv,
            occupation,
            newsletter,
            showPublicly,
            token,
            expiresAt,
          });

          if (!ok && alreadyVerified) {
            const verifiedName = await getVerifiedSignerName(email);
            if (verifiedName) {
              const unsub = await refreshUnsubscribeTokenByEmail(email);
              const baseUrl = getBaseUrl(req);
              const headers = unsub
                ? buildUnsubscribeHeaders(
                    `${baseUrl}/api/unsubscribe/${unsub}/opt-out`,
                  )
                : undefined;
              const unsubscribeUrl = unsub
                ? `${baseUrl}/abmelden/${unsub}`
                : undefined;
              await sendAlreadySignedEmail({
                to: email,
                name: verifiedName,
                headers,
                unsubscribeUrl,
              });
            }
            return json({ ok: true });
          }

          const unsub = await refreshUnsubscribeTokenByEmail(email);
          const baseUrl = getBaseUrl(req);
          const unsubHeaders = unsub
            ? buildUnsubscribeHeaders(
                `${baseUrl}/api/unsubscribe/${unsub}/opt-out`,
              )
            : undefined;
          const unsubscribeUrl = unsub
            ? `${baseUrl}/abmelden/${unsub}`
            : undefined;
          await sendVerificationEmail({
            to: email,
            name,
            token,
            baseUrl,
            headers: unsubHeaders,
            unsubscribeUrl,
          });

          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/sign error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/zoom-register": {
      async POST(req) {
        try {
          const ip = getClientIp(req);
          const { allowed, retryAfter } = checkRateLimit(
            ip,
            "zoom",
            30,
            15 * 60 * 1000,
          );
          if (!allowed) {
            return json(
              { error: "Zu viele Anfragen. Bitte versuche es später erneut." },
              429,
              { "Retry-After": String(retryAfter) },
            );
          }

          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const name = sanitize(body.name);
          const email = sanitizeEmail(body.email);
          const kv = sanitize(body.kv || "").replace(/^KV\s*/i, "");
          const zoomCfg = await getZoomConfig();
          // Never accept a delegate flag while the field is turned off, even if a
          // crafted request sends one.
          const delegierter =
            zoomCfg.showDelegierter && Boolean(body.delegierter);

          if (name.length < 2) {
            return json(
              { error: "Name muss mindestens 2 Zeichen lang sein." },
              400,
            );
          }
          if (!isValidEmail(email)) {
            return json(
              { error: "Bitte gib eine gültige E-Mail-Adresse an." },
              400,
            );
          }

          const reg = await insertZoomRegistration({
            name,
            email,
            kv,
            delegierter,
          });

          try {
            await sendZoomSignupEmail({ regId: reg.id, name, email, cfg: zoomCfg });
          } catch (mailErr) {
            console.error("zoom registration email failed:", mailErr);
          }

          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/zoom-register error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/zoom-count": {
      async GET(req) {
        const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
        if (blocked) return blocked;
        try {
          const [countRow, cfg] = await Promise.all([
            getZoomRegistrationCount(),
            getZoomConfig(),
          ]);
          return json({
            ...countRow,
            eventAt: cfg.eventAtIso,
            showDelegierter: cfg.showDelegierter,
            mode: cfg.mode,
            location: cfg.location,
            navLabel: cfg.navLabel,
            label: cfg.label,
          });
        } catch (err) {
          console.error("GET /api/zoom-count error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/termin.ics": {
      async GET(req) {
        const blocked = denyRate(req, "ics", 60, 15 * 60 * 1000);
        if (blocked) return blocked;
        const cfg = await getZoomConfig();
        if (!cfg.dateSet) {
          return new Response("Termin noch nicht festgelegt.", { status: 404 });
        }
        const ics = buildZoomEventIcs(cfg, {
          includeLink: Boolean(cfg.link) && isLinkWindowOpen(cfg),
        });
        return new Response(ics, {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="termin.ics"',
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },

    "/api/resend-verification": {
      async POST(req) {
        try {
          const ip = getClientIp(req);
          const { allowed, retryAfter } = checkRateLimit(
            ip,
            "resend",
            12,
            15 * 60 * 1000,
          );
          if (!allowed) {
            return json(
              { error: "Zu viele Anfragen. Bitte versuche es später erneut." },
              429,
              { "Retry-After": String(retryAfter) },
            );
          }

          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const email = sanitizeEmail(body.email);
          if (!isValidEmail(email)) return json({ ok: true });

          const token = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          const name = await refreshVerificationToken(email, token, expiresAt);

          if (name) {
            const unsub = await refreshUnsubscribeTokenByEmail(email);
            const baseUrl = getBaseUrl(req);
            const unsubHeaders = unsub
              ? buildUnsubscribeHeaders(
                  `${baseUrl}/api/unsubscribe/${unsub}/opt-out`,
                )
              : undefined;
            const unsubscribeUrl = unsub
              ? `${baseUrl}/abmelden/${unsub}`
              : undefined;
            await sendVerificationEmail({
              to: email,
              name,
              token,
              baseUrl,
              headers: unsubHeaders,
              unsubscribeUrl,
            });
          }

          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/resend-verification error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/confirm/:token": {
      async GET(req) {
        const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          const { token } = req.params;
          const signer = await confirmSigner(token);

          if (signer) {
            if (cfg.features.stateResolution && signer.kreisverband) {
              enqueueStateResolution(signer.id, signer.kreisverband);
            }
            return Response.redirect(`${getBaseUrl(req)}/?confirmed=1`, 302);
          }
          return Response.redirect(
            `${getBaseUrl(req)}/?error=token-expired`,
            302,
          );
        } catch (err) {
          console.error("GET /api/confirm error:", err);
          return Response.redirect(`${BASE_URL}/?error=server-error`, 302);
        }
      },
    },

    "/api/request-deletion": {
      async POST(req) {
        try {
          const ip = getClientIp(req);
          const { allowed, retryAfter } = checkRateLimit(
            ip,
            "deletion",
            12,
            15 * 60 * 1000,
          );
          if (!allowed) {
            return json({ ok: true }, 200, {
              "Retry-After": String(retryAfter),
            });
          }

          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const email = sanitizeEmail(body.email);

          if (!isValidEmail(email)) {
            return json({ ok: true });
          }

          const token = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

          const found = await createDeletionToken(email, token, expiresAt);
          if (found) {
            const unsub = await refreshUnsubscribeTokenByEmail(email);
            const baseUrl = getBaseUrl(req);
            const unsubHeaders = unsub
              ? buildUnsubscribeHeaders(
                  `${baseUrl}/api/unsubscribe/${unsub}/opt-out`,
                )
              : undefined;
            const unsubscribeUrl = unsub
              ? `${baseUrl}/abmelden/${unsub}`
              : undefined;
            await sendDeletionEmail({
              to: email,
              token,
              baseUrl,
              headers: unsubHeaders,
              unsubscribeUrl,
            });
          }

          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/request-deletion error:", err);
          return json({ ok: true });
        }
      },
    },

    "/api/delete/:token": {
      async GET(req) {
        const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          const { token } = req.params;
          const deleted = await deleteSigner(token);

          if (deleted) {
            return Response.redirect(`${getBaseUrl(req)}/?deleted=1`, 302);
          }
          return Response.redirect(
            `${getBaseUrl(req)}/?error=delete-token-expired`,
            302,
          );
        } catch (err) {
          console.error("GET /api/delete error:", err);
          return Response.redirect(`${BASE_URL}/?error=server-error`, 302);
        }
      },
    },

    // ---- Unified unsubscribe (serves both newsletter and zoom tokens) ----

    "/api/unsubscribe/:token": {
      async GET(req) {
        const blocked = denyRate(req, "unsub", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          const url = new URL(req.url);
          const source =
            url.searchParams.get("from") === "zoom" ? "zoom" : "newsletter";
          const state = await getUnifiedUnsubscribeState(
            req.params.token,
            source,
          );
          if (!state) return json({ ok: false }, 404);
          return json({ ok: true, ...state });
        } catch (err) {
          console.error("GET /api/unsubscribe error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    // One-click List-Unsubscribe for newsletter (RFC 8058, no UI)
    "/api/unsubscribe/:token/opt-out": {
      async POST(req) {
        const blocked = denyRate(req, "unsub", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          const ok = await optOutNewsletter(req.params.token);
          if (!ok) return json({ ok: false }, 404);
          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/unsubscribe/opt-out error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    // Granular actions via the unified page
    "/api/unsubscribe/:token/newsletter-opt-out": {
      async POST(req) {
        const blocked = denyRate(req, "unsub", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          const email = await resolveEmailFromToken(req.params.token);
          if (!email) return json({ ok: false }, 404);
          await optOutNewsletterByEmail(email);
          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/unsubscribe/newsletter-opt-out error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/unsubscribe/:token/zoom-opt-out": {
      async POST(req) {
        const blocked = denyRate(req, "unsub", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          const email = await resolveEmailFromToken(req.params.token);
          if (!email) return json({ ok: false }, 404);
          await deleteZoomByEmail(email);
          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/unsubscribe/zoom-opt-out error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/unsubscribe/:token/all": {
      async POST(req) {
        const blocked = denyRate(req, "unsub", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          const email = await resolveEmailFromToken(req.params.token);
          if (!email) return json({ ok: false }, 404);
          await Promise.all([
            optOutNewsletterByEmail(email),
            deleteZoomByEmail(email),
          ]);
          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/unsubscribe/all error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    // Self-service field editing for the holder of an unsubscribe token.
    // Possession of the token (sent only to the address itself) authorizes
    // editing that address's signer and/or zoom registration fields.
    "/api/unsubscribe/:token/update": {
      async POST(req) {
        try {
          const ip = getClientIp(req);
          const { allowed, retryAfter } = checkRateLimit(
            ip,
            "unsub-update",
            30,
            15 * 60 * 1000,
          );
          if (!allowed) {
            return json(
              { error: "Zu viele Anfragen. Bitte versuche es später erneut." },
              429,
              { "Retry-After": String(retryAfter) },
            );
          }

          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);

          const email = await resolveEmailFromToken(req.params.token);
          if (!email) return json({ ok: false }, 404);

          const body = await parseJsonBody(req);
          const name = sanitize(body.name || "");
          const kv = sanitize(body.kv || "").replace(/^KV\s*/i, "");
          const occupation = sanitize(body.occupation || "");
          const newsletter = Boolean(body.newsletter);
          const showPublicly = Boolean(body.showPublicly);
          // Only honor the delegate flag while the field is enabled.
          const delegierter =
            (await getShowDelegierter()) && Boolean(body.delegierter);

          if (name.length < 2) {
            return json(
              { error: "Name muss mindestens 2 Zeichen lang sein." },
              400,
            );
          }

          await updateSignerByEmail(email, {
            name,
            kreisverband: kv,
            occupation,
            newsletter,
            showPublicly,
          });
          await updateZoomByEmail(email, {
            name,
            kreisverband: kv,
            delegierter,
          });

          const url = new URL(req.url);
          const source =
            url.searchParams.get("from") === "zoom" ? "zoom" : "newsletter";
          const state = await getUnifiedUnsubscribeState(
            req.params.token,
            source,
          );
          return json({ ok: true, ...state });
        } catch (err) {
          console.error("POST /api/unsubscribe/update error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/unsubscribe/:token/delete": {
      async POST(req) {
        const blocked = denyRate(req, "unsub", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          const ok = await deleteSignerByUnsubscribeToken(req.params.token);
          if (!ok) return json({ ok: false }, 404);
          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/unsubscribe/delete error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    // Redirect old zoom unsubscribe links to the unified page
    "/api/zoom-abmelden/:token": {
      GET(req) {
        const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        const token = encodeURIComponent(req.params.token);
        return Response.redirect(
          `${getBaseUrl(req)}/abmelden/${token}?from=zoom`,
          302,
        );
      },
    },

    // Back-compat: invite emails sent before the rename used /api/zoom-anmelden.
    // Redirect (preserving any ?delegiert query) to the current path.
    "/api/zoom-anmelden/:token": {
      GET(req) {
        const u = new URL(req.url);
        const dest =
          u.origin +
          u.pathname.replace(
            "/api/zoom-anmelden/",
            "/api/treffen-anmelden/",
          ) +
          u.search;
        return Response.redirect(dest, 301);
      },
    },

    // One-click Treffen registration from newsletter invite email.
    // The token is the signer's unsubscribe_token (fresh per campaign send).
    // These signup links do not expire based on the token age.
    // ?delegiert=1 → registers as delegate, ?delegiert=0 (or omitted) → non-delegate.
    "/api/treffen-anmelden/:token": {
      async GET(req) {
        const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        const { token } = req.params;
        const force = req.url.includes("force=1");
        const zoomCfg = await getZoomConfig();
        // When the delegate field is off, ignore any ?delegiert=1 in the link so a
        // stale email button can't register someone as a delegate.
        const delegiert =
          zoomCfg.showDelegierter && req.url.includes("delegiert=1");
        try {
          const signer = await getSignerForZoomInvite(token);
          if (!signer) {
            return new Response(
              zoomUnsubPage(
                `<h1>Link abgelaufen</h1><p>Dieser Link ist leider nicht mehr g\u00fcltig. Du kannst dich auf <a href="${BASE_URL}/#zoom">gehaltsdeckel.jetzt</a> direkt anmelden.</p>`,
              ),
              {
                status: 410,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              },
            );
          }

          const existing = await getZoomRegistrationByEmail(signer.email);

          if (existing && !force) {
            const firstName = sanitize(signer.name.split(/\s/)[0]);
            // The delegate status + toggle only make sense while the field is on;
            // when off, show a neutral "registriert" line with no toggle.
            const currentStatus = !zoomCfg.showDelegierter
              ? ""
              : existing.delegierter
                ? " als <strong>Delegierte*r</strong>"
                : " als einfache*r Teilnehmer*in";
            let toggleBlock = "";
            if (zoomCfg.showDelegierter) {
              const toggleLabel = existing.delegierter
                ? "Nicht als Delegierte*r anmelden"
                : "Als Delegierte*r anmelden";
              const toggleUrl = `${BASE_URL}/api/treffen-anmelden/${encodeURIComponent(token)}?delegiert=${existing.delegierter ? 0 : 1}&force=1`;
              toggleBlock = `<p><a href="${toggleUrl}" style="color:#e8001c;">${toggleLabel}</a></p>`;
            }
            const unsubUrl = existing.unsubscribe_token
              ? `${BASE_URL}/abmelden/${encodeURIComponent(existing.unsubscribe_token)}?from=zoom`
              : null;
            const unsubLink = unsubUrl
              ? `<p><a href="${unsubUrl}">Abmelden</a></p>`
              : "";
            return new Response(
              zoomUnsubPage(
                `<h1>Du bist bereits angemeldet</h1><p>Hallo <strong>${firstName}</strong>, du bist bereits${currentStatus} f\u00fcr das Treffen registriert.</p>${toggleBlock}${unsubLink}`,
              ),
              {
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  ...securityHeaders,
                },
              },
            );
          }

          const isNew = !existing;

          const reg = await insertZoomRegistration({
            name: signer.name,
            email: signer.email,
            kv: signer.kreisverband,
            delegierter: delegiert,
          });

          if (isNew) {
            try {
              await sendZoomSignupEmail({
                regId: reg.id,
                name: signer.name,
                email: signer.email,
                cfg: zoomCfg,
              });
            } catch (mailErr) {
              console.error(
                "[treffen-anmelden] confirmation email failed:",
                mailErr,
              );
            }
          }

          const delegateNote = delegiert
            ? `<p>Du hast dich als <strong>Delegierte*r</strong> angemeldet.</p>`
            : "";
          const updatedNote = !isNew
            ? `<p>Deine Anmeldung wurde aktualisiert.</p>`
            : "";
          return new Response(
            zoomUnsubPage(
              `<h1>Du bist dabei!</h1><p>Wir haben deine Anmeldung f\u00fcr das Treffen gespeichert, <strong>${sanitize(signer.name.split(/\s/)[0])}</strong>.</p>${delegateNote}${updatedNote}${buildMeetingInfo(zoomCfg, { pending: true, timingText: "kurz" })}`,
            ),
            {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                ...securityHeaders,
              },
            },
          );
        } catch (err) {
          console.error("GET /api/treffen-anmelden error:", err);
          return new Response(
            zoomUnsubPage(
              `<h1>Fehler</h1><p>Etwas ist schiefgelaufen. Bitte versuche es sp\u00e4ter erneut oder melde dich direkt auf <a href="${BASE_URL}/#zoom">gehaltsdeckel.jetzt</a> an.</p>`,
            ),
            {
              status: 500,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          );
        }
      },
    },

    // One-click List-Unsubscribe for zoom (RFC 8058, no UI)
    "/api/zoom-abmelden/:token/opt-out": {
      async POST(req) {
        const blocked = denyRate(req, "unsub", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        try {
          await deleteZoomRegistrationByUnsubscribeToken(req.params.token);
          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/zoom-abmelden/opt-out error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/admin/login": {
      async POST(req) {
        try {
          const ip = getClientIp(req);
          const { allowed, retryAfter } = checkRateLimit(
            ip,
            "admin-login",
            5,
            15 * 60 * 1000,
          );
          if (!allowed) {
            return json({ error: "Zu viele Anmeldeversuche." }, 429, {
              "Retry-After": String(retryAfter),
            });
          }

          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const ok = await constantTimePasswordMatches(body.password);
          if (!ok) return json({ error: "Unauthorized" }, 401);

          return json({ token: await createAdminToken() });
        } catch (err) {
          console.error("POST /api/admin/login error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/admin/templates": {
      async GET(req) {
        return adminJson(req, async () => json(await listEmailTemplates()));
      },
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const name = sanitize(body.name, 120);
          const subject = sanitize(body.subject, 240);
          const htmlBody = sanitizeHtml(body.html_body);
          if (!name || !subject || !htmlBody) {
            return json({ error: "Missing fields" }, 400);
          }
          return json(
            await createEmailTemplate({ name, subject, htmlBody }),
            201,
          );
        });
      },
    },

    "/api/admin/templates/:id": {
      async GET(req) {
        return adminJson(req, async () => {
          const template = await getEmailTemplate(parseInt(req.params.id, 10));
          if (!template) return json({ error: "Not found" }, 404);
          return json(template);
        });
      },
      async PUT(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const subject = sanitize(body.subject, 240);
          const htmlBody = sanitizeHtml(body.html_body);
          if (!subject || !htmlBody)
            return json({ error: "Missing fields" }, 400);
          const template = await updateEmailTemplate(
            parseInt(req.params.id, 10),
            {
              subject,
              htmlBody,
            },
          );
          if (!template) return json({ error: "Not found" }, 404);
          return json(template);
        });
      },
      async DELETE(req) {
        return adminJson(req, async () => {
          const deleted = await deleteEmailTemplate(
            parseInt(req.params.id, 10),
          );
          if (!deleted) return json({ error: "Cannot delete template" }, 400);
          return json({ ok: true });
        });
      },
    },

    "/api/admin/campaigns": {
      async GET(req) {
        return adminJson(req, async () => json(await listCampaigns()));
      },
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const templateId = parseInt(body.template_id, 10);
          const subject = sanitize(body.subject, 240);
          const scheduledAt = new Date(body.scheduled_at);
          const audience = [
            "newsletter",
            "zoom",
            "zoom_delegates",
            "selection",
            "email_not_zoom",
          ].includes(body.audience)
            ? body.audience
            : "newsletter";
          if (!templateId || !subject || Number.isNaN(scheduledAt.getTime())) {
            return json({ error: "Invalid campaign" }, 400);
          }
          let recipientIds = null;
          if (audience === "selection") {
            const raw = Array.isArray(body.recipient_ids)
              ? body.recipient_ids
              : [];
            recipientIds = [
              ...new Set(
                raw
                  .map((id) => parseInt(id, 10))
                  .filter((id) => Number.isInteger(id) && id > 0),
              ),
            ];
            if (recipientIds.length === 0) {
              return json({ error: "Keine Empfänger*innen ausgewählt" }, 400);
            }
            if (recipientIds.length > 20000) {
              return json(
                { error: "Zu viele Empfänger*innen (max. 20000)" },
                400,
              );
            }
          }
          const campaign = await createCampaign({
            templateId,
            subject,
            scheduledAt,
            audience,
            recipientIds,
          });
          if (!campaign) return json({ error: "Template not found" }, 404);
          // Durable send job, delivered at the scheduled time.
          await enqueueJob(
            "campaigns",
            { campaignId: campaign.id },
            { runAt: Math.floor(scheduledAt.getTime() / 1000), maxAttempts: 5 },
          );
          return json(campaign, 201);
        });
      },
    },

    "/api/admin/campaigns/:id": {
      async DELETE(req) {
        return adminJson(req, async () => {
          const deleted = await cancelCampaign(parseInt(req.params.id, 10));
          if (!deleted) return json({ error: "Cannot cancel campaign" }, 400);
          return json({ ok: true });
        });
      },
    },

    "/api/admin/newsletter-signers": {
      async GET(req) {
        return adminJson(req, async () => {
          const filters = parseSignerFilters(req);
          const limit = parseInt(
            new URL(req.url).searchParams.get("limit") || "25",
            10,
          );
          const offset = parseInt(
            new URL(req.url).searchParams.get("offset") || "0",
            10,
          );
          const result = await listNewsletterSigners({
            ...filters,
            limit: Number.isNaN(limit) ? 25 : limit,
            offset: Number.isNaN(offset) ? 0 : offset,
          });
          return json(result);
        });
      },
    },

    "/api/admin/newsletter-signer-filters": {
      async GET(req) {
        return adminJson(req, async () =>
          json(await getNewsletterSignerFilters()),
        );
      },
    },

    "/api/admin/newsletter-signer-ids": {
      async GET(req) {
        return adminJson(req, async () => {
          const ids = await listNewsletterSignerIds(parseSignerFilters(req));
          return json({ ids });
        });
      },
    },

    "/api/admin/stats": {
      async GET(req) {
        return adminJson(req, async () => {
          const [newsletter, zoom] = await Promise.all([
            getNewsletterStats(),
            getZoomCounts(),
          ]);
          return json({ ...newsletter, ...zoom });
        });
      },
    },

    "/api/admin/zoom-registrations": {
      async GET(req) {
        return adminJson(req, async () => json(await listZoomRegistrations()));
      },
    },

    "/api/admin/zoom-registrations/clear": {
      async POST(req) {
        return adminJson(req, async () => {
          const removed = await clearZoomRegistrations();
          return json({ ok: true, removed });
        });
      },
    },

    "/api/admin/zoom-mailings": {
      async GET(req) {
        return adminJson(req, async () => {
          const cfg = await getZoomConfig();
          return json({
            eventAt: cfg.eventAtIso,
            eventLabel: cfg.label,
            durationMin: cfg.durationMin,
            linkOffsetHours: cfg.linkOffsetHours,
            reminderOffsetHours: cfg.reminderOffsetHours,
            link: cfg.link,
            hasLink: Boolean(cfg.link),
            showDelegierter: cfg.showDelegierter,
            mode: cfg.mode,
            location: cfg.location,
            eventLabelFallback: cfg.eventLabelFallback,
            navLabel: cfg.navLabel,
            mailings: await listZoomMailings(),
          });
        });
      },
    },

    "/api/admin/zoom-settings": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const eventDate = new Date(body.eventAt);
          if (Number.isNaN(eventDate.getTime())) {
            return json({ error: "Ungültiges Datum" }, 400);
          }
          const linkOffsetHours = parseInt(body.linkOffsetHours, 10);
          const reminderOffsetHours = parseInt(body.reminderOffsetHours, 10);
          if (
            !Number.isInteger(linkOffsetHours) ||
            linkOffsetHours < 0 ||
            !Number.isInteger(reminderOffsetHours) ||
            reminderOffsetHours < 0
          ) {
            return json({ error: "Ungültige Timing-Werte" }, 400);
          }

          const prev = await getZoomConfig();
          const eventChanged = eventDate.toISOString() !== prev.eventAtIso;

          const zoomLink = String(body.zoomLink ?? "").trim();
          await setZoomSettings({
            zoom_event_at: eventDate.toISOString(),
            zoom_link_offset_hours: linkOffsetHours,
            zoom_reminder_offset_hours: reminderOffsetHours,
            zoom_link: zoomLink,
            // Ported operational settings (admin-editable, no redeploy).
            zoom_show_delegierter: body.showDelegierter ? "1" : "0",
            zoom_mode: body.mode === "inperson" ? "inperson" : "online",
            zoom_location_name: String(body.locationName ?? "").trim(),
            zoom_location_address: String(body.locationAddress ?? "").trim(),
            zoom_location_maps_url: String(body.locationMapsUrl ?? "").trim(),
            zoom_event_label: String(body.eventLabel ?? "").trim(),
            zoom_nav_label: String(body.navLabel ?? "").trim(),
          });
          if (eventChanged) await resetZoomMailings();

          const cfg = await getZoomConfig();
          return json({
            ok: true,
            mailingsReset: eventChanged,
            eventAt: cfg.eventAtIso,
            eventLabel: cfg.label,
            linkOffsetHours: cfg.linkOffsetHours,
            reminderOffsetHours: cfg.reminderOffsetHours,
            showDelegierter: cfg.showDelegierter,
            mode: cfg.mode,
            location: cfg.location,
            eventLabelFallback: cfg.eventLabelFallback,
            navLabel: cfg.navLabel,
          });
        });
      },
    },

    "/api/admin/milestones": {
      async GET(req) {
        return adminJson(req, async () =>
          json({ milestones: await getMilestones() }),
        );
      },
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          if (!Array.isArray(body.milestones)) {
            return json({ error: "milestones muss ein Array sein" }, 400);
          }
          try {
            const milestones = await setMilestones(body.milestones);
            return json({ ok: true, milestones });
          } catch (e) {
            return json({ error: e.message || "Ungültige Meilensteine" }, 400);
          }
        });
      },
    },

    "/api/admin/zoom-test-send": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const to = String(body.to || "").trim();
          const kind = body.kind;
          if (!to || !isValidEmail(to)) {
            return json({ error: "Ungültige E-Mail-Adresse" }, 400);
          }
          if (!["confirmation", "link", "reminder"].includes(kind)) {
            return json({ error: "Unbekannter Mail-Typ" }, 400);
          }
          const cfg = await getZoomConfig();
          if (kind === "confirmation") {
            await sendZoomConfirmationEmail({
              to,
              name: "Test-Empfänger",
              eventLabel: cfg.label,
              eventWhen: cfg.whenPhrase,
              linkInfo: buildMeetingInfo(cfg, {
                pending: true,
                timingText: offsetPhrase(cfg.linkOffsetHours),
              }),
            });
          } else {
            const payload = await buildZoomMailPayload(
              kind,
              { name: "Test-Empfänger", email: to },
              "test",
              cfg,
            );
            await sendRenderedEmail({
              ...payload,
              subject: `[TEST] ${payload.subject}`,
            });
          }
          return json({ ok: true });
        });
      },
    },

    "/api/admin/preview": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const cfg = await getZoomConfig();
          return json({
            html: renderEmailHtml(sanitizeHtml(body.html_body), {
              name: "Ada Beispiel",
              firstName: "Ada",
              signerCount: "1.000",
              unsubscribeUrl: `${BASE_URL}/abmelden/beispiel`,
              eventLabel: cfg.label,
              zoomLink: cfg.link,
              linkInfo: buildMeetingInfo(cfg),
              ...treffenSignupUrls("beispiel", cfg.showDelegierter),
            }),
          });
        });
      },
    },

    "/api/admin/test-send": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const to = String(body.to || "").trim();
          const templateId = parseInt(body.template_id, 10);
          if (!to || !isValidEmail(to)) {
            return json({ error: "Ungültige E-Mail-Adresse" }, 400);
          }
          if (!templateId) {
            return json({ error: "Keine Vorlage ausgewählt" }, 400);
          }
          const template = await getEmailTemplate(templateId);
          if (!template) {
            return json({ error: "Vorlage nicht gefunden" }, 404);
          }
          const audience = [
            "newsletter",
            "zoom",
            "zoom_delegates",
            "email_not_zoom",
          ].includes(body.audience)
            ? body.audience
            : "newsletter";
          const isZoom = audience === "zoom" || audience === "zoom_delegates";
          const stats = await getNewsletterStats();
          const signerCount = stats.signerCount?.toLocaleString("de-DE") || "0";
          const zoomCfg = await getZoomConfig();
          const realRecipient = isZoom
            ? await getZoomRecipientByEmail(to)
            : await getNewsletterRecipientByEmail(to);
          let vars;
          let optOutUrl;
          if (realRecipient) {
            const firstName = realRecipient.name.split(/\s/)[0];
            if (isZoom) {
              const token = await refreshZoomUnsubscribeToken(realRecipient.id);
              const unsubscribeUrl = `${BASE_URL}/abmelden/${token}?from=zoom`;
              optOutUrl = `${BASE_URL}/api/zoom-abmelden/${token}/opt-out`;
              vars = {
                name: realRecipient.name,
                firstName,
                eventLabel: zoomCfg.label,
                zoomLink: zoomCfg.link,
                linkInfo: buildMeetingInfo(zoomCfg),
                unsubscribeUrl,
              };
            } else {
              const token = await refreshUnsubscribeToken(realRecipient.id);
              const unsubscribeUrl = `${BASE_URL}/abmelden/${token}`;
              optOutUrl = `${BASE_URL}/api/unsubscribe/${token}/opt-out`;
              vars = {
                name: realRecipient.name,
                firstName,
                signerCount,
                eventLabel: zoomCfg?.label || "",
                linkInfo: buildMeetingInfo(zoomCfg),
                unsubscribeUrl,
                ...treffenSignupUrls(token, zoomCfg?.showDelegierter),
              };
            }
          } else {
            optOutUrl = isZoom
              ? `${BASE_URL}/api/zoom-abmelden/test/opt-out`
              : `${BASE_URL}/api/unsubscribe/test/opt-out`;
            vars = isZoom
              ? {
                  name: "Test-Empfänger",
                  firstName: "Test-Empfänger",
                  eventLabel: zoomCfg.label,
                  zoomLink: zoomCfg.link,
                  linkInfo: buildMeetingInfo(zoomCfg),
                  unsubscribeUrl: `${BASE_URL}/abmelden/test?from=zoom`,
                }
              : {
                  name: "Test-Empfänger",
                  firstName: "Test-Empfänger",
                  signerCount,
                  eventLabel: zoomCfg?.label || "",
                  linkInfo: buildMeetingInfo(zoomCfg),
                  unsubscribeUrl: `${BASE_URL}/abmelden/test`,
                  ...treffenSignupUrls("test", zoomCfg?.showDelegierter),
                };
          }
          const html = renderEmailHtml(template.html_body, vars);
          const subject = interpolateTemplate(
            String(body.subject || template.subject || ""),
            vars,
          );
          const testUnsubHeaders = buildUnsubscribeHeaders(optOutUrl);
          await sendRenderedEmail({
            to,
            subject: `[TEST] ${subject}`,
            html,
            headers: testUnsubHeaders,
          });
          return json({ ok: true });
        });
      },
    },

    "/api/admin/resolve-states": {
      async POST(req) {
        return adminJson(req, async () => {
          const enqueued = await triggerBackfill();
          return json({ ok: true, enqueued });
        });
      },
    },

    "/api/admin/state-resolution-status": {
      async GET(req) {
        return adminJson(req, async () => {
          const stats = await getStateResolutionStats();
          return json({ ...stats, queueLength: getQueueLength() });
        });
      },
    },

    "/api/admin/kv-outliers": {
      async GET(req) {
        return adminJson(req, async () => {
          const [kvs, dismissed] = await Promise.all([
            getDistinctKreisverbands(),
            loadKvNotTypo(),
          ]);
          const dismissedSet = new Set(
            dismissed.map((d) => `${d.canonical}\0${d.outlier}`),
          );
          const groups = findOutlierGroups(kvs)
            .map((g) => ({
              ...g,
              outliers: g.outliers.filter(
                (o) => !dismissedSet.has(`${g.canonical.name}\0${o.name}`),
              ),
            }))
            .filter((g) => g.outliers.length > 0);
          return json(groups);
        });
      },
    },

    "/api/admin/merge-kv": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const from = String(body.from || "").trim();
          const to = String(body.to || "").trim();
          if (!from || !to || from === to) {
            return json({ error: "Ungültige Kreisverbände" }, 400);
          }
          const updated = await mergeKreisverband(from, to);
          await triggerBackfill();
          return json({ ok: true, updated });
        });
      },
    },

    "/api/admin/dismiss-outlier": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const canonical = String(body.canonical || "").trim();
          const outlier = String(body.outlier || "").trim();
          if (!canonical || !outlier) {
            return json({ error: "Ungültige Parameter" }, 400);
          }
          await insertKvNotTypo(canonical, outlier);
          return json({ ok: true });
        });
      },
    },

    "/api/admin/unresolved-kvs": {
      async GET(req) {
        return adminJson(req, async () => json(await getUnresolvedKvs()));
      },
    },

    "/api/admin/re-enqueue-all": {
      async POST(req) {
        return adminJson(req, async () => {
          const cleared = await clearEmptyKvCacheEntries();
          clearProcessedKvs();
          const enqueued = await triggerBackfill();
          return json({ ok: true, enqueued, cacheCleared: cleared });
        });
      },
    },

    "/api/admin/assign-kv-state": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const kreisverband = String(body.kreisverband || "").trim();
          const state = String(body.state || "").trim();
          if (!kreisverband || !state) {
            return json({ error: "kreisverband and state required" }, 400);
          }
          await upsertKvStateCache(kreisverband, state, "manual");
          const updated = await bulkUpdateSignerStateByKv(kreisverband, state);
          return json({ ok: true, updated });
        });
      },
    },

    "/api/admin/occupation-outliers": {
      async GET(req) {
        return adminJson(req, async () => {
          const [occupations, dismissed] = await Promise.all([
            getDistinctOccupations(),
            loadOccNotTypo(),
          ]);
          const dismissedSet = new Set(
            dismissed.map((d) => `${d.canonical}\0${d.outlier}`),
          );
          const groups = findOutlierGroups(
            occupations,
            "occupation",
            null,
            normalizeOccupation,
          )
            .map((g) => ({
              ...g,
              outliers: g.outliers.filter(
                (o) => !dismissedSet.has(`${g.canonical.name}\0${o.name}`),
              ),
            }))
            .filter((g) => g.outliers.length > 0);
          return json(groups);
        });
      },
    },

    "/api/admin/merge-occupation": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const from = String(body.from || "").trim();
          const to = String(body.to || "").trim();
          if (!from || !to || from === to) {
            return json({ error: "Ungültige Berufe" }, 400);
          }
          const updated = await mergeOccupation(from, to);
          return json({ ok: true, updated });
        });
      },
    },

    "/api/admin/dismiss-occupation-outlier": {
      async POST(req) {
        return adminJson(req, async () => {
          if (bodyTooLarge(req))
            return json({ error: "Payload too large" }, 413);
          const body = await parseJsonBody(req);
          const canonical = String(body.canonical || "").trim();
          const outlier = String(body.outlier || "").trim();
          if (!canonical || !outlier) {
            return json({ error: "Ungültige Parameter" }, 400);
          }
          await insertOccNotTypo(canonical, outlier);
          return json({ ok: true });
        });
      },
    },
  },

  fetch(req) {
    return json({ error: "Not found" }, 404);
  },
});

console.log(
  `Server running on ${server.url} (${isDev ? "development" : "production"})`,
);
// ---- Honker durable jobs: campaign sends, zoom mailings, hourly backups ----
async function handleMaintenanceJob({ task }) {
  if (task === "campaign-reconcile") {
    const ids = await getDueCampaignIds();
    for (const id of ids)
      await enqueueJob("campaigns", { campaignId: id }, { maxAttempts: 5 });
  } else if (task === "zoom") {
    await runZoomMailingWorker();
  } else if (task === "backup") {
    await runBackup();
  }
}

try {
  await initJobs();
  // Recurring schedules (persisted in the encrypted DB; survive restarts).
  await registerSchedule("campaign-reconcile", "maintenance", "@every 30s", {
    task: "campaign-reconcile",
  });
  await registerSchedule("zoom-mailings", "maintenance", "@every 60s", {
    task: "zoom",
  });
  await registerSchedule("hourly-backup", "maintenance", "0 * * * *", {
    task: "backup",
  });
  startWorker({
    campaigns: handleCampaignJob,
    maintenance: handleMaintenanceJob,
  });
} catch (err) {
  console.error("[jobs] init failed:", err);
}

// Kreisverband → Bundesland resolution (Nominatim) is optional and gated by the
// letter's feature flags.
if (cfg.features.stateResolution) {
  ensureKvStateCacheTable()
    .then(() => initStateCache())
    .then(() => startStateWorker())
    .catch((err) => {
      console.error("[state] init failed:", err);
      startStateWorker();
    });
}

function shutdown() {
  console.log("Shutting down...");
  stopWorker();
  close().then(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
