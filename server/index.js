import { createRequestDrain } from "./request-drain.js";
import { createCampaignDelivery } from "./campaign-delivery.js";
import { db as sqlDb, openEncrypted, DB_PATH } from "../db/connection.js";
import { ensureCampaignSubmissionKeys } from "../db/campaign-submissions.js";
import { isCampaignTemplate } from "../config/campaign-templates.js";
import { campaignSchedule } from "../config/campaign-schedule.js";
import {
  createPublicationStore,
  initialDocument,
  publicationFields,
  configFromDocument,
} from "./publications.js";
import {
  buildFrontend,
  documentHtml,
  adminHtml,
  SIGNING_PAUSED,
} from "./frontend.js";
import { normalizeImage, generateOg, assetPath } from "./assets.js";
import { publicFile } from "./public-files.js";
import { createAssetLifecycle } from "./asset-lifecycle.js";
import { sanitizeRich } from "./rich-content.js";
import {
  installTemplates,
  memoryTemplate,
  memoryTemplates,
} from "./template-snapshot.js";
import { createEmailManager, deliveryContext } from "./email-setup.js";
import {
  checkMailboxDns,
  dnsInstructions,
  ownershipToken,
} from "./mailbox-dns.js";
import { createStatistics, eligibleRequest } from "./statistics.js";
import { createMeetingService } from "./meeting-service.js";
import { timingSafeEqual, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SignJWT, jwtVerify } from "jose";
import cfg, {
  LETTER_NAME,
  LANGUAGES,
  DEFAULT_LANG,
  configFor,
} from "../config/letter.config.js";
import {
  requestLang,
  langPrefix,
  normalizeLang,
  storedLang,
  withLang,
} from "../config/i18n.js";
import { regionLabels } from "../config/region.js";
import { resolvePrivacy, retentionCutoff } from "../config/privacy.js";
import { resolveInvite, statsDisplay } from "../config/invite.js";
import { editableFields } from "../config/editable.js";
import { fillText } from "../config/ui.js";
import { SIGNER_DETAIL_LIMIT } from "../config/signer-details.js";
import { GERMAN_STATES } from "../config/states.js";
import { SELECTION_LIMIT } from "../config/selection.js";

// The config as deployed, before admin overrides ("Texte & Modus") are applied
// onto `cfg` below. Taken first, so it never contains an override.
const PRISTINE_CFG = structuredClone(cfg);
import { analyticsOrigin } from "../config/html.js";
import {
  getSigners,
  getStats,
  getMilestones,
  setMilestones,
  getNewsletterStats,
  getOccupations,
  getSignerFunctions,
  getKreisverbandStats,
  insertSigner,
  insertZoomRegistration,
  getSignerForZoomInvite,
  getZoomRegistrationCount,
  listZoomRegistrations,
  removeZoomRegistration,
  getZoomCounts,
  getZoomRecipients,
  issueZoomUnsubscribeToken,
  deleteZoomRegistrationByUnsubscribeToken,
  deleteSignerByUnsubscribeToken,
  issueInviteStatsToken,
  getSignerForMail,
  getDeletionRequestForMail,
  getZoomPendingForMail,
  getRecipientIdentity,
  authorizeRecipient,
  getCurrentZoomRegistrationByEmail,
  listZoomMailings,
  clearZoomRegistrations,
  getZoomSettings,
  meetingRepository,
  getZoomRegistrationForMail,
  issueUnsubscribeTokenForRecipient,
  markDeliveredForRecipient,
  setZoomSettings,
  confirmSigner,
  getPendingSignerByToken,
  getInviteByCode,
  getCopyOverrides,
  inviteDisplayName,
  getInviteStats,
  isInviteCode,
  refreshVerificationToken,
  getSignerIdByEmail,
  createDeletionRequest,
  deleteByDeletionToken,
  getDeletionRequestLang,
  deleteExpiredDeletionRequests,
  purgeZoomRegistrationsAfter,
  purgePreviousTreffenRegistrations,
  insertZoomPending,
  getZoomPendingByToken,
  confirmZoomPending,
  deleteExpiredZoomPending,
  deleteExpiredByAge,
  purgeOldErasureLog,
  healthCheck,
  close,
  listEmailTemplates,
  getEmailTemplate,
  listCampaigns,
  getCampaignById,
  getPendingCampaignsUsing,
  getCampaignRecipients,
  createCampaign,
  cancelCampaign,
  stopCampaign,
  claimCampaignById,
  deferCampaign,
  getDueCampaignIds,
  markCampaignSent,
  markCampaignFailed,
  setCampaignProgress,
  getSignatureActivity,
  getExpiredUnmailedSignups,
  retryAbortedCampaign,
  getDeliveredEmails,
  markDelivered,
  countDelivered,
  deleteOldDeliveries,
  getNewsletterRecipients,
  getCampaignLanguageCounts,
  getNewsletterNotZoomRecipients,
  getNewsletterRecipientsByIds,
  listNewsletterSigners,
  listSigners,
  removeAndBlockSigner,
  removeAndBlockSigners,
  eraseSigner,
  updateSignerByAdmin,
  getSignerForAdmin,
  lookupSignups,
  listSigningBlocks,
  exportPublicSigners,
  exportMeetingRegistrations,
  recordAdminAction,
  lastAdminActionAt,
  listAdminActions,
  purgeOldAdminActions,
  getNewsletterOptIn,
  confirmNewsletterOptIn,
  startConfirmationWindow,
  unblockSigning,
  selectedNewsletterSigners,
  listNewsletterSignerIds,
  getNewsletterSignerFilters,
  getNewsletterRecipientByEmail,
  getZoomRecipientByEmail,
  issueUnsubscribeToken,
  getUnsubscribeState,
  getUnifiedUnsubscribeState,
  getSignerKreisverband,
  getShowDelegierter,
  resolveEmailFromToken,
  optOutNewsletter,
  optOutNewsletterByEmail,
  deleteZoomByEmail,
  updateSignerByEmail,
  updateZoomByEmail,
  getSignerStateByEmail,
  deleteExpiredUnverifiedSigners,
  getStateStats,
  ensureKvStateCacheTable,
  getStateResolutionStats,
  getDistinctKreisverbands,
  mergeKreisverband,
  assignKvState,
  undoMerge,
  deleteExpiredMerges,
  insertKvNotTypo,
  loadKvNotTypo,
  getUnresolvedKvs,
  clearEmptyKvCacheEntries,
  getDistinctOccupations,
  mergeOccupation,
  insertOccNotTypo,
  loadOccNotTypo,
  normalizeOccupation,
  isSigningBlocked,
} from "./db.js";
import {
  addByHand,
  applyImport,
  duplicatesOf,
  linkDuplicate,
  listFirstSigners,
  planImport,
  readImportFile,
  replaceOrder,
  setMark,
  setPosition,
} from "./first-signers.js";
import { withoutEmailAddresses } from "../db/admin-actions.js";
import {
  installEmailManager,
  sendVerificationEmail,
  sendZoomConfirmationEmail,
  sendTreffenVerificationEmail,
  sendTreffenAlreadyRegisteredEmail,
  sendDeletionEmail,
  sendRenderedEmail,
  dispatchEmail,
  sendBatchEmails,
  buildUnsubscribeHeaders,
  renderEmailHtml,
  interpolateTemplate,
  renderTemplateBySlug,
  sendAlreadySignedEmail,
  sendNewsletterOptInEmail,
  sendInviteEmail,
  zoomCalendarButton,
  langLocale,
  pageUrl,
  campaignVersion,
  messageDelayMs,
  batchDelayMs,
} from "./email.js";
import { buildZoomIcs } from "./ics.js";
import {
  simplePage,
  firstNameHtml,
  escapeHtml,
  pageCopy,
  newsletterOptInCopy,
  fill,
} from "./pages.js";
import { checkRateLimit, releaseRateLimit } from "./ratelimit.js";
import { clientIp } from "./client-ip.js";
import { createAdminSessions } from "./admin-sessions.js";
import { stopCache } from "./cache.js";
import { runBackup, backupStatus } from "./backup.js";
import { operationsHealth } from "./health.js";
import {
  initJobs,
  enqueue as enqueueJob,
  registerSchedule,
  startWorker,
  stopWorker,
  purgeDeadJobs,
  requeueDeadJobs,
} from "../db/jobs.js";
import { createDurableWork, JobsUnavailable } from "./durable-work.js";
import {
  prepareQueuedEmail,
  normalizeQueuedEmailPayload,
} from "./queued-email.js";
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
// Empty when no date is set yet (date TBD); the meeting then counts as "open"
// so the signup form/CTA still show. A real date is set in the admin.
const ZOOM_LINK = sanitizeUrl(process.env.ZOOM_LINK || "");
const ZOOM_EVENT_AT_DEFAULT =
  process.env.ZOOM_EVENT_AT || cfg.zoom?.eventAt || "";
const ZOOM_EVENT_DURATION_MIN_DEFAULT = parseInt(
  process.env.ZOOM_EVENT_DURATION_MIN || String(cfg.zoom?.durationMin || 90),
  10,
);
const ZOOM_ICS_URL = `${BASE_URL}/api/termin.ics`;
const ICS_UID_HOST = new URL(BASE_URL).host;

// Human label for the event date/time, e.g. "9. Juni, 20:00 Uhr" (in `lang`,
// the default language without it).
function formatZoomLabel(date, lang) {
  if (Number.isNaN(date.getTime())) return "";
  const locale = langLocale(lang);
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "long",
  }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return serverText("dateLabel", { day, time }, lang);
}

// A public server string from the text table (`ui.server`, admin-editable),
// with its {placeholders} filled, in `lang` (the default language without it).
function serverText(key, values, lang) {
  return fillText(configFor(lang).ui.server[key], values);
}

// Confirmation-mail phrasing derived from the link-mail offset.
function offsetPhrase(hours, lang) {
  if (hours % 24 === 0) {
    const days = hours / 24;
    if (days === 1) return serverText("oneDay", {}, lang);
    const words = String(configFor(lang).ui.server.numberWords || "").split(
      ",",
    );
    const n = (days <= 7 && words[days - 1]?.trim()) || days;
    return serverText("days", { n }, lang);
  }
  if (hours === 1) return serverText("oneHour", {}, lang);
  return serverText("hours", { n: hours }, lang);
}

// The Treffen config (getZoomConfig()) as seen in `lang`: date label, date
// phrase and nav label in that language, and `lang` set, so the meeting info
// block, calendar button and .ics built from it follow. The default language
// gets `zc` itself, unchanged.
function zoomIn(zc, lang) {
  const l = normalizeLang(cfg, lang);
  if (!zc || l === DEFAULT_LANG || zc.lang === l) return zc;
  const own = configFor(l);
  // A label set in the admin is one for all languages; the letter's own
  // comes in the language asked for.
  const fallback =
    zc.eventLabelFallback === (cfg.zoom?.eventLabel || "")
      ? own.zoom?.eventLabel || ""
      : zc.eventLabelFallback;
  const navLabel =
    zc.navLabel === (cfg.zoom?.navLabel || serverText("meetingFallback"))
      ? own.zoom?.navLabel || serverText("meetingFallback", {}, l)
      : zc.navLabel;
  const dateLabel = zc.dateSet ? formatZoomLabel(zc.eventAt, l) : "";
  return {
    ...zc,
    lang: l,
    label: zc.dateSet ? dateLabel : fallback,
    eventLabelFallback: fallback,
    navLabel,
    whenPhrase: zc.dateSet ? serverText("when", { label: dateLabel }, l) : "",
    icsUrl: withLang(cfg, zc.icsUrl, l),
  };
}

// A deletion link's language: the request's while it exists (read only with
// several languages, so a single-language letter makes no extra query).
async function deletionLang(req) {
  const own =
    LANGUAGES.length > 1
      ? await getDeletionRequestLang(req.params.token)
      : null;
  return linkLang(req, own);
}

// The language of a link page: the person's stored one when the row is still
// there, else the one the mail link carries (?lang=), else the default.
function linkLang(req, rowLang) {
  return normalizeLang(cfg, rowLang ?? reqLang(req));
}

// Effective Zoom config: DB settings override env defaults.
async function getZoomConfig({ strict = false } = {}) {
  let s = {};
  try {
    s = await getZoomSettings();
  } catch (err) {
    if (strict) throw err;
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
  const eventLabelFallback = cfg.zoom?.eventLabel || "";
  return {
    revision: Number(s.zoom_revision || 0),
    generation: Number(s.zoom_generation || 0),
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
    // "" when it's still TBD, so templates read cleanly either way.
    whenPhrase: dateSet
      ? serverText("when", { label: formatZoomLabel(eventAt) })
      : "",
    icsUrl: ZOOM_ICS_URL,
    // Nav/CTA label for the Treffen (admin-editable, falls back to config).
    navLabel: cfg.zoom?.navLabel || serverText("meetingFallback"),
    // Delegate field toggle: admin-editable, seeded from the letter config.
    showDelegierter:
      s.zoom_show_delegierter != null
        ? s.zoom_show_delegierter === "1"
        : Boolean(cfg.zoom?.form?.showDelegierter),
    // Meeting mode + in-person location, admin-editable over the letter config.
    mode:
      (s.zoom_mode || cfg.zoom?.mode) === "inperson" ? "inperson" : "online",
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
// Optional. It ends up in the settings of an uptime monitor, so it must not be
// a secret that opens anything else.
const HEALTH_TOKEN = process.env.HEALTH_TOKEN || "";
if (HEALTH_TOKEN && HEALTH_TOKEN.length < 16) {
  throw new Error("HEALTH_TOKEN must be at least 16 characters long.");
}
if (HEALTH_TOKEN && HEALTH_TOKEN === ADMIN_PASSWORD) {
  throw new Error("HEALTH_TOKEN must not equal ADMIN_PASSWORD.");
}
if (!isDev && ADMIN_PASSWORD.length < 16) {
  throw new Error(
    "ADMIN_PASSWORD must be at least 16 characters long in production.",
  );
}
if (!isDev && !TRUST_PROXY) {
  console.warn(
    "[security] TRUST_PROXY is not set; set TRUST_PROXY=true when running behind a reverse proxy for accurate IP rate-limiting.",
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

// Bundled assets are independent of the mutable, localized HTML publication.
const frontend = await buildFrontend();
const EXTRA_LANGS = LANGUAGES.filter((l) => l !== DEFAULT_LANG);
const languageRoutes = Object.fromEntries(
  EXTRA_LANGS.flatMap((l) => [
    [`/${l}`, publicPage],
    [`/${l}/`, publicPage],
    [`/${l}/abmelden/:token`, privatePage],
  ]),
);
const languageInviteRoutes = Object.fromEntries(
  EXTRA_LANGS.map((l) => [`/${l}/i/:code`, privatePage]),
);
const admin = () =>
  new Response(adminHtml(frontend.entries, LETTER_NAME, cfg), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders,
      "Cache-Control": "no-store",
      // The path is a secret of sorts, so robots.txt must not name it; this
      // keeps a crawler that finds it anyway from listing it.
      "X-Robots-Tag": "noindex",
    },
  });

const adminRoute = `/${ADMIN_PATH}`;
const adminSessions = await createAdminSessions(sqlDb, {
  password: ADMIN_PASSWORD,
  secret: ADMIN_JWT_SECRET,
});

// Public-API session tokens. The public frontend fetches a short-lived signed
// token from /api/session and sends it on every public API call, so the
// endpoints reject direct, token-less access from bots/scrapers. This is a
// deterrent layer (a determined client can still fetch a token), not a hard
// boundary; the per-IP rate limits on the endpoints are the real throttle.
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
  // Must not shadow /api or a language page ("/en").
  if (
    !value ||
    value.includes("/") ||
    value.includes("?") ||
    value === "api" ||
    LANGUAGES.includes(value)
  ) {
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
  return sanitizeRich(String(str || "").slice(0, max));
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
        "Content-Security-Policy": `default-src 'self'; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; img-src 'self' data:; connect-src ${connectSrc}; frame-src 'self' about:`,
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      }),
};

function getClientIp(req) {
  return clientIp(req.headers, server.requestIP(req)?.address, TRUST_PROXY);
}

// Sign-in attempts allowed per window: from one address, and failed ones from
// all addresses together. The second stops a guess spread over many addresses.
// It also lets whoever keeps failing that often hold the team out for the
// window, which the 16-character minimum on ADMIN_PASSWORD makes a nuisance
// rather than a way in.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPTS_PER_ADDRESS = 5;
const LOGIN_FAILURES_OVERALL = 30;

const MAX_BODY_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
function bodyTooLarge(req) {
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  return len > MAX_BODY_BYTES;
}

// Feature flags enforced server-side, not only in the client: with a module
// off, its endpoints 404 and its optional fields are neither stored nor served.
const ZOOM_ENABLED = Boolean(cfg.features.zoomEvent);
const KV_ENABLED = Boolean(cfg.features.kreisverbandField);
// Same reading as the frontend (an empty list means free text).
const KV_OPTIONS = regionLabels(cfg).options;

// Clean a submitted region. With fixed options (e.g. Berlin Bezirke) anything
// not on the list is dropped rather than stored as free text, except the
// signer's current value (`keep`), so a self-edit never erases a region stored
// before the options were introduced.
function normalizeKv(raw, keep = "") {
  const kv = sanitize(raw || "").replace(/^KV\s*/i, "");
  if (!KV_OPTIONS || !kv) return kv;
  const same = (a) => a.toLowerCase() === kv.toLowerCase();
  return KV_OPTIONS.find(same) ?? (keep && same(keep) ? keep : "");
}
const OCCUPATION_ENABLED = Boolean(cfg.features.occupationField);
const SIGNER_FUNCTION_ENABLED = Boolean(cfg.sign.fields.signerFunction);
const OCCUPATION_LIMIT = SIGNER_FUNCTION_ENABLED ? SIGNER_DETAIL_LIMIT : 100;
const INVITES_ENABLED = Boolean(cfg.features.inviteLinks);

// A merge target is stored as if it had been typed into the sign-up form, so
// it has to come through that form's cleaning unchanged. null otherwise.
function mergeTarget(raw, clean) {
  const value = String(raw ?? "").trim();
  return value && clean(value) === value ? value : null;
}

function featureOff() {
  return new Response("Not found", { status: 404 });
}

// Whether a signature's function and organisation can be public at all.
const SIGNER_DETAILS_PUBLIC = Boolean(
  cfg.features.publicSignerDetails || cfg.features.publicFirstSignerDetails,
);

const invalidSigner = () =>
  Object.assign(new Error("Ungültige Unterschrift."), { status: 400 });

const HAND_ENTRY_HAS_NO_ADDRESS =
  "Dieser Eintrag wurde von Hand angelegt und hat keine E-Mail-Adresse. Er bekommt keine E-Mails und hat keine Adresse zum Sperren.";

// The import file is CSV text inside the JSON body, at most 1 MiB.
const IMPORT_BODY_BYTES = 1536 * 1024;
function importRows(csv) {
  if (typeof csv !== "string" || csv.length > 1024 * 1024)
    throw Object.assign(
      new Error("Die Datei muss eine CSV-Datei mit höchstens 1 MB sein."),
      { status: 400 },
    );
  return readImportFile(csv).map((row) => ({
    ...row,
    organisation: OCCUPATION_ENABLED ? row.organisation : "",
    signerFunction: SIGNER_FUNCTION_ENABLED ? row.signerFunction : "",
  }));
}

function signerId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw invalidSigner();
  return id;
}

