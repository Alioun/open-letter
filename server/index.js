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
// Zoom event defaults come from the active letter config; env overrides win.
const ZOOM_LINK = process.env.ZOOM_LINK || "";
const ZOOM_EVENT_AT_DEFAULT =
  process.env.ZOOM_EVENT_AT || cfg.zoom?.eventAt || "2026-06-09T20:00:00+02:00";
const ZOOM_EVENT_DURATION_MIN_DEFAULT = parseInt(
  process.env.ZOOM_EVENT_DURATION_MIN || String(cfg.zoom?.durationMin || 90),
  10,
);
const ZOOM_ICS_URL = `${BASE_URL}/api/zoom-termin.ics`;

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
  const eventAt = new Date(s.zoom_event_at || ZOOM_EVENT_AT_DEFAULT);
  const durationMin = parseInt(
    s.zoom_duration_min || String(ZOOM_EVENT_DURATION_MIN_DEFAULT),
    10,
  );
  const linkOffsetHours = parseInt(s.zoom_link_offset_hours || "24", 10);
  const reminderOffsetHours = parseInt(s.zoom_reminder_offset_hours || "2", 10);
  return {
    eventAt,
    eventAtIso: eventAt.toISOString(),
    durationMin,
    linkOffsetHours,
    reminderOffsetHours,
    link: s.zoom_link || ZOOM_LINK,
    label: formatZoomLabel(eventAt),
    icsUrl: ZOOM_ICS_URL,
  };
}