// Told to the admin after queueing a mail while sending is down.
// The log entry for a merge: the id it can be taken back by, and how many
// signatures it changed.
function mergeEntry(merged) {
  return { targetId: merged.undoId ?? null, count: merged.updated ?? null };
}

function mailDelay() {
  return emailManager.status.ready ? {} : { emailDelayed: true };
}

// A mail the team sends one person by hand: never to a blocked mailbox, and
// at most once per ADMIN_MAIL_PAUSE_MS, so repeated clicks cannot flood
// anyone's inbox.
const ADMIN_MAIL_PAUSE_MS = 10 * 60 * 1000;
async function adminMailRefused(signer, action, id) {
  if (await isSigningBlocked(signer.email))
    return json(
      { error: "Diese Adresse ist gesperrt. Es wird keine E-Mail gesendet." },
      409,
    );
  const last = await lastAdminActionAt(action, id);
  const wait = last ? Date.parse(last) + ADMIN_MAIL_PAUSE_MS - Date.now() : 0;
  if (wait <= 0) return null;
  const minutes = Math.ceil(wait / 60000);
  return json(
    {
      error: `Diese E-Mail wurde gerade erst gesendet. Versuche es in ${minutes === 1 ? "einer Minute" : `${minutes} Minuten`} erneut.`,
    },
    429,
    { "Retry-After": String(Math.ceil(wait / 1000)) },
  );
}

const csvDate = (value) =>
  new Date(value).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "short",
    timeStyle: "short",
  });

// A spreadsheet runs a cell that starts like a formula, so those get a
// leading apostrophe. Semicolons and a byte order mark are what a German
// Excel opens without an import dialog.
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// columns: [heading, (row) => value]; falsy entries are left out.
function csvDownload(name, columns, rows) {
  const shown = columns.filter(Boolean);
  const lines = [
    shown.map(([heading]) => heading),
    ...rows.map((row) => shown.map(([, value]) => value(row))),
  ].map((cells) => cells.map(csvCell).join(";"));
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
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

const payloadTooLarge = () =>
  Object.assign(new Error("Die Anfrage ist zu groß."), { status: 413 });

// Every handler reads fields off the body, so anything but a JSON object
// (`null`, a list, a bare string) is refused here instead of crashing there.
function jsonObject(text) {
  const body = JSON.parse(text);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw Object.assign(new Error("Ungültige Anfrage."), { status: 400 });
  return body;
}

async function parseJsonBody(req, limit = MAX_BODY_BYTES) {
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (len > limit) throw payloadTooLarge();

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
        if (size > limit) throw payloadTooLarge();
        chunks.push(value);
      }
    }
    return jsonObject(new TextDecoder().decode(concatUint8Arrays(chunks)));
  }

  // No readable stream body (the content-length cap above still applies).
  return jsonObject(await req.text());
}

async function constantTimeSecretMatches(submitted, secret) {
  const [left, right] = await Promise.all([
    sha256Hex(String(submitted || "")),
    sha256Hex(secret),
  ]);
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

const constantTimePasswordMatches = (submitted) =>
  constantTimeSecretMatches(submitted, ADMIN_PASSWORD);

function requireAdmin(req) {
  const auth = req.headers.get("authorization") || "";
  return adminSessions.verify(
    auth.startsWith("Bearer ") ? auth.slice(7).trim() : "",
  );
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
    return json({ error: reqUi(req).errors.tooMany }, 429, {
      "Retry-After": String(retryAfter),
    });
  }
  if (REQUIRE_API_TOKEN && !(await hasValidPublicToken(req))) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

// The language of the page a public request comes from (config/i18n.js).
function reqLang(req) {
  return requestLang(cfg, req);
}

// Interface texts in the requester's language, its admin overrides included.
function reqUi(req) {
  return configFor(reqLang(req)).ui;
}

function denyRate(req, bucket, max, windowMs) {
  const { allowed, retryAfter } = checkRateLimit(
    getClientIp(req),
    bucket,
    max,
    windowMs,
  );
  if (!allowed) {
    return json({ error: reqUi(req).errors.tooMany }, 429, {
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
    if (err instanceof SyntaxError)
      return json({ error: "Ungültige Anfrage." }, 400);
    if (err.status === 409)
      return json({ error: err.message, revision: err.revision }, 409);
    if (err.status === 400 || err.status === 413)
      return json({ error: err.message }, err.status);
    // Only this 503 carries a text written for the admin; a mail provider's
    // 503 has a status too and must stay behind the generic answer.
    if (err instanceof JobsUnavailable)
      return json({ error: err.message }, 503);
    console.error("Admin API error:", err);
    return json({ error: "Internal server error" }, 500);
  }
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
// shows the join link, but only once the link window has opened (before that,
// or when `pending`, it says the link follows by email); for in-person meetings
// it shows the location/address. Always appends the calendar button. `zc` is the
// getZoomConfig() result.
function buildMeetingInfo(zc, { pending = false, timingText } = {}) {
  // zoomIn() sets `lang`; the default language has none.
  const lang = zc?.lang;
  timingText ??= serverText("shortly", {}, lang);
  const calBtn = lang
    ? zoomCalendarButton(withLang(cfg, ZOOM_ICS_URL, lang), lang)
    : zoomCalendarButton(ZOOM_ICS_URL);
  if (zc?.mode === "inperson") {
    const loc = zc.location || {};
    const where = [loc.name, loc.address]
      .filter(Boolean)
      .map(escapeHtml)
      .join(", ");
    const wherePart = where
      ? serverText("meetInPerson", { where }, lang)
      : serverText("placeLater", {}, lang);
    const mapPart = loc.mapsUrl
      ? `<p><a href="${escapeHtml(loc.mapsUrl)}">${serverText("mapLink", {}, lang)}</a></p>`
      : "";
    return wherePart + mapPart + calBtn;
  }
  // online
  if (pending) {
    return serverText("linkPending", { timing: timingText }, lang) + calBtn;
  }
  const safeLink = sanitizeUrl(zc?.link || "");
  // Only reveal the actual link once the link window has opened; otherwise the
  // invite email (sent well ahead) would leak the link before it's time.
  const linkPart =
    safeLink && isLinkWindowOpen(zc)
      ? serverText(
          "linkNow",
          {
            link: `<a href="${escapeHtml(safeLink)}">${escapeHtml(safeLink)}</a>`,
          },
          lang,
        )
      : serverText("linkLater", {}, lang);
  return linkPart + calBtn;
}

function buildZoomEventIcs(zc, { includeLink = false } = {}) {
  const lang = zc?.lang;
  const brand = configFor(lang).brand?.name || "Initiative";
  const summary = serverText("icsSummary", { brand }, lang);
  if (zc?.mode === "inperson") {
    const loc = zc.location || {};
    const where = [loc.name, loc.address].filter(Boolean).join(", ");
    const desc = where
      ? serverText("icsPlace", { brand, where }, lang)
      : serverText("icsPlaceLater", { brand }, lang);
    return buildZoomIcs({
      start: zc.eventAt,
      durationMin: zc.durationMin,
      summary,
      description: desc,
      url: loc.mapsUrl || "",
      location: where || serverText("icsInPerson", {}, lang),
      uid: `zoom-${zc.eventAt.getTime()}@${ICS_UID_HOST}`,
      product: brand,
      ...(lang && { lang }),
    });
  }
  const link = includeLink ? zc.link : "";
  const desc = link
    ? serverText("icsOnline", { brand, link }, lang)
    : serverText("icsOnlineLater", { brand }, lang);
  return buildZoomIcs({
    start: zc.eventAt,
    durationMin: zc.durationMin,
    summary,
    description: desc,
    url: link,
    location: serverText("icsOnlineLocation", {}, lang),
    uid: `zoom-${zc.eventAt.getTime()}@${ICS_UID_HOST}`,
    product: brand,
    ...(lang && { lang }),
  });
}

function emailPreviewVariables(eventLabel) {
  return {
    name: "Ada Beispiel",
    firstName: "Ada",
    confirmUrl: "https://preview.invalid/confirm/example",
    deleteUrl: "https://preview.invalid/delete/example",
    inviteUrl: "https://preview.invalid/invite/example",
    statsUrl: "https://preview.invalid/invites/example",
    linkHours: String(
      resolvePrivacy(configFor(DEFAULT_LANG)).confirmationLinkHours,
    ),
    signerCount: "1.000",
    unsubscribeUrl: "https://preview.invalid/preferences/example",
    eventLabel,
    eventWhen: "15. Dezember 2026, 18:00 Uhr (Europe/Berlin)",
    zoomLink: "https://preview.invalid/meeting",
    linkInfo:
      '<p>Beispieltermin: 15. Dezember, 18:00 Uhr. <a href="https://preview.invalid/meeting">Am Treffen teilnehmen</a></p>',
    zoomJaUrl: "https://preview.invalid/meeting/signup/example",
    zoomJaDelegiertUrl: "https://preview.invalid/meeting/delegate/example",
  };
}

const campaignDelivery = createCampaignDelivery({
  baseUrl: BASE_URL,
  getZoomConfig,
  zoomIn,
  buildMeetingInfo,
  treffenSignupUrls,
  canContinue: () => durableWork.status.ready,
});
const handleCampaignJob = (payload) => campaignDelivery.handle(payload);

// ---- Zoom event mailings (link 1 day before + ICS, reminder 2 hours before) ----

// Renders one zoom event mail (kind 'link' | 'reminder') for a recipient using
// the given unsubscribe token. Shared by the worker and the admin test-send so
// both exercise the exact same rendering (incl. the .ics attachment for 'link').
// In the recipient's language (`recipient.lang`).
async function buildZoomMailPayload(kind, recipient, token, zoomCfg) {
  const cfg = zoomIn(zoomCfg, recipient.lang);
  const unsubscribeUrl = pageUrl(
    BASE_URL,
    `/abmelden/${token}?from=zoom`,
    cfg.lang,
  );
  const optOutUrl = `${BASE_URL}/api/zoom-abmelden/${token}/opt-out`;
  const slug = kind === "link" ? "zoom_link" : "zoom_reminder";
  const rendered = await renderTemplateBySlug(
    slug,
    {
      name: recipient.name,
      firstName: recipient.name.split(/\s/)[0],
      eventLabel: cfg.label,
      linkInfo: buildMeetingInfo(cfg),
      unsubscribeUrl,
    },
    cfg.lang,
  );
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

async function buildMeetingMail(kind, recipient, token, config) {
  if (kind !== "confirmation")
    return buildZoomMailPayload(kind, recipient, token, config);
  const localized = zoomIn(config, recipient.lang);
  const rendered = await renderTemplateBySlug(
    "zoom_confirmation",
    {
      name: recipient.name,
      firstName: recipient.name.split(/\s/)[0],
      eventLabel: localized.label,
      eventWhen: localized.whenPhrase,
      linkInfo: buildMeetingInfo(localized, {
        pending: true,
        timingText: offsetPhrase(localized.linkOffsetHours, localized.lang),
      }),
      unsubscribeUrl: pageUrl(
        BASE_URL,
        `/abmelden/${token}?from=zoom`,
        localized.lang,
      ),
    },
    localized.lang,
  );
  return {
    to: recipient.email,
    subject: rendered.subject,
    html: rendered.html,
    headers: buildUnsubscribeHeaders(
      `${BASE_URL}/api/zoom-abmelden/${token}/opt-out`,
    ),
  };
}

// Copy for the server-rendered link pages (letter config `pages`).
const privacy = resolvePrivacy(cfg);
const TREFFEN_RETENTION_MS = privacy.treffenRetentionMs;
// A link is valid for this long from `from`: now, or when its mail went out.
const confirmationExpiry = (from = Date.now()) =>
  new Date(new Date(from).getTime() + privacy.confirmationLinkMs);
// A sign-up waits for its confirmation mail as long as the queued mail is
// kept, so it cannot run out while the mail can still go out. Once the mail
// service takes the mail, the link counts from then (startConfirmationWindow).
// Each request for the mail starts this wait again and leaves a link that
// went out as it is. A sign-up whose mail is given up on ends here and is
// counted as lost.
const mailWaitExpiry = () =>
  new Date(Date.now() + privacy.emailJobRetentionS * 1000);
// The admin log is kept as long as the delivery log unless the letter sets
// privacy.adminLogDays.
const ADMIN_LOG_DAYS = privacy.adminLogDays;

async function queuedCredentials(kind, args) {
  if (kind === "invite") {
    const issued = await issueInviteStatsToken(args.signerId);
    return issued
      ? { statsToken: issued.token, inviteCode: issued.inviteCode }
      : {};
  }
  const row =
    kind === "verification"
      ? await getSignerForMail(args.signerId)
      : kind === "deletion"
        ? await getDeletionRequestForMail(args.requestId)
        : kind === "treffen-verification"
          ? await getZoomPendingForMail(args.pendingId)
          : null;
  return row ? { token: row.verification_token || row.token } : {};
}
const durableWork = createDurableWork(sqlDb, {
  enqueue: enqueueJob,
  ttl: privacy.emailJobRetentionS,
  prepare: queuedCredentials,
});
let pages = pageCopy(cfg);

// Admin-editable texts and presentation mode (config/editable.js). Overrides
// are written onto each language's config itself (`cfg` for the default,
// configFor(lang) for the others), so every read at request time sees them;
// `pages` is rebuilt from `cfg`. Each language has its own fields, defaults
// and overrides: an edit in one never reaches another.
function editableFor(lang) {
  const pristine =
    lang === DEFAULT_LANG ? PRISTINE_CFG : structuredClone(configFor(lang));
  const fields = editableFields(
    pristine,
    lang === DEFAULT_LANG ? pageCopy(pristine) : pageCopy(pristine, lang),
  );
  return { fields, byPath: new Map(fields.map((f) => [f.path, f])) };
}
const EDITABLE_BY_LANG = Object.fromEntries(
  LANGUAGES.map((l) => [l, editableFor(l)]),
);

// Stored under `copy:<path>` for the default language, `copy:<lang>:<path>`
// for another.
const storageLang = (lang) => (lang === DEFAULT_LANG ? null : lang);

// Only overrides for paths this letter still offers (a stale row for a
// removed field is ignored).
async function currentOverrides(lang = DEFAULT_LANG) {
  const all = await getCopyOverrides(storageLang(lang));
  const { byPath } = EDITABLE_BY_LANG[lang];
  return Object.fromEntries(
    Object.entries(all).filter(([path]) => byPath.has(path)),
  );
}

await ensureCampaignSubmissionKeys(sqlDb);
const publicationConnection = await openEncrypted(DB_PATH);
const emailConnection = await openEncrypted(DB_PATH);
const assetConnection = await openEncrypted(DB_PATH);
await assetConnection.run(
  readFileSync(new URL("../db/publishing.sql", import.meta.url), "utf8"),
);
const assetLifecycle = await createAssetLifecycle(assetConnection);
let publications;
const emailManager = await createEmailManager(emailConnection, cfg, {
  onActivate() {
    refreshEmailFacts();
  },
});
installEmailManager(emailManager);
function refreshEmailFacts() {
  if (!publications) return;
  for (const l of LANGUAGES)
    Object.assign(configFor(l).email, emailManager.facts);
  // HTML is derived from the current publication and current protected email facts.
  rebuildHtml(publications.current);
}
function rebuildHtml(snapshot) {
  snapshot.html = {};
  snapshot.privateHtml = {};
  for (const l of LANGUAGES) {
    const config = configFor(l);
    snapshot.html[l] = documentHtml(config, LETTER_NAME, frontend.entries);
    snapshot.privateHtml[l] = documentHtml(
      config,
      LETTER_NAME,
      frontend.entries,
      { privatePage: true },
    );
  }
}
publications = await createPublicationStore(publicationConnection, {
  assets: assetLifecycle,
  // A removed template stays in email_templates, where a campaign created
  // earlier would still find and send it.
  async beforeCommit(document, previous, connection) {
    const kept = new Set(document.templates.map((t) => t.id));
    const removed = (previous?.templates || []).filter((t) => !kept.has(t.id));
    if (!removed.length) return;
    const [campaign, ...more] = await getPendingCampaignsUsing(
      removed.map((t) => t.id),
      connection,
    );
    if (!campaign) return;
    const state =
      campaign.status === "scheduled"
        ? `geplant für ${new Intl.DateTimeFormat("de-DE", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Europe/Berlin",
          }).format(new Date(campaign.scheduled_at))}`
        : campaign.status === "sending"
          ? "wird gerade gesendet"
          : "wird nach einem Fehler erneut versucht";
    throw Object.assign(
      new Error(
        `${removed.length === 1 ? `Die Vorlage „${removed[0].name}“ wird` : "Diese Vorlagen werden"} noch für Kampagne #${campaign.id} „${campaign.subject}“ gebraucht (${state})${more.length ? ` und für ${more.length} weitere` : ""}. Sage den Versand im Versandverlauf ab oder warte ihn ab, bevor du die Vorlage entfernst.`,
      ),
      { status: 409 },
    );
  },
  async prepare(document, { mode }) {
    const configs = {};
    const generatedAssets = [];
    for (const l of LANGUAGES) {
      const config = configFromDocument(document, l, emailManager.facts);
      const text =
        document.metadata[l]?.imageText ||
        (config.features.successMode
          ? config.success?.headlineLines
          : config.hero.headlineLines
        )
          ?.map((v) => v.text)
          .join(" ");
      if (!document.metadata[l]?.ogImage) {
        const image = await generateOg(config, text);
        config.meta.ogImage =
          mode === "preview"
            ? `data:${image.mime};base64,${image.bytes.toString("base64")}`
            : `${BASE_URL}${assetPath(image.hash)}`;
        generatedAssets.push(image);
      }
      config.publicationCss = document.appearance.css;
      configs[l] = config;
    }
    // Render before the transaction: failures cannot leave the live snapshot half updated.
    const html = Object.fromEntries(
      LANGUAGES.map((l) => [
        l,
        documentHtml(configs[l], LETTER_NAME, frontend.entries),
      ]),
    );
    const privateHtml = Object.fromEntries(
      LANGUAGES.map((l) => [
        l,
        documentHtml(configs[l], LETTER_NAME, frontend.entries, {
          privatePage: true,
        }),
      ]),
    );
    return { configs, html, privateHtml, generatedAssets };
  },
  onSwap(snapshot) {
    for (const l of LANGUAGES) {
      Object.assign(snapshot.configs[l].email, emailManager.facts);
      Object.assign(configFor(l), snapshot.configs[l]);
    }
    rebuildHtml(snapshot);
    installTemplates(snapshot.document.templates);
    pages = pageCopy(cfg);
  },
});
const migratedOverrides = Object.fromEntries(
  await Promise.all(LANGUAGES.map(async (l) => [l, await currentOverrides(l)])),
);
const legacyEventCopy = await getZoomSettings();
for (const l of LANGUAGES) {
  for (const [key, path] of [
    ["zoom_event_label", "zoom.eventLabel"],
    ["zoom_nav_label", "zoom.navLabel"],
  ]) {
    if (legacyEventCopy[key] && migratedOverrides[l][path] == null)
      migratedOverrides[l][path] = legacyEventCopy[key];
  }
}
const completeTemplates = await sqlDb
  .query("SELECT * FROM email_templates ORDER BY id")
  .all();
await publications.load(initialDocument(completeTemplates, migratedOverrides));

let statistics = null;
try {
  statistics = await createStatistics(await openEncrypted(DB_PATH), BASE_URL);
} catch (e) {
  console.error("[statistics] initialization failed:", e.message);
}
function publicationResponse(snapshot = publications.current) {
  return {
    nextTemplateId: publications.nextTemplateIdValue,
    revision: snapshot.revision,
    id: snapshot.id,
    document: snapshot.document,
    publishedAt: snapshot.publishedAt,
  };
}
function pageLanguage(req) {
  const first = new URL(req.url).pathname.split("/")[1];
  return EXTRA_LANGS.includes(first) ? first : DEFAULT_LANG;
}
function publicPage(req) {
  const lang = pageLanguage(req);
  if (
    statistics &&
    publications.current.document.analytics.mode === "builtin" &&
    eligibleRequest(req, EXTRA_LANGS)
  )
    statistics.track(req, getClientIp(req));
  return new Response(publications.current.html[lang], {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders,
      "Cache-Control": "no-store",
    },
  });
}
function privatePage(req) {
  return new Response(publications.current.privateHtml[pageLanguage(req)], {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders,
      "Cache-Control": "no-store",
    },
  });
}

// Link-page copy in `lang` (that language's admin overrides included); the
// default language's is `pages`.
function pagesIn(lang) {
  const l = normalizeLang(cfg, lang);
  return l === DEFAULT_LANG ? pages : pageCopy(configFor(l), l);
}

function htmlPage(inner, status = 200, lang) {
  const l = normalizeLang(cfg, lang);
  const page =
    l === DEFAULT_LANG
      ? simplePage(inner, cfg)
      : simplePage(inner, configFor(l), l);
  return new Response(page, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders },
  });
}

const para = (html) => `<p>${html}</p>`;
const heading = (html) => `<h1>${html}</h1>`;
const postButton = (label) =>
  `<form method="post"><button type="submit">${label}</button></form>`;

function signingPausedApi(req) {
  return json({ error: reqUi(req).signForm.pausedMessage }, 503);
}

function signingPausedPage(req) {
  const lang = reqLang(req);
  const { pausedTitle, pausedMessage } = configFor(lang).ui.signForm;
  return htmlPage(
    heading(escapeHtml(pausedTitle)) + para(escapeHtml(pausedMessage)),
    503,
    lang,
  );
}

function treffenLinkExpired(lang) {
  const copy = pagesIn(lang);
  const home = `<a href="${BASE_URL}${langPrefix(cfg, lang)}/#zoom">${escapeHtml(new URL(BASE_URL).host)}</a>`;
  return htmlPage(
    heading(copy.expired.heading) + para(fill(copy.expired.text, { home })),
    410,
    lang,
  );
}

function treffenLinkError(lang) {
  const copy = pagesIn(lang);
  return htmlPage(
    heading(copy.error.heading) + para(copy.error.text),
    500,
    lang,
  );
}

// One-click Treffen registration from a newsletter invite (token = the signer's
// stable unsubscribe token, which proves the address). GET shows a button when
// the link would register or change something; only the POST writes, so a mail
// scanner opening the link can't register anyone.
// ?delegiert=1 → delegate, ?delegiert=0 (or omitted) → non-delegate;
// &force=1 → change an existing registration's delegate status.
async function treffenAnmelden(req, { commit }) {
  if (!ZOOM_ENABLED) return featureOff();
  const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
  if (blocked) return blocked;
  const { token } = req.params;
  const force = req.url.includes("force=1");
  let lang = linkLang(req);
  try {
    const signer = await getSignerForZoomInvite(token);
    if (!signer) return treffenLinkExpired(lang);
    lang = linkLang(req, signer.lang);
    const pages = pagesIn(lang);
    const zoomCfg = zoomIn(await getZoomConfig(), lang);
    // When the delegate field is off, ignore any ?delegiert=1 in the link so a
    // stale email button can't register someone as a delegate.
    const delegiert =
      zoomCfg.showDelegierter && req.url.includes("delegiert=1");

    // A registration left over from a previous Treffen doesn't count here.
    const existing = await getCurrentZoomRegistrationByEmail(signer.email);
    const vars = {
      firstName: firstNameHtml(signer.name),
      when: escapeHtml(zoomCfg.whenPhrase),
    };

    if (existing && !force) {
      // The delegate status + toggle only make sense while the field is on;
      // when off, show a neutral "registriert" line with no toggle.
      const copy = pages.treffenAlready;
      const status = !zoomCfg.showDelegierter
        ? ""
        : existing.delegierter
          ? copy.statusDelegate
          : copy.statusRegular;
      let toggleBlock = "";
      if (zoomCfg.showDelegierter) {
        const toggleUrl = withLang(
          cfg,
          `${BASE_URL}/api/treffen-anmelden/${encodeURIComponent(token)}?delegiert=${existing.delegierter ? 0 : 1}&force=1`,
          lang,
        );
        toggleBlock = para(
          `<a href="${toggleUrl}">${existing.delegierter ? copy.toRegular : copy.toDelegate}</a>`,
        );
      }
      const unsubLink = existing.unsubscribe_token
        ? para(
            `<a href="${pageUrl(BASE_URL, `/abmelden/${encodeURIComponent(existing.unsubscribe_token)}?from=zoom`, lang)}">${copy.unsubscribe}</a>`,
          )
        : "";
      return htmlPage(
        heading(copy.heading) +
          para(fill(copy.text, { ...vars, status })) +
          toggleBlock +
          unsubLink,
        200,
        lang,
      );
    }

    if (!commit) {
      const copy = pages.treffenInvite;
      const ask = existing
        ? delegiert
          ? copy.askToDelegate
          : copy.askToRegular
        : delegiert
          ? copy.askNewDelegate
          : copy.askNew;
      return htmlPage(
        heading(copy.heading) +
          para(fill(ask, vars)) +
          postButton(existing ? copy.buttonChange : copy.buttonNew),
        200,
        lang,
      );
    }

    const result = await meetingService.register({
      signerToken: token,
      delegierter: delegiert,
      force,
    });
    if (!result) return treffenLinkExpired(lang);
    const { isNew } = result;

    const done = pages.treffenDone;
    return htmlPage(
      heading(done.heading) +
        para(fill(done.text, vars)) +
        (delegiert ? para(done.delegate) : "") +
        (isNew ? "" : para(done.updated)) +
        buildMeetingInfo(zoomCfg, {
          pending: true,
          timingText: serverText("shortly", {}, zoomCfg.lang),
        }),
      200,
      lang,
    );
  } catch (err) {
    console.error(`${req.method} /api/treffen-anmelden error:`, err);
    return treffenLinkError(lang);
  }
}

// Retention periods and link lifetimes from the letter config; the privacy
// policy quotes the same values.

const meetingService = createMeetingService({
  repository: meetingRepository,
  registrations: {
    getSignerForZoomInvite,
    getCurrentZoomRegistrationByEmail,
    insertZoomRegistration,
    confirmZoomPending,
    getZoomRegistrationForMail,
    getZoomRecipients,
    purgePreviousTreffenRegistrations,
    purgeZoomRegistrationsAfter,
  },
  durableWork,
  getConfig: getZoomConfig,
  dispatchEmail,
  buildMail: buildMeetingMail,
  getRecipientIdentity,
  authorizeRecipient,
  issueUnsubscribeTokenForRecipient,
  markDeliveredForRecipient,
  retentionMs: TREFFEN_RETENTION_MS,
  canContinue: () => durableWork.status.ready,
});
const runZoomMailingWorker = () => meetingService.runWorker();

// runZoomMailingWorker is invoked by the Honker `maintenance` queue (see boot).

// Build/version info for GET /api/version: lets you confirm which commit is
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
// A campaign's texts in further languages from the admin form: per language
// an optional template id and subject; anything else is dropped. null with a
// single language, so such a campaign is stored as before.
function campaignI18n(raw) {
  if (!raw || typeof raw !== "object" || EXTRA_LANGS.length === 0) return null;
  const out = {};
  for (const l of EXTRA_LANGS) {
    const entry = raw[l];
    if (!entry || typeof entry !== "object") continue;
    const templateId = parseInt(entry.templateId, 10);
    const subject = String(entry.subject ?? "")
      .trim()
      .slice(0, 500);
    const own = {
      ...(Number.isInteger(templateId) && templateId > 0 && { templateId }),
      ...(subject && { subject }),
    };
    if (Object.keys(own).length) out[l] = own;
  }
  return Object.keys(out).length ? out : null;
}

function treffenSignupUrls(idOrToken, showDelegierter, lang) {
  const base = `${BASE_URL}/api/treffen-anmelden/${idOrToken}`;
  const url = (u) => withLang(cfg, u, lang);
  return {
    zoomJaUrl: url(showDelegierter ? `${base}?delegiert=0` : base),
    zoomJaDelegiertUrl: showDelegierter ? url(`${base}?delegiert=1`) : "",
  };
}

// Public read payloads, shared by the routes that serve them.
async function statsPayload() {
  const [stats, milestones] = await Promise.all([getStats(), getMilestones()]);
  const goal =
    milestones.find((m) => m > stats.total) ??
    milestones[milestones.length - 1];
  return { ...stats, milestones, goal };
}

async function zoomPayload(lang) {
  const [countRow, zoomCfg] = await Promise.all([
    getZoomRegistrationCount(),
    getZoomConfig(),
  ]);
  const zc = zoomIn(zoomCfg, lang);
  return {
    ...countRow,
    eventAt: zc.eventAtIso,
    showDelegierter: zc.showDelegierter,
    mode: zc.mode,
    location: zc.location,
    navLabel: zc.navLabel,
    label: zc.label,
  };
}

let jobInfrastructureReady = false;
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
  // DSGVO: sweep expired, never-confirmed sign-ups. The privacy policy promises
  // deletion once the 24h confirmation link has expired, so this has to run
  // often; a daily sweep left entries in place for up to ~48h. Re-registering
  // under the same name updates an existing deployment's schedule.
  await registerSchedule("purge-unverified", "maintenance", "@every 300s", {
    task: "purge-unverified",
  });
  // Failed transactional mails: drop their dead-letter rows after the TTL.
  await registerSchedule("purge-dead-emails", "maintenance", "@every 3600s", {
    task: "purge-dead-emails",
  });
  // Signatures and Treffen registrations past privacy.signerRetentionYears.
  await registerSchedule("purge-by-age", "maintenance", "30 3 * * *", {
    task: "purge-by-age",
  });
  jobInfrastructureReady = true;
} catch (error) {
  durableWork.unavailable("initialization-failed");
  console.error("[jobs] init failed:", error);
}