const ADMIN_PATH = normalizeAdminPath(process.env.ADMIN_PATH);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";

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
if (!isDev && (!API_TOKEN_SECRET || API_TOKEN_SECRET === ADMIN_JWT_SECRET)) {
  console.warn(
    "[security] API_TOKEN_SECRET is not set or equals ADMIN_JWT_SECRET — set a distinct API_TOKEN_SECRET for public API tokens.",
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
const API_TOKEN_SECRET = process.env.API_TOKEN_SECRET;
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

function buildZoomLinkInfo(zoomLink) {
  const linkPart = zoomLink
    ? `<p>Hier geht's direkt zum Zoom: <a href="${zoomLink}">${zoomLink}</a></p>`
    : `<p>Den Einwahllink schicken wir dir rechtzeitig vor dem Termin per E-Mail.</p>`;
  return linkPart + zoomCalendarButton(ZOOM_ICS_URL);
}

function buildZoomEventIcs(cfg, { includeLink = false } = {}) {
  const link = includeLink ? cfg.link : "";
  const desc = link
    ? `Zoom-Treffen der Initiative Gehaltsdeckel jetzt.\nEinwahl: ${link}`
    : `Zoom-Treffen der Initiative Gehaltsdeckel jetzt.\nDen Einwahllink bekommst du per E-Mail.`;
  return buildZoomIcs({
    start: cfg.eventAt,
    durationMin: cfg.durationMin,
    summary: "Zoom-Treffen - Gehaltsdeckel jetzt",
    description: desc,
    url: link,
    location: "Zoom",
    uid: `zoom-${cfg.eventAt.getTime()}@gehaltsdeckel.jetzt`,
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
  const zoomLinkInfo = zoomCfg ? buildZoomLinkInfo(zoomCfg.link) : "";

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
            linkInfo: zoomLinkInfo,
            unsubscribeUrl,
            zoomJaUrl: `${BASE_URL}/api/zoom-anmelden/${token}?delegiert=0`,
            zoomJaDelegiertUrl: `${BASE_URL}/api/zoom-anmelden/${token}?delegiert=1`,
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
    linkInfo: buildZoomLinkInfo(cfg.link),
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
        filename: "zoom-termin.ics",
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

  if (reminderSent || linkSent) {
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
      icsUrl: cfg.icsUrl,
      linkTimingText: offsetPhrase(cfg.linkOffsetHours),
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
          const body = await req.json();
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
          const body = await req.json();
          const name = sanitize(body.name);
          const email = sanitizeEmail(body.email);
          const kv = sanitize(body.kv || "").replace(/^KV\s*/i, "");
          const delegierter = Boolean(body.delegierter);

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
            const cfg = await getZoomConfig();
            await sendZoomSignupEmail({ regId: reg.id, name, email, cfg });
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
          return json({ ...countRow, eventAt: cfg.eventAtIso });
        } catch (err) {
          console.error("GET /api/zoom-count error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/zoom-termin.ics": {
      async GET(req) {
        const blocked = denyRate(req, "ics", 60, 15 * 60 * 1000);
        if (blocked) return blocked;
        const cfg = await getZoomConfig();
        const linkWindowOpen =
          cfg.link &&
          Date.now() >=
            cfg.eventAt.getTime() - cfg.linkOffsetHours * 60 * 60 * 1000;
        const ics = buildZoomEventIcs(cfg, {
          includeLink: Boolean(linkWindowOpen),
        });
        return new Response(ics, {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="zoom-termin.ics"',
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
          const body = await req.json();
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
          const body = await req.json();
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

          const body = await req.json();
          const name = sanitize(body.name || "");
          const kv = sanitize(body.kv || "").replace(/^KV\s*/i, "");
          const occupation = sanitize(body.occupation || "");
          const newsletter = Boolean(body.newsletter);
          const showPublicly = Boolean(body.showPublicly);
          const delegierter = Boolean(body.delegierter);

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

    // One-click zoom registration from newsletter invite email.
    // The token is the signer's unsubscribe_token (fresh per campaign send).
    // These zoom signup links do not expire based on the token age.
    // ?delegiert=1 → registers as delegate, ?delegiert=0 (default) → non-delegate.
    "/api/zoom-anmelden/:token": {
      async GET(req) {
        const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
        if (blocked) return blocked;
        const { token } = req.params;
        const delegiert = req.url.includes("delegiert=1");
        const force = req.url.includes("force=1");
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
            const currentStatus = existing.delegierter
              ? "als <strong>Delegierte*r</strong>"
              : "als einfache*r Teilnehmer*in";
            const toggleLabel = existing.delegierter
              ? "Nicht als Delegierte*r anmelden"
              : "Als Delegierte*r anmelden";
            const toggleUrl = `${BASE_URL}/api/zoom-anmelden/${encodeURIComponent(token)}?delegiert=${existing.delegierter ? 0 : 1}&force=1`;
            const unsubUrl = existing.unsubscribe_token
              ? `${BASE_URL}/abmelden/${encodeURIComponent(existing.unsubscribe_token)}?from=zoom`
              : null;
            const unsubLink = unsubUrl
              ? `<p><a href="${unsubUrl}">Abmelden</a></p>`
              : "";
            return new Response(
              zoomUnsubPage(
                `<h1>Du bist bereits angemeldet</h1><p>Hallo <strong>${firstName}</strong>, du bist bereits ${currentStatus} f\u00fcr das Zoom-Treffen registriert.</p><p><a href="${toggleUrl}" style="color:#e8001c;">${toggleLabel}</a></p>${unsubLink}`,
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

          const cfg = await getZoomConfig();

          if (isNew) {
            try {
              await sendZoomSignupEmail({
                regId: reg.id,
                name: signer.name,
                email: signer.email,
                cfg,
              });
            } catch (mailErr) {
              console.error(
                "[zoom-anmelden] confirmation email failed:",
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
              `<h1>Du bist dabei!</h1><p>Wir haben deine Anmeldung f\u00fcr das Zoom-Treffen gespeichert, <strong>${sanitize(signer.name.split(/\s/)[0])}</strong>.</p>${delegateNote}${updatedNote}<p>Du bekommst kurz vor dem Termin den Einwahllink per E-Mail.</p>${zoomCalendarButton(cfg.icsUrl)}`,
            ),
            {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                ...securityHeaders,
              },
            },
          );
        } catch (err) {
          console.error("GET /api/zoom-anmelden error:", err);
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
          const body = await req.json();
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
          const body = await req.json();
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
          const body = await req.json();
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
          const body = await req.json();
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
          const body = await req.json();
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
          const body = await req.json();
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
          const body = await req.json();
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
              icsUrl: cfg.icsUrl,
              linkTimingText: offsetPhrase(cfg.linkOffsetHours),
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
          const body = await req.json();
          const cfg = await getZoomConfig();
          return json({
            html: renderEmailHtml(sanitizeHtml(body.html_body), {
              name: "Ada Beispiel",
              firstName: "Ada",
              signerCount: "1.000",
              unsubscribeUrl: `${BASE_URL}/abmelden/beispiel`,
              eventLabel: cfg.label,
              zoomLink: cfg.link,
              linkInfo: buildZoomLinkInfo(cfg.link),
              zoomJaUrl: `${BASE_URL}/api/zoom-anmelden/beispiel?delegiert=0`,
              zoomJaDelegiertUrl: `${BASE_URL}/api/zoom-anmelden/beispiel?delegiert=1`,
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
          const body = await req.json();
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
                linkInfo: buildZoomLinkInfo(zoomCfg.link),
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
                linkInfo: buildZoomLinkInfo(zoomCfg?.link),
                unsubscribeUrl,
                zoomJaUrl: `${BASE_URL}/api/zoom-anmelden/${token}?delegiert=0`,
                zoomJaDelegiertUrl: `${BASE_URL}/api/zoom-anmelden/${token}?delegiert=1`,
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
                  linkInfo: buildZoomLinkInfo(zoomCfg.link),
                  unsubscribeUrl: `${BASE_URL}/abmelden/test?from=zoom`,
                }
              : {
                  name: "Test-Empfänger",
                  firstName: "Test-Empfänger",
                  signerCount,
                  eventLabel: zoomCfg?.label || "",
                  linkInfo: buildZoomLinkInfo(zoomCfg?.link),
                  unsubscribeUrl: `${BASE_URL}/abmelden/test`,
                  zoomJaUrl: `${BASE_URL}/api/zoom-anmelden/test?delegiert=0`,
                  zoomJaDelegiertUrl: `${BASE_URL}/api/zoom-anmelden/test?delegiert=1`,
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
          const body = await req.json();
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
          const body = await req.json();
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
          const body = await req.json();
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
          const body = await req.json();
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
          const body = await req.json();
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