const requestDrain = createRequestDrain();
const server = Bun.serve(
  requestDrain.options({
    port: PORT,
    development: isDev,
    maxRequestBodySize: 10 * 1024 * 1024,

    routes: {
      "/": publicPage,
      [adminRoute]: admin,
      "/abmelden/:token": privatePage,
      ...languageRoutes,
      // Personal invite link: the normal page; the client shows the invite.
      ...(INVITES_ENABLED && { "/i/:code": privatePage }),
      ...(INVITES_ENABLED && languageInviteRoutes),

      "/bundles/*": {
        GET(req) {
          const asset = frontend.assets.get(new URL(req.url).pathname);
          return asset
            ? new Response(asset.bytes, {
                headers: {
                  "Content-Type": asset.type,
                  "Cache-Control": "public, max-age=31536000, immutable",
                  "Access-Control-Allow-Origin": "*",
                  "Cross-Origin-Resource-Policy": "cross-origin",
                },
              })
            : new Response("", { status: 404 });
        },
      },
      "/assets/:name": {
        async GET(req) {
          const asset = await assetLifecycle.get(`/assets/${req.params.name}`);
          return asset
            ? new Response(asset.bytes, {
                headers: {
                  "Content-Type": asset.mime,
                  "Cache-Control": "public, max-age=300",
                  "Access-Control-Allow-Origin": "*",
                  "X-Content-Type-Options": "nosniff",
                },
              })
            : new Response("", { status: 404 });
        },
      },
      "/api/admin/publication": {
        GET(req) {
          return adminJson(req, () =>
            json({
              ...publicationResponse(),
              defaults: Object.fromEntries(
                LANGUAGES.map((l) => [l, structuredClone(configFor(l))]),
              ),
              fields: publicationFields,
            }),
          );
        },
        PUT(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req, 2100000);
            const published = await publications.publish(
              body.document,
              body.expectedRevision,
              body.expectedId,
            );
            await recordAdminAction("website.publish", {
              targetId: published.revision,
            });
            return json(publicationResponse(published));
          });
        },
      },
      "/api/admin/publication/import": {
        POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req, 4200000);
            if (!Number.isInteger(body.revision) || body.revision < 0)
              return json(
                { error: "Die Entwurfsdatei enthält keine gültige Revision." },
                400,
              );
            const document = await publications.validate(body.document);
            const base = body.base
              ? await publications.validate(body.base)
              : undefined;
            return json({ document, base, revision: body.revision });
          });
        },
      },
      "/api/admin/publication/previous": {
        GET(req) {
          return adminJson(req, async () =>
            json({ document: await publications.previous() }),
          );
        },
      },
      "/api/admin/publication/preview": {
        POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req, 2100000);
            const output = await publications.preview(body.document);
            const lang = normalizeLang(cfg, body.lang);
            const html = documentHtml(
              output.configs[lang],
              LETTER_NAME,
              frontend.entries,
              { preview: true, pageState: body.pageState, baseUrl: BASE_URL },
            );
            const policy = `default-src 'none'; script-src ${new URL(BASE_URL).origin}; style-src 'unsafe-inline' ${new URL(BASE_URL).origin}; font-src ${new URL(BASE_URL).origin} data:; img-src ${new URL(BASE_URL).origin} data:; connect-src 'none'; form-action 'none'; base-uri 'none';`;
            return new Response(
              html.replace(
                "<head>",
                `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`,
              ),
              {
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              },
            );
          });
        },
      },
      "/api/admin/publication/assets": {
        POST(req) {
          return adminJson(req, async () => {
            const tooLarge = () => json({ error: "Image exceeds 8 MB" }, 413);
            if (Number(req.headers.get("content-length")) > MAX_IMAGE_BYTES)
              return tooLarge();
            // A chunked upload announces no length; count what arrived.
            const bytes = Buffer.from(await req.arrayBuffer());
            if (bytes.length > MAX_IMAGE_BYTES) return tooLarge();
            const asset = await normalizeImage(bytes);
            const url = await assetLifecycle.upload(asset);
            return json({ url, width: asset.width, height: asset.height });
          });
        },
      },
      "/api/admin/email": {
        GET(req) {
          return adminJson(req, async () =>
            json({
              ...(await emailManager.diagnostics()),
              jobs: durableWork.status,
            }),
          );
        },
        POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req);
            let result;
            if (body.action === "takeover")
              result = await emailManager.save(
                null,
                body.expectedRevision,
                true,
              );
            else if (body.action === "save")
              result = await emailManager.save(
                body.profile,
                body.expectedRevision,
              );
            else if (body.action === "test")
              result = await emailManager.test(
                body.expectedRevision,
                body.recipient,
              );
            else if (body.action === "receipt")
              result = await emailManager.confirmReceipt(
                body.expectedRevision,
                body.testId,
              );
            else if (body.action === "activate")
              result = await emailManager.activate(body.expectedRevision);
            else if (body.action === "reconcile")
              result = await emailManager.reconcile(
                body.scope,
                body.resolution,
                body.expectedRevision,
              );
            else if (body.action === "reconcile-all")
              result = await emailManager.reconcileAll(
                body.resolution,
                body.expectedRevision,
              );
            else if (body.action === "requeue-failed") {
              // The job handler skips mail that went out meanwhile or whose
              // signature is already confirmed or expired.
              await requeueDeadJobs("emails", EMAIL_JOB_TTL_S);
              result = await emailManager.diagnostics();
            } else return json({ error: "Unknown action" }, 400);
            if (["save", "takeover", "activate"].includes(body.action))
              await recordAdminAction("settings.email");
            else if (["reconcile", "reconcile-all"].includes(body.action))
              await recordAdminAction("email.reconcile");
            else if (body.action === "requeue-failed")
              await recordAdminAction("email.requeue-failed");
            refreshEmailFacts();
            return json(result);
          });
        },
      },
      "/api/admin/email/dns": {
        POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req);
            const domain = String(body.domain ?? "")
              .trim()
              .toLowerCase();
            // Validates the name before a token is stored under it.
            dnsInstructions(domain, "");
            const key = `mailbox-dns:${domain}`;
            let row = await sqlDb
              .query("SELECT value FROM app_settings WHERE key=?")
              .get(key);
            const token = row?.value || ownershipToken();
            if (!row)
              await sqlDb
                .query(
                  "INSERT INTO app_settings /* public-neutral */ (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING",
                )
                .run(key, token);
            return json(await checkMailboxDns(domain, token));
          });
        },
      },
      "/api/admin/backup": {
        GET(req) {
          return adminJson(req, async () => json(await backupStatus()));
        },
      },
      "/api/admin/statistics": {
        GET(req) {
          return adminJson(req, async () =>
            json({
              mode: publications.current.document.analytics.mode,
              revision: publications.current.revision,
              ...(statistics
                ? await statistics.report()
                : { unavailable: true }),
            }),
          );
        },
        PUT(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req);
            const document = structuredClone(publications.current.document);
            if (body.mode === "builtin" && !statistics)
              return json(
                { error: "Die Statistik ist derzeit nicht verfügbar." },
                503,
              );
            document.analytics = { mode: body.mode };
            await publications.publish(document, body.expectedRevision);
            await recordAdminAction("settings.statistics");
            return json({ ok: true });
          });
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
            ...LANGUAGES.flatMap((l) => [
              "  <url>",
              `    <loc>${BASE_URL}${langPrefix(cfg, l)}/</loc>`,
              `    <lastmod>${now}</lastmod>`,
              "    <changefreq>daily</changefreq>",
              "    <priority>1.0</priority>",
              "  </url>",
            ]),
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
          return json(
            {
              ok: db && durableWork.status.ready,
              db,
              jobs: durableWork.status,
            },
            db && durableWork.status.ready ? 200 : 503,
          );
        },
      },

      // For an uptime monitor: 503 as soon as mail, the mail queue or the
      // backups need a person. /api/health above stays the container's own
      // check, which must not fail a deploy over a paused mail profile.
      "/api/health/operations": {
        async GET(req) {
          const blocked = denyRate(req, "health-operations", 30, 60 * 1000);
          if (blocked) return blocked;
          const bearer = /^Bearer (.+)$/.exec(
            req.headers.get("authorization") || "",
          )?.[1];
          if (
            bearer &&
            !(
              HEALTH_TOKEN &&
              (await constantTimeSecretMatches(bearer, HEALTH_TOKEN))
            )
          )
            return json({ error: "Unauthorized" }, 401);
          let health;
          try {
            health = operationsHealth({
              db: await healthCheck(),
              jobs: durableWork.status,
              mail: await emailManager.diagnostics(),
              backup: await backupStatus(),
              uptimeMs: process.uptime() * 1000,
            });
          } catch (error) {
            console.error("GET /api/health/operations error:", error);
            return json({ ok: false, checks: { app: "down" } }, 503, {
              "Cache-Control": "no-store",
            });
          }
          const { details, ...open } = health;
          return json(bearer ? health : open, health.ok ? 200 : 503, {
            "Cache-Control": "no-store",
          });
        },
      },

      // Live initial state for the first render (counter, Treffen date), so the
      // page never paints placeholders that flash. Preloaded from the homepage
      // <head> and awaited in main.jsx; the fetches in App.jsx keep it live.
      "/api/boot": {
        async GET(req) {
          // No token (the preload runs before one exists), so share the token-
          // gated reads' per-IP budget instead of adding a separate one.
          const blocked = denyRate(req, "public-read", 120, 60 * 1000);
          if (blocked) return blocked;
          try {
            // The admin overrides for the page's language.
            const lang = reqLang(req);
            const [stats, zoom] = await Promise.all([
              statsPayload(),
              cfg.features.zoomEvent ? zoomPayload(lang) : null,
            ]);
            return json(
              { stats, zoom, email: { ready: emailManager.status.ready } },
              200,
              {
                "Cache-Control": "no-store",
              },
            );
          } catch (err) {
            console.error("GET /api/boot error:", err);
            return json({ error: "Internal server error" }, 500);
          }
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
            return json({ error: reqUi(req).errors.tooMany }, 429, {
              "Retry-After": String(retryAfter),
            });
          }
          return json({
            token: await createPublicToken(),
            expiresIn: PUBLIC_TOKEN_TTL_SECONDS,
          });
        },
      },

      // What an invite link shows. Only the inviter's first name, and only when
      // they opted in; the rate limit keeps codes from being enumerated.
      "/api/invite/:code": {
        async GET(req) {
          if (!INVITES_ENABLED) return featureOff();
          const blocked = await denyPublic(
            req,
            "invite-read",
            30,
            15 * 60 * 1000,
          );
          if (blocked) return blocked;
          try {
            const invite = await getInviteByCode(req.params.code);
            if (!invite) return json({ error: "Not found" }, 404);
            return json(invite, 200, { "Cache-Control": "no-store" });
          } catch (err) {
            console.error("GET /api/invite error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      // Private stats for an invite link. POST so the token stays out of URLs
      // and logs; below the threshold only "fewer than N" is returned.
      "/api/invite-stats": {
        async POST(req) {
          if (!INVITES_ENABLED) return featureOff();
          const blocked = denyRate(req, "invite-stats", 20, 15 * 60 * 1000);
          if (blocked) return blocked;
          try {
            if (bodyTooLarge(req))
              return json({ error: "Payload too large" }, 413);
            const body = await parseJsonBody(req);
            const stats = await getInviteStats(body.code, body.token);
            if (!stats) return json({ error: "Not found" }, 404);
            return json(
              statsDisplay(stats.count, resolveInvite(configFor(reqLang(req)))),
              200,
              { "Cache-Control": "no-store" },
            );
          } catch (err) {
            console.error("POST /api/invite-stats error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      "/api/stats": {
        async GET(req) {
          const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
          if (blocked) return blocked;
          try {
            return json(await statsPayload());
          } catch (err) {
            console.error("GET /api/stats error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      "/api/occupations": {
        async GET(req) {
          if (!OCCUPATION_ENABLED) return featureOff();
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

      "/api/signer-functions": {
        async GET(req) {
          if (!SIGNER_FUNCTION_ENABLED) return featureOff();
          const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
          if (blocked) return blocked;
          return json(await getSignerFunctions());
        },
      },

      "/api/kreisverband-stats": {
        async GET(req) {
          if (!KV_ENABLED) return featureOff();
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
          if (SIGNING_PAUSED) return signingPausedApi(req);
          // Mail being down doesn't stop signing: the confirmation mail
          // waits in the queue and goes out once sending works again.
          if (!durableWork.status.ready)
            return json(
              {
                error:
                  configFor(reqLang(req)).ui.errors.emailUnavailable ||
                  "Email delivery is temporarily unavailable. Please try again later.",
                pending: true,
              },
              503,
            );
          try {
            const ip = getClientIp(req);
            const { allowed, retryAfter } = checkRateLimit(
              ip,
              "sign",
              30,
              15 * 60 * 1000,
            );
            if (!allowed) {
              return json({ error: reqUi(req).errors.tooMany }, 429, {
                "Retry-After": String(retryAfter),
              });
            }

            if (bodyTooLarge(req))
              return json({ error: "Payload too large" }, 413);
            const body = await parseJsonBody(req);
            const name = sanitize(body.name);
            const email = sanitizeEmail(body.email);
            const kv = KV_ENABLED ? normalizeKv(body.kv) : "";
            const occupation = OCCUPATION_ENABLED
              ? sanitize(body.occupation || "", OCCUPATION_LIMIT)
              : "";
            const signerFunction = SIGNER_FUNCTION_ENABLED
              ? sanitize(body.signerFunction || "", SIGNER_DETAIL_LIMIT)
              : "";
            const newsletter = Boolean(body.newsletter);
            const showPublicly = body.agree === true;
            const showSignerDetails =
              cfg.features.publicSignerDetails &&
              body.showSignerDetails === true;
            // Unknown codes are dropped at confirm (nothing matches them); a
            // malformed one isn't stored at all.
            const inviteRef =
              INVITES_ENABLED && isInviteCode(body.ref) ? body.ref : null;
            const inviteShowName =
              INVITES_ENABLED && body.inviteShowName === true;

            if (name.length < 2) {
              return json({ error: reqUi(req).errors.nameTooShort }, 400);
            }
            if (!isValidEmail(email)) {
              return json({ error: reqUi(req).errors.invalidEmail }, 400);
            }

            const token = crypto.randomUUID();
            const expiresAt = mailWaitExpiry();

            const delivery = emailManager.status.ready
              ? {}
              : { emailDelayed: true };
            return await durableWork.run(async () => {
              const { ok, alreadyVerified, blocked } = await insertSigner({
                name,
                email,
                kv,
                occupation,
                signerFunction,
                newsletter,
                showPublicly,
                showSignerDetails,
                token,
                expiresAt,
                inviteRef,
                inviteShowName,
                // The page's language, for this person's mails and link pages.
                lang: storedLang(cfg, reqLang(req)),
              });

              // Same answer as any sign-up, so a blocked address can't tell.
              if (blocked) return json({ ok: true, ...delivery });

              const signerId = await getSignerIdByEmail(email);
              if (!ok && alreadyVerified) {
                if (signerId) {
                  await queueEmail("already-signed", {
                    signerId,
                    baseUrl: getBaseUrl(req),
                  });
                }
                return json({ ok: true, ...delivery });
              }

              await queueEmail("verification", {
                signerId,
                baseUrl: getBaseUrl(req),
              });

              return json({ ok: true, ...delivery });
            });
          } catch (err) {
            console.error("POST /api/sign error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      "/api/zoom-register": {
        async POST(req) {
          if (!durableWork.status.ready || !emailManager.status.ready)
            return json(
              {
                error:
                  configFor(reqLang(req)).ui.errors.emailUnavailable ||
                  "Email delivery is temporarily unavailable. Please try again later.",
                pending: true,
              },
              503,
            );
          if (!ZOOM_ENABLED) return featureOff();
          try {
            const ip = getClientIp(req);
            const { allowed, retryAfter } = checkRateLimit(
              ip,
              "zoom",
              30,
              15 * 60 * 1000,
            );
            if (!allowed) {
              return json({ error: reqUi(req).errors.tooMany }, 429, {
                "Retry-After": String(retryAfter),
              });
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
              return json({ error: reqUi(req).errors.nameTooShort }, 400);
            }
            if (!isValidEmail(email)) {
              return json({ error: reqUi(req).errors.invalidEmail }, 400);
            }

            // Double opt-in: nothing is registered (or overwritten) until the
            // address confirms via the mailed link. Same answer either way, so
            // the response doesn't reveal whether an address is registered.
            return await durableWork.run(async () => {
              const pending = await insertZoomPending({
                name,
                email,
                kv,
                delegierter,
                token: crypto.randomUUID(),
                expiresAt: confirmationExpiry(),
                lang: storedLang(cfg, reqLang(req)),
              });
              if (pending.status === "pending") {
                await queueEmail("treffen-verification", {
                  pendingId: pending.id,
                  baseUrl: getBaseUrl(req),
                });
              } else {
                // Already registered: tell the address so, with its settings link,
                // instead of leaving them waiting for a confirmation mail.
                await queueEmail("treffen-already-registered", {
                  registrationId: pending.id,
                  baseUrl: getBaseUrl(req),
                });
              }

              return json({ ok: true });
            });
          } catch (err) {
            console.error("POST /api/zoom-register error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      "/api/zoom-count": {
        async GET(req) {
          if (!ZOOM_ENABLED) return featureOff();
          const blocked = await denyPublic(req, "public-read", 120, 60 * 1000);
          if (blocked) return blocked;
          try {
            return json(await zoomPayload(reqLang(req)));
          } catch (err) {
            console.error("GET /api/zoom-count error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      "/api/termin.ics": {
        async GET(req) {
          if (!ZOOM_ENABLED) return featureOff();
          const blocked = denyRate(req, "ics", 60, 15 * 60 * 1000);
          if (blocked) return blocked;
          const lang = reqLang(req);
          const cfg = zoomIn(await getZoomConfig(), lang);
          if (!cfg.dateSet) {
            return new Response(serverText("noDateYet", {}, lang), {
              status: 404,
            });
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
          if (SIGNING_PAUSED) return signingPausedApi(req);
          // Mail being down doesn't refuse the request either: the mail
          // waits in the queue and goes out once sending works again.
          if (!durableWork.status.ready)
            return json(
              {
                error:
                  configFor(reqLang(req)).ui.errors.emailUnavailable ||
                  "Email delivery is temporarily unavailable. Please try again later.",
                pending: true,
              },
              503,
            );
          try {
            const ip = getClientIp(req);
            const { allowed, retryAfter } = checkRateLimit(
              ip,
              "resend",
              12,
              15 * 60 * 1000,
            );
            if (!allowed) {
              return json({ error: reqUi(req).errors.tooMany }, 429, {
                "Retry-After": String(retryAfter),
              });
            }

            if (bodyTooLarge(req))
              return json({ error: "Payload too large" }, 413);
            const body = await parseJsonBody(req);
            const email = sanitizeEmail(body.email);
            if (!isValidEmail(email)) return json({ ok: true });

            const token = crypto.randomUUID();
            const expiresAt = mailWaitExpiry();
            return await durableWork.run(async () => {
              const name = await refreshVerificationToken(
                email,
                token,
                expiresAt,
              );

              if (name) {
                await queueEmail("verification", {
                  signerId: await getSignerIdByEmail(email),
                  baseUrl: getBaseUrl(req),
                });
              }

              return json({
                ok: true,
                ...(emailManager.status.ready ? {} : { emailDelayed: true }),
              });
            });
          } catch (err) {
            console.error("POST /api/resend-verification error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      // Sign-up confirmation link. GET shows what will be published; confirming
      // happens on the button's POST, so a mail security scanner that opens the
      // link can't confirm a sign-up somebody else submitted for this address.
      "/api/confirm/:token": {
        async GET(req) {
          if (SIGNING_PAUSED) return signingPausedPage(req);
          const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          try {
            const pending = await getPendingSignerByToken(req.params.token);
            const lang = linkLang(req, pending?.lang);
            if (!pending) {
              return Response.redirect(
                `${getBaseUrl(req)}${langPrefix(cfg, lang)}/?error=token-expired`,
                302,
              );
            }
            const copy = pagesIn(lang).confirmSignature;
            const fields = configFor(lang).sign?.fields;
            const yesNo = (v) => (v ? copy.yes : copy.no);
            const rows = [
              `${copy.nameLabel}: ${escapeHtml(pending.name)}`,
              pending.kreisverband &&
                `${escapeHtml(fields?.kreisverband?.label || "Kreisverband")}: ${escapeHtml(pending.kreisverband)}`,
              pending.occupation &&
                `${escapeHtml(fields?.occupation?.label || "Beruf")}: ${escapeHtml(pending.occupation)}`,
              fields?.signerFunction &&
                pending.signerFunction &&
                `${escapeHtml(fields.signerFunction.label)}: ${escapeHtml(pending.signerFunction)}`,
              `${copy.publicLabel}: ${yesNo(pending.show_publicly)}`,
              cfg.features.publicSignerDetails &&
                `${escapeHtml(configFor(lang).sign.publicDetailsLabel)}: ${yesNo(pending.show_signer_details)}`,
              `${copy.newsletterLabel}: ${yesNo(pending.newsletter)}`,
              INVITES_ENABLED &&
                `${copy.inviteNameLabel}: ${
                  pending.invite_show_name
                    ? escapeHtml(inviteDisplayName(pending.name))
                    : copy.no
                }`,
            ].filter(Boolean);
            return htmlPage(
              heading(copy.heading) +
                para(copy.intro) +
                para(rows.join("<br>")) +
                postButton(copy.button) +
                para(copy.note),
              200,
              lang,
            );
          } catch (err) {
            console.error("GET /api/confirm error:", err);
            return Response.redirect(
              `${BASE_URL}${langPrefix(cfg, reqLang(req))}/?error=server-error`,
              302,
            );
          }
        },
        async POST(req) {
          if (SIGNING_PAUSED) return signingPausedPage(req);
          if (!durableWork.status.ready)
            return json(
              {
                error:
                  "Hintergrundverarbeitung ist vorübergehend nicht verfügbar.",
                pending: true,
              },
              503,
            );
          const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          let prefix = langPrefix(cfg, reqLang(req));
          try {
            const signer = await durableWork.run(async () => {
              const confirmed = await confirmSigner(req.params.token);
              if (confirmed && INVITES_ENABLED && confirmed.inviteCode)
                await queueEmail("invite", {
                  signerId: confirmed.id,
                  baseUrl: getBaseUrl(req),
                });
              return confirmed;
            });
            if (signer) {
              prefix = langPrefix(cfg, linkLang(req, signer.lang));
              if (cfg.features.stateResolution && signer.kreisverband) {
                enqueueStateResolution(signer.id, signer.kreisverband);
              }
              if (INVITES_ENABLED && signer.inviteCode) {
                // The invite code isn't secret (it's what gets shared), but the
                // invite page is the one without analytics. The stats token only
                // goes out in the mail.
                return Response.redirect(
                  `${getBaseUrl(req)}${prefix}/i/${signer.inviteCode}?confirmed=1`,
                  303,
                );
              }
              return Response.redirect(
                `${getBaseUrl(req)}${prefix}/?confirmed=1`,
                303,
              );
            }
            return Response.redirect(
              `${getBaseUrl(req)}${prefix}/?error=token-expired`,
              303,
            );
          } catch (err) {
            console.error("POST /api/confirm error:", err);
            return Response.redirect(
              `${BASE_URL}${prefix}/?error=server-error`,
              303,
            );
          }
        },
      },

      "/api/request-deletion": {
        async POST(req) {
          if (!durableWork.status.ready || !emailManager.status.ready)
            return json(
              {
                error:
                  configFor(reqLang(req)).ui.errors.emailUnavailable ||
                  "Email delivery is temporarily unavailable. Please try again later.",
                pending: true,
              },
              503,
            );
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
            const expiresAt = confirmationExpiry();

            return await durableWork.run(async () => {
              const requestId = await createDeletionRequest(
                email,
                token,
                expiresAt,
                storedLang(cfg, reqLang(req)),
              );
              if (requestId) {
                await queueEmail("deletion", {
                  requestId,
                  baseUrl: getBaseUrl(req),
                });
              }

              return json({ ok: true });
            });
          } catch (err) {
            console.error("POST /api/request-deletion error:", err);
            return json(
              {
                error: "Email delivery is temporarily unavailable.",
                pending: true,
              },
              503,
            );
          }
        },
      },

      // Deletion link. GET only asks; deleting happens on the button's POST, so a
      // mail scanner opening the link (e.g. after a stranger requested deletion
      // for this address) can't erase anything.
      "/api/delete/:token": {
        async GET(req) {
          const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          const lang = await deletionLang(req);
          const copy = pagesIn(lang).deleteData;
          return htmlPage(
            heading(copy.heading) +
              para(copy.text) +
              postButton(copy.button) +
              para(copy.note),
            200,
            lang,
          );
        },
        async POST(req) {
          const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          let prefix = langPrefix(cfg, reqLang(req));
          try {
            // Read before the request row goes with the deletion.
            prefix = langPrefix(cfg, await deletionLang(req));
            const deleted = await deleteByDeletionToken(req.params.token);
            return Response.redirect(
              `${getBaseUrl(req)}${prefix}/${deleted ? "?deleted=1" : "?error=delete-token-expired"}`,
              303,
            );
          } catch (err) {
            console.error("POST /api/delete error:", err);
            return Response.redirect(
              `${BASE_URL}${prefix}/?error=server-error`,
              303,
            );
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
            const email = await resolveEmailFromToken(req.params.token, null, {
              optOut: true,
            });
            if (!email) return json({ ok: false }, 404);
            await optOutNewsletterByEmail(email);
            return json({ ok: true });
          } catch (err) {
            console.error(
              "POST /api/unsubscribe/newsletter-opt-out error:",
              err,
            );
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      "/api/unsubscribe/:token/zoom-opt-out": {
        async POST(req) {
          const blocked = denyRate(req, "unsub", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          try {
            const email = await resolveEmailFromToken(req.params.token, null, {
              optOut: true,
            });
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
            const email = await resolveEmailFromToken(req.params.token, null, {
              optOut: true,
            });
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
              return json({ error: reqUi(req).errors.tooMany }, 429, {
                "Retry-After": String(retryAfter),
              });
            }

            if (bodyTooLarge(req))
              return json({ error: "Payload too large" }, 413);

            const email = await resolveEmailFromToken(req.params.token);
            if (!email) return json({ ok: false }, 404);

            const body = await parseJsonBody(req);
            const name = sanitize(body.name || "");
            const kv = KV_ENABLED
              ? normalizeKv(body.kv, await getSignerKreisverband(email))
              : "";
            const occupation = OCCUPATION_ENABLED
              ? sanitize(body.occupation || "", OCCUPATION_LIMIT)
              : "";
            const signerFunction =
              SIGNER_FUNCTION_ENABLED && body.signerFunction !== undefined
                ? sanitize(body.signerFunction || "", SIGNER_DETAIL_LIMIT)
                : undefined;
            const newsletter = Boolean(body.newsletter);
            const showPublicly = body.showPublicly === true;
            // Honoured only for a signer who has this choice.
            const showSignerDetails =
              typeof body.showSignerDetails === "boolean"
                ? body.showSignerDetails
                : undefined;
            // Only honor the delegate flag while the field is enabled.
            const delegierter =
              (await getShowDelegierter()) && Boolean(body.delegierter);

            if (name.length < 2) {
              return json({ error: reqUi(req).errors.nameTooShort }, 400);
            }

            await updateSignerByEmail(email, {
              name,
              kreisverband: kv,
              occupation,
              signerFunction,
              newsletter,
              showPublicly,
              showSignerDetails,
              inviteShowName: INVITES_ENABLED
                ? Boolean(body.inviteShowName)
                : undefined,
            });
            await updateZoomByEmail(email, {
              name,
              // The Treffen form collects a KV regardless of kreisverbandField.
              kreisverband: sanitize(body.kv || "").replace(/^KV\s*/i, ""),
              delegierter,
            });

            if (cfg.features.stateResolution && kv) {
              const signer = await getSignerStateByEmail(email);
              if (signer && !signer.state) {
                enqueueStateResolution(signer.id, signer.kreisverband);
              }
            }

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
            const source =
              new URL(req.url).searchParams.get("from") === "zoom"
                ? "zoom"
                : "newsletter";
            const ok = await deleteSignerByUnsubscribeToken(
              req.params.token,
              source,
            );
            if (!ok) return json({ ok: false }, 404);
            return json({ ok: true });
          } catch (err) {
            console.error("POST /api/unsubscribe/delete error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      // Confirmation link from the Treffen sign-up mail. GET only shows what will
      // be registered; the registration happens on the button's POST, so a mail
      // scanner following the link can't sign anyone up.
      "/api/treffen-bestaetigen/:token": {
        async GET(req) {
          if (!ZOOM_ENABLED) return featureOff();
          const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          let lang = linkLang(req);
          try {
            const pending = await getZoomPendingByToken(req.params.token);
            lang = linkLang(req, pending?.lang);
            if (!pending) return treffenLinkExpired(lang);
            const zoomCfg = zoomIn(await getZoomConfig(), lang);
            const copy = pagesIn(lang).treffenConfirm;
            const fields = configFor(lang).sign?.fields;
            const details = [
              `${copy.nameLabel}: ${escapeHtml(pending.name)}`,
              pending.kreisverband &&
                `${escapeHtml(fields?.kreisverband?.label || "Kreisverband")}: ${escapeHtml(pending.kreisverband)}`,
            ].filter(Boolean);
            return htmlPage(
              heading(copy.heading) +
                para(
                  fill(copy.intro, {
                    firstName: firstNameHtml(pending.name),
                    when: escapeHtml(zoomCfg.whenPhrase),
                  }),
                ) +
                para(details.join("<br>")) +
                (zoomCfg.showDelegierter && pending.delegierter
                  ? para(copy.delegate)
                  : "") +
                postButton(copy.button),
              200,
              lang,
            );
          } catch (err) {
            console.error("GET /api/treffen-bestaetigen error:", err);
            return treffenLinkError(lang);
          }
        },
        async POST(req) {
          if (!durableWork.status.ready)
            return json(
              {
                error:
                  "Hintergrundverarbeitung ist vorübergehend nicht verfügbar.",
                pending: true,
              },
              503,
            );
          if (!ZOOM_ENABLED) return featureOff();
          const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          let lang = linkLang(req);
          try {
            const reg = await meetingService.confirm(req.params.token);
            if (!reg) return treffenLinkExpired(lang);
            lang = linkLang(req, reg.lang);
            const pages = pagesIn(lang);
            const zoomCfg = zoomIn(await getZoomConfig(), lang);
            return htmlPage(
              heading(pages.treffenDone.heading) +
                para(
                  fill(pages.treffenDone.text, {
                    firstName: firstNameHtml(reg.name),
                  }),
                ) +
                buildMeetingInfo(zoomCfg, {
                  pending: true,
                  timingText: serverText("shortly", {}, zoomCfg.lang),
                }),
              200,
              lang,
            );
          } catch (err) {
            console.error("POST /api/treffen-bestaetigen error:", err);
            return treffenLinkError(lang);
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
          if (!ZOOM_ENABLED) return featureOff();
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

      // One-click Treffen registration from a newsletter invite (see
      // treffenAnmelden). These links don't expire with the token's age.
      "/api/treffen-anmelden/:token": {
        GET: (req) => treffenAnmelden(req, { commit: false }),
        POST: (req) => treffenAnmelden(req, { commit: true }),
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

      // The link in the "Newsletter-Einwilligung" mail. GET only shows the
      // button; subscribing happens on its POST, so a mail scanner that opens
      // the link subscribes nobody.
      "/api/newsletter-einwilligung/:token": {
        async GET(req) {
          const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          try {
            const signer = await getNewsletterOptIn(req.params.token);
            const lang = linkLang(req, signer?.lang);
            const copy = newsletterOptInCopy(lang);
            if (!signer)
              return htmlPage(
                heading(copy.expiredHeading) + para(copy.expiredText),
                404,
                lang,
              );
            if (signer.newsletter)
              return htmlPage(
                heading(copy.doneHeading) + para(copy.doneText),
                200,
                lang,
              );
            return htmlPage(
              heading(copy.heading) +
                para(
                  fill(copy.intro, { firstName: firstNameHtml(signer.name) }),
                ) +
                postButton(copy.button) +
                para(copy.note),
              200,
              lang,
            );
          } catch (err) {
            console.error("GET /api/newsletter-einwilligung error:", err);
            return htmlPage(
              heading(pages.error.heading) + para(pages.error.text),
              500,
            );
          }
        },
        async POST(req) {
          const blocked = denyRate(req, "token-link", 120, 15 * 60 * 1000);
          if (blocked) return blocked;
          try {
            const signer = await confirmNewsletterOptIn(req.params.token);
            const lang = linkLang(req, signer?.lang);
            const copy = newsletterOptInCopy(lang);
            return signer
              ? htmlPage(
                  heading(copy.doneHeading) + para(copy.doneText),
                  200,
                  lang,
                )
              : htmlPage(
                  heading(copy.expiredHeading) + para(copy.expiredText),
                  404,
                  lang,
                );
          } catch (err) {
            console.error("POST /api/newsletter-einwilligung error:", err);
            return htmlPage(
              heading(pages.error.heading) + para(pages.error.text),
              500,
            );
          }
        },
      },

      "/api/admin/login": {
        async POST(req) {
          try {
            const tooMany = ({ retryAfter }) =>
              json({ error: "Zu viele Anmeldeversuche." }, 429, {
                "Retry-After": String(retryAfter),
              });
            const perAddress = checkRateLimit(
              getClientIp(req),
              "admin-login",
              LOGIN_ATTEMPTS_PER_ADDRESS,
              LOGIN_WINDOW_MS,
            );
            if (!perAddress.allowed) return tooMany(perAddress);
            // Every attempt holds a slot of the shared budget until it turns
            // out to be a sign-in, so a burst cannot slip past the ceiling.
            const overall = checkRateLimit(
              "all",
              "admin-login-failures",
              LOGIN_FAILURES_OVERALL,
              LOGIN_WINDOW_MS,
            );
            if (!overall.allowed) return tooMany(overall);

            const body = await parseJsonBody(req);
            if (!(await constantTimePasswordMatches(body.password))) {
              // The address only: what was typed must never reach a log.
              console.warn(`[admin] failed login from ${getClientIp(req)}`);
              return json({ error: "Unauthorized" }, 401);
            }
            releaseRateLimit("all", "admin-login-failures");
            return json({ token: await adminSessions.issue() });
          } catch (err) {
            if (err.status === 413 || err.status === 400)
              return json({ error: err.message }, err.status);
            if (err instanceof SyntaxError)
              return json({ error: "Ungültige Anfrage." }, 400);
            console.error("POST /api/admin/login error:", err);
            return json({ error: "Internal server error" }, 500);
          }
        },
      },

      // Ends every admin session at once, the caller's included.
      "/api/admin/logout-everywhere": {
        POST(req) {
          return adminJson(req, async () => {
            await adminSessions.revokeAll();
            await recordAdminAction("session.logout-everywhere");
            console.info("[admin] every session ended");
            return json({ ok: true });
          });
        },
      },

      "/api/admin/templates": {
        async GET(req) {
          return adminJson(req, async () =>
            json(
              memoryTemplates().map((t) => ({
                ...t,
                revision: publications.current.revision,
              })),
            ),
          );
        },
        async POST(req) {
          return adminJson(req, async () => {
            if (bodyTooLarge(req))
              return json({ error: "Die Anfrage ist zu groß." }, 413);
            const body = await parseJsonBody(req);
            const name = sanitize(body.name, 120);
            const subject = sanitize(body.subject, 240);
            const htmlBody = sanitizeHtml(body.html_body);
            if (!name || !subject || !htmlBody) {
              return json({ error: "Ergänze die erforderlichen Felder." }, 400);
            }
            const document = structuredClone(publications.current.document);
            const id = await publications.nextTemplateId();
            const template = {
              id,
              slug: `newsletter-${crypto.randomUUID()}`,
              name,
              subject,
              html_body: htmlBody,
            };
            document.templates.push(template);
            const published = await publications.publish(
              document,
              body.expectedRevision,
            );
            await recordAdminAction("template.create", { targetId: id });
            return json({ ...template, revision: published.revision }, 201);
          });
        },
      },

      "/api/admin/templates/:id": {
        async GET(req) {
          return adminJson(req, async () => {
            const template = memoryTemplate(parseInt(req.params.id, 10));
            if (!template) return json({ error: "Not found" }, 404);
            return json({
              ...template,
              revision: publications.current.revision,
            });
          });
        },
        async PUT(req) {
          return adminJson(req, async () => {
            if (bodyTooLarge(req))
              return json({ error: "Die Anfrage ist zu groß." }, 413);
            const body = await parseJsonBody(req);
            const subject = sanitize(body.subject, 240);
            const htmlBody = sanitizeHtml(body.html_body);
            if (!subject || !htmlBody)
              return json({ error: "Ergänze die erforderlichen Felder." }, 400);
            const document = structuredClone(publications.current.document);
            const template = document.templates.find(
              (t) => t.id === Number(req.params.id),
            );
            if (!template) return json({ error: "Not found" }, 404);
            template.subject = subject;
            template.html_body = htmlBody;
            const published = await publications.publish(
              document,
              body.expectedRevision,
            );
            await recordAdminAction("template.update", {
              targetId: template.id,
            });
            return json({ ...template, revision: published.revision });
          });
        },
        async DELETE(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req);
            const document = structuredClone(publications.current.document);
            document.templates = document.templates.filter(
              (t) => t.id !== Number(req.params.id),
            );
            const published = await publications.publish(
              document,
              body.expectedRevision,
            );
            await recordAdminAction("template.delete", {
              targetId: Number(req.params.id),
            });
            return json({ ok: true, revision: published.revision });
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
              return json({ error: "Die Anfrage ist zu groß." }, 413);
            const body = await parseJsonBody(req);
            if (
              typeof body.request_key !== "string" ||
              !/^[a-zA-Z0-9-]{16,80}$/.test(body.request_key)
            )
              return json(
                {
                  error:
                    "Die Kennung für diesen Versandauftrag fehlt. Öffne den Nachrichtenentwurf erneut.",
                },
                400,
              );
            const templateId = parseInt(body.template_id, 10);
            const subject = sanitize(body.subject, 240);
            let scheduledAt;
            try {
              scheduledAt = campaignSchedule(body);
            } catch (error) {
              return json({ error: error.message }, 400);
            }
            const audience = [
              "newsletter",
              "zoom",
              "zoom_delegates",
              "selection",
              "email_not_zoom",
            ].includes(body.audience)
              ? body.audience
              : "newsletter";
            if (
              !templateId ||
              !subject ||
              Number.isNaN(scheduledAt.getTime())
            ) {
              return json(
                { error: "Prüfe Vorlage, Betreff und Versandtermin." },
                400,
              );
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
              if (recipientIds.length > SELECTION_LIMIT) {
                return json(
                  { error: "Zu viele Empfänger*innen (max. 20.000)" },
                  400,
                );
              }
            }
            return await durableWork.run(async () => {
              const campaign = await createCampaign({
                templateId,
                subject,
                scheduledAt,
                audience,
                recipientIds,
                i18n: campaignI18n(body.i18n),
                requestKey: body.request_key,
                sendNow: body.send_now === true,
              });
              if (!campaign)
                return json(
                  {
                    error:
                      "Wähle für jede Sprache eine Newsletter-Vorlage. Systemnachrichten können nicht als Rundmail gesendet werden.",
                  },
                  400,
                );
              if (!campaign.replayed) {
                const activeIds = new Set(
                  publications.current.document.templates.map((t) => t.id),
                );
                const requestedIds = [
                  templateId,
                  ...Object.values(campaignI18n(body.i18n) || {})
                    .map((v) => v?.templateId)
                    .filter(Boolean),
                ];
                if (requestedIds.some((id) => !activeIds.has(Number(id))))
                  throw Object.assign(
                    new Error(
                      "Diese Vorlage ist archiviert. Wähle eine aktuelle Newsletter-Vorlage.",
                    ),
                    { status: 400 },
                  );
              }
              // Durable send job, delivered at the scheduled time.
              if (!campaign.replayed)
                await recordAdminAction("campaign.create", {
                  targetId: campaign.id,
                  count: campaign.recipient_count ?? null,
                });
              if (!campaign.replayed)
                await enqueueJob(
                  "campaigns",
                  { campaignId: campaign.id },
                  {
                    runAt: Math.floor(scheduledAt.getTime() / 1000),
                    maxAttempts: 5,
                  },
                );
              return json(campaign, campaign.replayed ? 200 : 201);
            });
          });
        },
      },

      "/api/admin/campaigns/:id/recipients": {
        GET(req) {
          return adminJson(req, async () => {
            const campaign = await getCampaignById(Number(req.params.id));
            if (!campaign)
              return json({ error: "Kampagne nicht gefunden." }, 404);
            if (campaign.audience !== "selection")
              return json(
                { error: "Diese Kampagne hat keine feste Empfängerauswahl." },
                400,
              );
            const offset = Number(
              new URL(req.url).searchParams.get("offset") || 0,
            );
            if (!Number.isInteger(offset) || offset < 0)
              return json({ error: "Ungültige Seite." }, 400);
            return json({
              ...(await selectedNewsletterSigners(
                campaign.recipient_ids,
                {},
                { limit: 25, offset },
              )),
              savedCount: campaign.recipient_ids.length,
              offset,
            });
          });
        },
      },

      "/api/admin/campaigns/:id": {
        async DELETE(req) {
          return adminJson(req, async () => {
            const deleted = await cancelCampaign(parseInt(req.params.id, 10));
            if (!deleted)
              return json(
                {
                  error:
                    "Diese Kampagne kann nicht abgesagt werden. Lade den Verlauf und prüfe ihren Status.",
                },
                400,
              );
            await recordAdminAction("campaign.cancel", {
              targetId: parseInt(req.params.id, 10),
            });
            return json({ ok: true });
          });
        },
      },

      "/api/admin/campaigns/:id/stop": {
        POST(req) {
          return adminJson(req, async () => {
            const id = parseInt(req.params.id, 10);
            const reached = await stopCampaign(id);
            if (reached === null)
              return json(
                {
                  error:
                    "Dieser Versand läuft nicht mehr. Lade den Verlauf erneut.",
                },
                409,
              );
            await recordAdminAction("campaign.stop", {
              targetId: id,
              count: reached,
            });
            return json({ ok: true, reached });
          });
        },
      },

      // An aborted campaign gets a fresh set of attempts; recipients already
      // reached stay in the delivery log and aren't mailed again.
      "/api/admin/campaigns/:id/retry": {
        GET(req) {
          return adminJson(req, async () => {
            const campaign = await getCampaignById(Number(req.params.id));
            if (!campaign || campaign.status !== "aborted")
              return json(
                {
                  error:
                    "Die Kampagne ist nicht mehr angehalten. Lade den Verlauf erneut.",
                },
                409,
              );
            const template =
              memoryTemplate(campaign.template_id) ||
              (await getEmailTemplate(campaign.template_id));
            if (!template)
              return json(
                {
                  error:
                    "Die Standardvorlage fehlt. Repariere sie im Bereich Vorlagen.",
                },
                400,
              );
            const [recipients, delivered] = await Promise.all([
              getCampaignRecipients(campaign),
              getDeliveredEmails(`campaign:${campaign.id}`),
            ]);
            const remaining = recipients.filter(
              (person) => !delivered.has(person.email),
            );
            const byLanguage = {};
            for (const person of remaining) {
              const language = normalizeLang(cfg, person.lang);
              byLanguage[language] = (byLanguage[language] || 0) + 1;
            }
            const variables = emailPreviewVariables(
              (await getZoomConfig()).label,
            );
            const versions = await Promise.all(
              LANGUAGES.map(async (language) => {
                const version = await campaignVersion(
                  campaign,
                  template,
                  language,
                );
                return {
                  language,
                  count: byLanguage[language] || 0,
                  templateName: version.template.name,
                  templateId: version.template.id,
                  subject: version.subject,
                  subjectExample: interpolateTemplate(
                    version.subject,
                    variables,
                  ),
                  fallback:
                    language !== DEFAULT_LANG &&
                    version.template.id === template.id,
                };
              }),
            );
            return json({
              id: campaign.id,
              audience: campaign.audience || "newsletter",
              eligible: recipients.length,
              alreadyAccepted: delivered.size,
              remaining: remaining.length,
              versions,
              checkedAt: new Date().toISOString(),
            });
          });
        },
        async POST(req) {
          return adminJson(req, async () => {
            if (!durableWork.status.ready) throw new JobsUnavailable();
            const ok = await retryAbortedCampaign(parseInt(req.params.id, 10));
            if (!ok) {
              return json(
                {
                  error:
                    "Diese Kampagne ist nicht abgebrochen oder ihr Zustellprotokoll ist zu alt. Ein erneuter Versuch könnte Nachrichten doppelt senden.",
                },
                400,
              );
            }
            await recordAdminAction("campaign.retry", {
              targetId: parseInt(req.params.id, 10),
            });
            return json({ ok: true });
          });
        },
      },

      "/api/admin/signers": {
        async GET(req) {
          return adminJson(req, async () => {
            const params = new URL(req.url).searchParams;
            const limit = parseInt(params.get("limit") || "50", 10);
            const offset = parseInt(params.get("offset") || "0", 10);
            const { search, dateFrom, dateTo } = parseSignerFilters(req);
            return json(
              await listSigners({
                search,
                dateFrom,
                dateTo,
                visibility: params.get("public") || "",
                limit: Number.isNaN(limit) ? 50 : limit,
                offset: Number.isNaN(offset) ? 0 : offset,
              }),
            );
          });
        },
      },

      // "Ausgewählte entfernen und sperren", and the other sign-ups of a
      // mailbox after one of them was removed.
      "/api/admin/signers/remove": {
        async POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req);
            if (
              !Array.isArray(body.ids) ||
              !body.ids.length ||
              body.ids.length > 100 ||
              body.ids.some((id) => !Number.isInteger(id) || id < 1)
            )
              return json(
                { error: "Wähle höchstens 100 Unterschriften aus." },
                400,
              );
            const result = await removeAndBlockSigners([...new Set(body.ids)]);
            console.info(
              `[admin] ${result.removed} signature(s) removed and addresses blocked`,
            );
            return json({ ok: true, ...result });
          });
        },
      },

      "/api/admin/signers/blocks": {
        async GET(req) {
          return adminJson(req, async () => {
            const offset = parseInt(
              new URL(req.url).searchParams.get("offset") || "0",
              10,
            );
            return json(
              await listSigningBlocks({
                offset: Number.isNaN(offset) ? 0 : offset,
              }),
            );
          });
        },
      },

      // POST, so the address is in the body and in no access log.
      "/api/admin/signers/lookup": {
        async POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req);
            const email = sanitizeEmail(body.email);
            if (!isValidEmail(email))
              return json({ error: "Ungültige E-Mail-Adresse." }, 400);
            const found = await lookupSignups(email);
            if (!ZOOM_ENABLED) delete found.meeting;
            return json({ email, ...found });
          });
        },
      },

      "/api/admin/signers/:id": {
        async GET(req) {
          return adminJson(req, async () => {
            const signer = await getSignerForAdmin(signerId(req));
            if (!signer)
              return json({ error: "Unterschrift nicht gefunden." }, 404);
            return json(signer);
          });
        },
        // The edit panel. Fields the request leaves out stay as they are.
        async PATCH(req) {
          return adminJson(req, async () => {
            const id = signerId(req);
            const body = await parseJsonBody(req);
            const current = await getSignerForAdmin(id);
            if (!current)
              return json({ error: "Unterschrift nicht gefunden." }, 404);
            const patch = {};
            if (body.name !== undefined) {
              patch.name = sanitize(body.name);
              if (patch.name.length < 2)
                return json({ error: cfg.ui.errors.nameTooShort }, 400);
            }
            if (KV_ENABLED && body.kreisverband !== undefined)
              patch.kreisverband = normalizeKv(
                body.kreisverband,
                current.kreisverband,
              );
            if (OCCUPATION_ENABLED && body.occupation !== undefined)
              patch.occupation = sanitize(body.occupation, OCCUPATION_LIMIT);
            if (SIGNER_FUNCTION_ENABLED && body.signerFunction !== undefined)
              patch.signerFunction = sanitize(
                body.signerFunction,
                SIGNER_DETAIL_LIMIT,
              );
            if (LANGUAGES.length > 1 && body.lang !== undefined) {
              if (!LANGUAGES.includes(body.lang))
                return json({ error: "Diese Sprache gibt es nicht." }, 400);
              patch.lang = storedLang(cfg, body.lang);
            }
            if (typeof body.showPublicly === "boolean")
              patch.showPublicly = body.showPublicly;
            if (
              SIGNER_DETAILS_PUBLIC &&
              typeof body.showSignerDetails === "boolean"
            )
              patch.showSignerDetails = body.showSignerDetails;
            if (body.newsletter === false) patch.newsletter = false;
            else if (body.newsletter === true && !current.newsletter)
              return json(
                {
                  error:
                    "Den Newsletter kann nur die Person selbst bestätigen. Nutze „Newsletter-Einwilligung anfragen“.",
                },
                400,
              );
            const updated = await updateSignerByAdmin(id, patch, {
              consent: body.consent === true,
              consentNote: withoutEmailAddresses(
                sanitize(body.consentNote, 300),
              ),
            });
            if (!updated)
              return json({ error: "Unterschrift nicht gefunden." }, 404);
            if (
              updated.regionChanged &&
              cfg.features.stateResolution &&
              updated.signer.kreisverband
            )
              enqueueStateResolution(id, updated.signer.kreisverband);
            return json({
              ok: true,
              changed: Object.keys(updated.changes),
              signer: updated.signer,
            });
          });
        },
      },

      "/api/admin/signers/:id/remove": {
        async POST(req) {
          return adminJson(req, async () => {
            const id = signerId(req);
            if ((await getSignerForAdmin(id))?.handAdded)
              return json({ error: HAND_ENTRY_HAS_NO_ADDRESS }, 409);
            const removed = await removeAndBlockSigner(id);
            if (!removed)
              return json({ error: "Unterschrift nicht gefunden." }, 404);
            console.info(`[admin] signature ${id} removed and address blocked`);
            return json({ ok: true, ...removed });
          });
        },
      },

      "/api/admin/signers/:id/erase": {
        async POST(req) {
          return adminJson(req, async () => {
            const id = signerId(req);
            if (!(await eraseSigner(id)))
              return json({ error: "Unterschrift nicht gefunden." }, 404);
            console.info(`[admin] signature ${id} erased`);
            return json({ ok: true });
          });
        },
      },

      // A sign-up still waiting for its click gets a fresh link, like the
      // person's own "send again" on the letter page.
      "/api/admin/signers/:id/resend-confirmation": {
        async POST(req) {
          return adminJson(req, async () => {
            const id = signerId(req);
            return durableWork.run(async () => {
              const signer = await getSignerForMail(id);
              if (!signer)
                return json({ error: "Eintrag nicht gefunden." }, 404);
              if (signer.verified)
                return json(
                  { error: "Diese Unterschrift ist bereits bestätigt." },
                  409,
                );
              const refused = await adminMailRefused(
                signer,
                "signer.resend-confirmation",
                id,
              );
              if (refused) return refused;
              await refreshVerificationToken(
                signer.email,
                crypto.randomUUID(),
                mailWaitExpiry(),
              );
              await queueEmail("verification", {
                signerId: id,
                baseUrl: BASE_URL,
              });
              await recordAdminAction("signer.resend-confirmation", {
                targetId: id,
              });
              return json({ ok: true, ...mailDelay() });
            });
          });
        },
      },

      // The newsletter is never switched on from the admin: the person gets
      // a mail and subscribes with their own click on its link.
      "/api/admin/signers/:id/newsletter-request": {
        async POST(req) {
          return adminJson(req, async () => {
            const id = signerId(req);
            return durableWork.run(async () => {
              if ((await getSignerForAdmin(id))?.handAdded)
                return json({ error: HAND_ENTRY_HAS_NO_ADDRESS }, 409);
              const signer = await getSignerForMail(id);
              if (!signer?.verified)
                return json({ error: "Unterschrift nicht gefunden." }, 404);
              if (signer.newsletter)
                return json(
                  { error: "Diese Person erhält den Newsletter bereits." },
                  409,
                );
              const refused = await adminMailRefused(
                signer,
                "signer.newsletter-request",
                id,
              );
              if (refused) return refused;
              await queueEmail("newsletter-optin", {
                signerId: id,
                baseUrl: BASE_URL,
              });
              await recordAdminAction("signer.newsletter-request", {
                targetId: id,
              });
              return json({ ok: true, ...mailDelay() });
            });
          });
        },
      },

      // "Nach oben anheften" and the "Position" field: { position } is a
      // number (1 = top, past the end = last), "last", or null to take the
      // position away.
      "/api/admin/signers/:id/position": {
        async POST(req) {
          return adminJson(req, async () => {
            const { position } = await parseJsonBody(req);
            if (
              position !== null &&
              position !== "last" &&
              !(Number.isInteger(position) && position >= 1)
            )
              return json(
                { error: "Die Position muss eine Zahl ab 1 sein." },
                400,
              );
            const result = await setPosition(
              signerId(req),
              position === "last" ? Number.MAX_SAFE_INTEGER : position,
            );
            if (!result)
              return json({ error: "Unterschrift nicht gefunden." }, 404);
            return json({ ok: true, ...result });
          });
        },
      },

      "/api/admin/signers/:id/first-signer": {
        async POST(req) {
          return adminJson(req, async () => {
            const { marked } = await parseJsonBody(req);
            if (typeof marked !== "boolean")
              return json({ error: "Ungültige Anfrage." }, 400);
            const result = await setMark(signerId(req), marked);
            if (!result)
              return json({ error: "Unterschrift nicht gefunden." }, 404);
            return json({ ok: true, ...result });
          });
        },
      },

      "/api/admin/signers/:id/duplicates": {
        async GET(req) {
          return adminJson(req, async () => {
            const duplicates = await duplicatesOf(signerId(req));
            if (!duplicates)
              return json({ error: "Unterschrift nicht gefunden." }, 404);
            return json({ duplicates });
          });
        },
      },

      "/api/admin/first-signers": {
        async GET(req) {
          return adminJson(req, async () => json(await listFirstSigners()));
        },
        // A first signer the team adds by hand: no address, never mailed.
        async POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req);
            const name = sanitize(body.name);
            if (name.length < 2)
              return json({ error: cfg.ui.errors.nameTooShort }, 400);
            if (body.consent !== true)
              return json(
                {
                  error:
                    "Bestätige, dass die Person zugestimmt hat, öffentlich als Erstunterzeichner*in genannt zu werden.",
                },
                400,
              );
            const signer = await addByHand({
              name,
              kreisverband: KV_ENABLED ? normalizeKv(body.kreisverband) : "",
              organisation: OCCUPATION_ENABLED
                ? sanitize(body.occupation, OCCUPATION_LIMIT)
                : "",
              signerFunction: SIGNER_FUNCTION_ENABLED
                ? sanitize(body.signerFunction, SIGNER_DETAIL_LIMIT)
                : "",
              showSignerDetails:
                SIGNER_DETAILS_PUBLIC && body.showSignerDetails === true,
              consentNote: withoutEmailAddresses(
                sanitize(body.consentNote, 300),
              ),
              pin: body.pin === true,
            });
            if (cfg.features.stateResolution && signer.kreisverband)
              enqueueStateResolution(signer.id, signer.kreisverband);
            return json({ ok: true, signer });
          });
        },
      },

      // "Reihenfolge speichern": the whole order at once, refused with 409
      // when it changed since it was loaded.
      "/api/admin/first-signers/order": {
        async PUT(req) {
          return adminJson(req, async () => {
            const { ids, revision } = await parseJsonBody(req);
            await replaceOrder(ids, revision);
            return json({ ok: true, ...(await listFirstSigners()) });
          });
        },
      },

      "/api/admin/first-signers/link": {
        async POST(req) {
          return adminJson(req, async () => {
            const { handId, signerId: realId } = await parseJsonBody(req);
            if (!Number.isInteger(handId) || !Number.isInteger(realId))
              return json({ error: "Ungültige Anfrage." }, 400);
            const signer = await linkDuplicate(handId, realId);
            return json({ ok: true, signer });
          });
        },
      },

      "/api/admin/first-signers/import/preview": {
        async POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req, IMPORT_BODY_BYTES);
            return json(
              await planImport(importRows(body.csv), {
                order: body.order !== false,
              }),
            );
          });
        },
      },

      // Applies a previewed import. A backup is written first; without one
      // nothing is imported.
      "/api/admin/first-signers/import": {
        async POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req, IMPORT_BODY_BYTES);
            if (body.consent !== true)
              return json(
                {
                  error:
                    "Bestätige, dass alle Personen in der Datei zugestimmt haben, öffentlich genannt zu werden.",
                },
                400,
              );
            let backupFailed = false;
            try {
              const counts = await applyImport(
                importRows(body.csv),
                {
                  plan: String(body.plan || ""),
                  order: body.order !== false,
                  showSignerDetails:
                    SIGNER_DETAILS_PUBLIC && body.showSignerDetails === true,
                  consentNote: withoutEmailAddresses(
                    sanitize(body.consentNote, 300),
                  ),
                },
                async () => {
                  try {
                    await runBackup();
                  } catch (err) {
                    backupFailed = true;
                    throw err;
                  }
                },
              );
              return json({ ok: true, ...counts });
            } catch (err) {
              if (backupFailed)
                return json(
                  {
                    error:
                      "Die Sicherung vor dem Import ist fehlgeschlagen. Es wurde nichts geändert. Versuche es später noch einmal oder sag der Technik Bescheid.",
                  },
                  503,
                );
              throw err;
            }
          });
        },
      },

      "/api/admin/signers/unblock": {
        async POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req);
            const email = sanitizeEmail(body.email);
            if (!isValidEmail(email))
              return json({ error: "Ungültige E-Mail-Adresse." }, 400);
            const unblocked = await unblockSigning(email);
            if (unblocked) console.info("[admin] signing block lifted");
            return json({ ok: true, unblocked });
          });
        },
      },

      // Exports never hold an email address.
      "/api/admin/export/signers.csv": {
        async GET(req) {
          return adminJson(req, async () => {
            const detailColumns = SIGNER_DETAILS_PUBLIC
              ? [
                  SIGNER_FUNCTION_ENABLED && [
                    cfg.sign.fields.signerFunction.label,
                    (row) => row.signerFunction,
                  ],
                  OCCUPATION_ENABLED && [
                    cfg.sign.fields.occupation.label,
                    (row) => row.organisation,
                  ],
                ]
              : [];
            return csvDownload(
              "unterschriften-oeffentlich",
              [
                ["Name", (row) => row.name],
                KV_ENABLED && [
                  regionLabels(cfg).name,
                  (row) => row.kreisverband,
                ],
                cfg.features.stateResolution && [
                  "Bundesland",
                  (row) => row.state,
                ],
                ...detailColumns,
                ["Unterschrieben am", (row) => csvDate(row.createdAt)],
              ],
              await exportPublicSigners(),
            );
          });
        },
      },

      "/api/admin/export/meeting-registrations.csv": {
        async GET(req) {
          if (!ZOOM_ENABLED) return featureOff();
          return adminJson(req, async () =>
            csvDownload(
              "treffen-anmeldungen",
              [
                ["Name", (row) => row.name],
                [regionLabels(cfg).name, (row) => row.kreisverband],
                (await getShowDelegierter()) && [
                  "Delegierte*r",
                  (row) => (row.delegierter ? "Ja" : "Nein"),
                ],
                ["Angemeldet am", (row) => csvDate(row.createdAt)],
              ],
              await exportMeetingRegistrations(),
            ),
          );
        },
      },

      "/api/admin/actions": {
        async GET(req) {
          return adminJson(req, async () => {
            const offset = parseInt(
              new URL(req.url).searchParams.get("offset") || "0",
              10,
            );
            return json({
              ...(await listAdminActions({
                limit: 50,
                offset: Number.isNaN(offset) ? 0 : offset,
              })),
              retentionDays: ADMIN_LOG_DAYS,
            });
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

      "/api/admin/newsletter-selection": {
        POST(req) {
          return adminJson(req, async () => {
            const body = await parseJsonBody(req, 300000);
            if (
              !Array.isArray(body.ids) ||
              body.ids.length > SELECTION_LIMIT ||
              body.ids.some((id) => !Number.isInteger(id) || id < 1)
            )
              return json(
                { error: "Ungültige Empfängerauswahl (max. 20.000)." },
                400,
              );
            return json(
              await selectedNewsletterSigners(
                [...new Set(body.ids)],
                parseSignerFilters(req),
                {
                  limit: 25,
                  offset: Number.isInteger(body.offset)
                    ? Math.max(0, body.offset)
                    : 0,
                },
              ),
            );
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
            return json(await listNewsletterSignerIds(parseSignerFilters(req)));
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
            const countKeys = {
              newsletter: "subscriberCount",
              email_not_zoom: "newsletterNotZoomCount",
              zoom: "zoomCount",
              zoom_delegates: "zoomDelegateCount",
            };
            const audienceLanguages = Object.fromEntries(
              await Promise.all(
                Object.keys(countKeys).map(async (audience) => [
                  audience,
                  await getCampaignLanguageCounts(audience),
                ]),
              ),
            );
            const currentCounts = Object.fromEntries(
              Object.entries(countKeys).map(([audience, key]) => [
                key,
                Object.values(audienceLanguages[audience]).reduce(
                  (sum, count) => sum + count,
                  0,
                ),
              ]),
            );
            return json({
              ...newsletter,
              ...zoom,
              ...currentCounts,
              audienceLanguages,
            });
          });
        },
      },

      "/api/admin/overview": {
        async GET(req) {
          return adminJson(req, async () => {
            const raw = new URL(req.url).searchParams.get("since");
            const since = new Date(raw || Date.now() - 86400000);
            if (Number.isNaN(since.getTime()))
              return json({ error: "Ungültiger Zeitpunkt." }, 400);
            return json({
              ...(await getSignatureActivity(
                since,
                new Date(Date.now() + 6 * 3600000),
              )),
              expiredUnmailed: await getExpiredUnmailedSignups(),
            });
          });
        },
      },

      "/api/admin/zoom-registrations": {
        async GET(req) {
          return adminJson(req, async () => {
            const params = new URL(req.url).searchParams;
            const number = (name, fallback) => {
              const value = parseInt(params.get(name) ?? "", 10);
              return Number.isNaN(value) ? fallback : value;
            };
            return json(
              await listZoomRegistrations({
                limit: number("limit", 100),
                offset: number("offset", 0),
                search: (params.get("search") || "").slice(0, 200),
              }),
            );
          });
        },
      },

      "/api/admin/zoom-registrations/:id": {
        async DELETE(req) {
          return adminJson(req, async () => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || !(await removeZoomRegistration(id)))
              return json(
                {
                  error:
                    "Diese Anmeldung gibt es nicht mehr. Lade die Liste erneut.",
                },
                404,
              );
            await recordAdminAction("meeting.remove", { targetId: id });
            return json({ ok: true });
          });
        },
      },

      "/api/admin/zoom-registrations/clear": {
        async POST(req) {
          return adminJson(req, async () => {
            const removed = await clearZoomRegistrations();
            await recordAdminAction("meeting.clear", { count: removed });
            return json({ ok: true, removed });
          });
        },
      },

      "/api/admin/zoom-mailings": {
        async GET(req) {
          return adminJson(req, async () => {
            const cfg = await getZoomConfig({ strict: true });
            return json({
              revision: cfg.revision,
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
              durationMin: cfg.durationMin,
              mailings: await listZoomMailings(),
            });
          });
        },
      },

      "/api/admin/zoom-settings": {
        async POST(req) {
          return adminJson(req, async () => {
            if (!durableWork.status.ready) throw new JobsUnavailable();
            if (bodyTooLarge(req))
              return json({ error: "Die Anfrage ist zu groß." }, 413);
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
              return json(
                {
                  error:
                    "Prüfe die Stundenangaben für Link-E-Mail und Erinnerung.",
                },
                400,
              );
            }
            const durationMin =
              body.durationMin == null ? null : parseInt(body.durationMin, 10);
            if (
              durationMin != null &&
              !(durationMin >= 5 && durationMin <= 1440)
            ) {
              return json(
                { error: "Gib eine Dauer zwischen 5 und 1440 Minuten ein." },
                400,
              );
            }

            const prev = await getZoomConfig({ strict: true });
            const eventChanged = eventDate.toISOString() !== prev.eventAtIso;
            const zoomLink = String(body.zoomLink ?? "").trim();
            const revision = await setZoomSettings(
              {
                zoom_event_at: eventDate.toISOString(),
                zoom_link_offset_hours: linkOffsetHours,
                zoom_reminder_offset_hours: reminderOffsetHours,
                zoom_link: zoomLink,
                // Ported operational settings (admin-editable, no redeploy).
                zoom_show_delegierter: body.showDelegierter ? "1" : "0",
                zoom_mode: body.mode === "inperson" ? "inperson" : "online",
                zoom_location_name: String(body.locationName ?? "").trim(),
                zoom_location_address: String(
                  body.locationAddress ?? "",
                ).trim(),
                zoom_location_maps_url: String(
                  body.locationMapsUrl ?? "",
                ).trim(),
                // null (older admin page) keeps the stored value.
                zoom_duration_min: durationMin,
              },
              body.expectedRevision,
              { resetMailings: body.resetMailings === true },
            );
            await recordAdminAction("meeting.settings");
            const cfg = await getZoomConfig();
            return json({
              ok: true,
              revision,
              mailingsReset: eventChanged || body.resetMailings === true,
              eventAt: cfg.eventAtIso,
              eventLabel: cfg.label,
              linkOffsetHours: cfg.linkOffsetHours,
              reminderOffsetHours: cfg.reminderOffsetHours,
              showDelegierter: cfg.showDelegierter,
              mode: cfg.mode,
              location: cfg.location,
              eventLabelFallback: cfg.eventLabelFallback,
              navLabel: cfg.navLabel,
              durationMin: cfg.durationMin,
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
              return json({ error: "Die Anfrage ist zu groß." }, 413);
            const body = await parseJsonBody(req);
            if (!Array.isArray(body.milestones)) {
              return json({ error: "Übergebe die Zielmarken als Liste." }, 400);
            }
            try {
              const milestones = await setMilestones(body.milestones);
              await recordAdminAction("settings.milestones", {
                count: milestones.length,
              });
              return json({ ok: true, milestones });
            } catch (e) {
              return json(
                { error: e.message || "Die Zielmarken sind ungültig." },
                400,
              );
            }
          });
        },
      },

      "/api/admin/zoom-test-send": {
        async POST(req) {
          return adminJson(req, async () => {
            if (bodyTooLarge(req))
              return json({ error: "Die Anfrage ist zu groß." }, 413);
            const body = await parseJsonBody(req);
            const to = String(body.to || "").trim();
            const kind = body.kind;
            if (!to || !isValidEmail(to)) {
              return json({ error: reqUi(req).errors.invalidEmail }, 400);
            }
            if (!["confirmation", "link", "reminder"].includes(kind)) {
              return json(
                { error: "Der Nachrichtentyp ist nicht verfügbar." },
                400,
              );
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
              return json({ error: "Die Anfrage ist zu groß." }, 413);
            const body = await parseJsonBody(req);
            const cfg = await getZoomConfig();
            const template = body.template_id
              ? memoryTemplate(Number(body.template_id))
              : null;
            const variables = emailPreviewVariables(cfg.label);
            return json({
              subject: interpolateTemplate(
                String(body.subject ?? template?.subject ?? ""),
                variables,
              ),
              html: renderEmailHtml(
                sanitizeHtml(template?.html_body ?? body.html_body),
                variables,
                LANGUAGES.includes(body.lang) ? body.lang : DEFAULT_LANG,
              ),
            });
          });
        },
      },

      "/api/admin/test-send": {
        async POST(req) {
          return adminJson(req, async () => {
            if (bodyTooLarge(req))
              return json({ error: "Die Anfrage ist zu groß." }, 413);
            const body = await parseJsonBody(req);
            const to = String(body.to || "").trim();
            const templateId = parseInt(body.template_id, 10);
            if (!to || !isValidEmail(to)) {
              return json({ error: reqUi(req).errors.invalidEmail }, 400);
            }
            if (!templateId) {
              return json({ error: "Wähle eine Vorlage." }, 400);
            }
            const template = memoryTemplate(templateId);
            if (!template) {
              return json(
                { error: "Die Vorlage ist nicht mehr verfügbar." },
                404,
              );
            }
            if (!isCampaignTemplate(template))
              return json(
                {
                  error:
                    "Systemnachrichten können nicht als Rundmail getestet werden.",
                },
                400,
              );
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
            const signerCount =
              stats.signerCount?.toLocaleString("de-DE") || "0";
            const zoomCfg = await getZoomConfig();
            const realRecipient = isZoom
              ? await getZoomRecipientByEmail(to)
              : await getNewsletterRecipientByEmail(to);
            let vars;
            let optOutUrl;
            if (realRecipient) {
              const firstName = realRecipient.name.split(/\s/)[0];
              if (isZoom) {
                const token = await issueZoomUnsubscribeToken(realRecipient.id);
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
                const token = await issueUnsubscribeToken(realRecipient.id);
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
            const html = renderEmailHtml(
              template.html_body,
              vars,
              LANGUAGES.includes(body.lang) ? body.lang : DEFAULT_LANG,
            );
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
            const body = await parseJsonBody(req);
            const from = String(body.from || "").trim();
            const to = mergeTarget(body.to, normalizeKv);
            if (!from || !to || from === to) {
              return json({ error: "Ungültige Kreisverbände" }, 400);
            }
            const merged = await mergeKreisverband(from, to);
            await recordAdminAction("merge.kreisverband", mergeEntry(merged));
            await triggerBackfill();
            return json({ ok: true, ...merged });
          });
        },
      },

      "/api/admin/dismiss-outlier": {
        async POST(req) {
          return adminJson(req, async () => {
            if (bodyTooLarge(req))
              return json({ error: "Die Anfrage ist zu groß." }, 413);
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
            const body = await parseJsonBody(req);
            const kreisverband = mergeTarget(body.kreisverband, sanitize);
            if (!kreisverband || !GERMAN_STATES.includes(body.state)) {
              return json(
                { error: "Wähle einen Kreisverband und ein Bundesland." },
                400,
              );
            }
            const assigned = await assignKvState(kreisverband, body.state);
            await recordAdminAction("merge.state", mergeEntry(assigned));
            return json({ ok: true, ...assigned });
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
            const body = await parseJsonBody(req);
            const from = String(body.from || "").trim();
            const to = mergeTarget(body.to, (value) =>
              sanitize(value, OCCUPATION_LIMIT),
            );
            if (!from || !to || from === to) {
              return json({ error: "Ungültige Berufe" }, 400);
            }
            const merged = await mergeOccupation(from, to);
            await recordAdminAction("merge.occupation", mergeEntry(merged));
            return json({ ok: true, ...merged });
          });
        },
      },

      // Takes back a merge or Land assignment by the `undoId` it returned.
      "/api/admin/merges/:id/undo": {
        async POST(req) {
          return adminJson(req, async () => {
            const undone = await undoMerge(Number(req.params.id));
            if (!undone)
              return json(
                {
                  error:
                    "Diese Zusammenführung ist nicht mehr gespeichert und lässt sich nicht zurücknehmen.",
                },
                404,
              );
            if (undone === "undone")
              return json(
                {
                  error: "Diese Zusammenführung wurde bereits zurückgenommen.",
                },
                409,
              );
            // A Kreisverband merge had cleared the Land of the merged rows.
            if (undone.kind === "kreisverband") await triggerBackfill();
            await recordAdminAction("merge.undo", {
              targetId: Number(req.params.id),
              count: undone.restored,
            });
            return json({ ok: true, restored: undone.restored });
          });
        },
      },

      "/api/admin/dismiss-occupation-outlier": {
        async POST(req) {
          return adminJson(req, async () => {
            if (bodyTooLarge(req))
              return json({ error: "Die Anfrage ist zu groß." }, 413);
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

    async fetch(req) {
      if (req.method === "GET" || req.method === "HEAD") {
        const file = await publicFile(new URL(req.url).pathname);
        if (file) return file;
      }
      return json({ error: "Not found" }, 404);
    },
  }),
);
console.log(
  `Server running on ${server.url} (${isDev ? "development" : "production"})`,
);
// ---- Honker durable jobs: campaign sends, zoom mailings, hourly backups ----

async function sendQueuedEmail(payload, job) {
  if (payload.kind === "meeting-signup")
    return meetingService.sendSignup(payload);
  if (!deliveryContext.getStore())
    return deliveryContext.run(
      {
        scope: `transactional:${payload.messageId || job?.id}`,
        priority: "transactional",
      },
      () => sendQueuedEmail(payload, job),
    );
  if (!payload.messageId && !job?.id)
    throw new Error("Queued email needs a logical message identity");
  const scope = `transactional:${payload.messageId || job.id}`;
  // The mail went out on an earlier run that failed before the job was
  // acknowledged. What the mail's acceptance starts may be what failed, so
  // it is recorded again, from when the mail went out.
  const acceptedAt = await emailManager.acceptedAt(scope);
  if (acceptedAt) {
    if (payload.kind === "verification" && payload.signerId && payload.token)
      await startConfirmationWindow(
        payload.signerId,
        payload.token,
        confirmationExpiry(acceptedAt),
      );
    return;
  }
  if (payload.to) {
    payload = await sqlDb.transaction(
      async () => {
        const normalized = await normalizeQueuedEmailPayload(sqlDb, payload);
        if (normalized)
          await sqlDb
            .query(
              "UPDATE _honker_live /* public-neutral */ SET payload=? WHERE id=?",
            )
            .run(JSON.stringify(normalized), job.id);
        return normalized;
      },
      { immediate: true },
    );
    if (!payload) return;
  }
  const source = payload.requestId
    ? "deletion"
    : payload.pendingId
      ? "pending"
      : payload.registrationId
        ? "meeting"
        : "signer";
  const subjectId =
    payload.requestId ||
    payload.pendingId ||
    payload.registrationId ||
    payload.signerId;
  const recipient = await getRecipientIdentity(source, subjectId);
  if (!recipient) return;
  if (
    (payload.kind === "invite" && !payload.statsToken) ||
    (["verification", "deletion", "treffen-verification"].includes(
      payload.kind,
    ) &&
      !payload.token)
  ) {
    await sqlDb.transaction(
      async () => {
        payload = {
          ...payload,
          ...(await queuedCredentials(payload.kind, payload)),
        };
        await sqlDb
          .query(
            "UPDATE _honker_live /* public-neutral */ SET payload=? WHERE id=?",
          )
          .run(JSON.stringify(payload), job.id);
      },
      { immediate: true },
    );
  }
  const args = await prepareQueuedEmail(payload);
  if (!args) return; // row gone, already confirmed or link expired
  return deliveryContext.run(
    {
      ...deliveryContext.getStore(),
      eligible: (connection) =>
        authorizeRecipient(recipient, {
          kind: args.kind,
          token: args.token,
          connection,
        }),
      ...(args.kind === "verification" && {
        onAccepted: (_connection, acceptedAt) =>
          startConfirmationWindow(
            payload.signerId,
            args.token,
            confirmationExpiry(acceptedAt),
          ),
      }),
    },
    async () => {
      switch (args.kind) {
        case "verification":
          return await sendVerificationEmail(args);
        case "already-signed":
          return await sendAlreadySignedEmail(args);
        case "newsletter-optin":
          return await sendNewsletterOptInEmail(args);
        case "invite":
          return await sendInviteEmail(args);
        case "deletion":
          return await sendDeletionEmail(args);
        case "treffen-verification": {
          const zoomCfg = zoomIn(await getZoomConfig(), args.lang);
          return await sendTreffenVerificationEmail({
            ...args,
            eventLabel: zoomCfg.label,
            eventWhen: zoomCfg.whenPhrase,
          });
        }
        case "treffen-already-registered": {
          const zoomCfg = zoomIn(await getZoomConfig(), args.lang);
          return await sendTreffenAlreadyRegisteredEmail({
            ...args,
            eventLabel: zoomCfg.label,
            eventWhen: zoomCfg.whenPhrase,
          });
        }
        default:
          throw new Error(`unknown email kind: ${args.kind}`);
      }
    },
  );
}

// A transactional mail that hasn't gone out within this window is dropped, and
// a dead-lettered one is removed this long after it died (config privacy).
const EMAIL_JOB_TTL_S = privacy.emailJobRetentionS;

async function queueEmail(kind, args) {
  return durableWork.email(kind, args);
}

async function handleMaintenanceJob({ task }) {
  if (task === "campaign-reconcile") {
    const ids = await getDueCampaignIds();
    for (const id of ids)
      await enqueueJob("campaigns", { campaignId: id }, { maxAttempts: 5 });
  } else if (task === "zoom" && ZOOM_ENABLED) {
    await runZoomMailingWorker();
  } else if (task === "backup") {
    await runBackup();
  } else if (task === "purge-unverified") {
    await publications.assets.sweep();
    const removed = await deleteExpiredUnverifiedSigners();
    if (removed > 0) {
      console.log(`[purge] deleted ${removed} expired unverified sign-up(s)`);
    }
    await deleteExpiredDeletionRequests();
    await deleteOldDeliveries();
    await emailManager.purge();
    if (statistics) await statistics.purge();
    await deleteExpiredZoomPending();
    await purgeOldErasureLog(
      new Date(Date.now() - privacy.erasureLogMs),
      retentionCutoff(privacy),
    );
    await purgeOldAdminActions(
      new Date(Date.now() - ADMIN_LOG_DAYS * 24 * 60 * 60 * 1000),
    );
  } else if (task === "purge-dead-emails") {
    // A backup that fails ends up here too, one job per failed hour.
    await purgeDeadJobs("maintenance", EMAIL_JOB_TTL_S);
    const removed = await purgeDeadJobs("emails", EMAIL_JOB_TTL_S);
    if (removed > 0) {
      console.log(`[purge] deleted ${removed} dead-lettered email job(s)`);
    }
  } else if (task === "purge-by-age") {
    await deleteExpiredMerges();
    const removed = await deleteExpiredByAge(retentionCutoff(privacy));
    if (removed > 0) {
      console.log(
        `[purge] deleted ${removed} entr(y/ies) older than ${privacy.signerRetentionYears} years`,
      );
    }
  }
}

if (jobInfrastructureReady) {
  startWorker(
    {
      campaigns: handleCampaignJob,
      maintenance: handleMaintenanceJob,
      emails: sendQueuedEmail,
    },
    {
      batch: 25,
      concurrency: { emails: 10 },
      isolated: ["emails", "campaigns"],
    },
  );
  durableWork.available();
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

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutting down...");
  durableWork.unavailable("shutting-down");
  const requests = requestDrain.close();
  const workers = stopWorker();
  await Promise.allSettled([requests, workers]);
  await server.stop();
  stopCache();
  await Promise.allSettled([
    publicationConnection.close(),
    emailConnection.close(),
    assetConnection.close(),
  ]);
  await close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
