import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { SignJWT, jwtVerify } from "jose";
import {
  getSigners,
  getStats,
  getNewsletterStats,
  insertSigner,
  confirmSigner,
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
  claimDueCampaigns,
  markCampaignSent,
  markCampaignFailed,
  getNewsletterRecipients,
  refreshUnsubscribeToken,
  getUnsubscribeState,
  optOutNewsletter,
  deleteSignerByUnsubscribeToken,
} from "./db.js";
import {
  sendVerificationEmail,
  sendDeletionEmail,
  sendRenderedEmail,
  renderEmailHtml,
  interpolateTemplate,
} from "./email.js";
import { checkRateLimit } from "./ratelimit.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || BASE_URL)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const isDev = process.env.NODE_ENV !== "production";

const ADMIN_PATH = normalizeAdminPath(process.env.ADMIN_PATH);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";

if (!ADMIN_PATH || !ADMIN_PASSWORD || !ADMIN_JWT_SECRET) {
  throw new Error(
    "ADMIN_PATH, ADMIN_PASSWORD, and ADMIN_JWT_SECRET must be set.",
  );
}

process.env.PUBLIC_ADMIN_PATH_HASH = await sha256Hex(ADMIN_PATH);
const { default: homepage } = await import("../index.html");

const adminRoute = `/${ADMIN_PATH}`;
const jwtSecret = new TextEncoder().encode(ADMIN_JWT_SECRET);

function normalizeAdminPath(path) {
  const value = String(path || "").trim().replace(/^\/+|\/+$/g, "");
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

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  ...(isDev
    ? {}
    : {
        "Content-Security-Policy":
          "default-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' about:",
      }),
};

function getClientIp(req) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
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

async function sendCampaign(campaign) {
  const template = await getEmailTemplate(campaign.template_id);
  if (!template) {
    await markCampaignFailed(campaign.id, 0);
    return;
  }

  const recipients = await getNewsletterRecipients();
  const stats = await getNewsletterStats();
  const signerCount = stats.signerCount?.toLocaleString("de-DE") || "0";
  let sent = 0;

  try {
    for (let i = 0; i < recipients.length; i += 50) {
      const batch = recipients.slice(i, i + 50);

      for (const recipient of batch) {
        const unsubscribeToken = await refreshUnsubscribeToken(recipient.id);
        const unsubscribeUrl = `${BASE_URL}/abmelden/${unsubscribeToken}`;
        const variables = {
          name: recipient.name,
          signerCount,
          unsubscribeUrl,
        };
        const html = renderEmailHtml(template.html_body, variables);
        const subject = interpolateTemplate(campaign.subject, variables);

        await sendRenderedEmail({
          to: recipient.email,
          subject,
          html,
        });
        sent += 1;
      }

      if (i + 50 < recipients.length) await sleep(1000);
    }

    await markCampaignSent(campaign.id, sent);
  } catch (err) {
    console.error(`Campaign ${campaign.id} failed:`, err);
    await markCampaignFailed(campaign.id, sent);
  }
}

let campaignWorkerRunning = false;
async function runCampaignWorker() {
  if (campaignWorkerRunning) return;
  campaignWorkerRunning = true;
  try {
    const campaigns = await claimDueCampaigns();
    for (const campaign of campaigns) {
      await sendCampaign(campaign);
    }
  } catch (err) {
    console.error("Campaign worker error:", err);
  } finally {
    campaignWorkerRunning = false;
  }
}

const campaignWorker = setInterval(runCampaignWorker, 60 * 1000);
campaignWorker.unref?.();

const server = Bun.serve({
  port: PORT,
  development: isDev,

  routes: {
    "/": homepage,
    [adminRoute]: homepage,
    "/abmelden/:token": homepage,

    "/api/health": {
      async GET() {
        const db = await healthCheck();
        return json({ ok: db, db }, db ? 200 : 503);
      },
    },

    "/api/stats": {
      async GET() {
        try {
          const stats = await getStats();
          return json(stats);
        } catch (err) {
          console.error("GET /api/stats error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/signers": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const filter = url.searchParams.get("filter") || "alle";
          const search = url.searchParams.get("search") || "";
          const limit = parseInt(url.searchParams.get("limit") || "18", 10);
          const offset = parseInt(url.searchParams.get("offset") || "0", 10);
          const result = await getSigners({ filter, search, limit, offset });
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
            3,
            15 * 60 * 1000,
          );
          if (!allowed) {
            return json(
              { error: "Zu viele Anfragen. Bitte versuche es später erneut." },
              429,
              { "Retry-After": String(retryAfter) },
            );
          }

          const body = await req.json();
          const name = sanitize(body.name);
          const email = sanitizeEmail(body.email);
          const kv = sanitize(body.kv || "");
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
            newsletter,
            showPublicly,
            token,
            expiresAt,
          });

          if (!ok && alreadyVerified) {
            return json({ ok: true });
          }

          await sendVerificationEmail({
            to: email,
            name,
            token,
            baseUrl: getBaseUrl(req),
          });

          return json({ ok: true });
        } catch (err) {
          console.error("POST /api/sign error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/confirm/:token": {
      async GET(req) {
        try {
          const { token } = req.params;
          const confirmed = await confirmSigner(token);

          if (confirmed) {
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
            3,
            15 * 60 * 1000,
          );
          if (!allowed) {
            return json({ ok: true }, 200, {
              "Retry-After": String(retryAfter),
            });
          }

          const body = await req.json();
          const email = sanitizeEmail(body.email);

          if (!isValidEmail(email)) {
            return json({ ok: true });
          }

          const token = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

          const found = await createDeletionToken(email, token, expiresAt);
          if (found) {
            await sendDeletionEmail({
              to: email,
              token,
              baseUrl: getBaseUrl(req),
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

    "/api/unsubscribe/:token": {
      async GET(req) {
        try {
          const signer = await getUnsubscribeState(req.params.token);
          if (!signer) return json({ ok: false }, 404);
          return json({
            ok: true,
            emailMasked: maskEmail(signer.email),
            newsletter: signer.newsletter,
            canDelete: signer.verified,
          });
        } catch (err) {
          console.error("GET /api/unsubscribe error:", err);
          return json({ error: "Internal server error" }, 500);
        }
      },
    },

    "/api/unsubscribe/:token/opt-out": {
      async POST(req) {
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

    "/api/unsubscribe/:token/delete": {
      async POST(req) {
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
            return json(
              { error: "Zu viele Anmeldeversuche." },
              429,
              { "Retry-After": String(retryAfter) },
            );
          }

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
          const body = await req.json();
          const subject = sanitize(body.subject, 240);
          const htmlBody = sanitizeHtml(body.html_body);
          if (!subject || !htmlBody) return json({ error: "Missing fields" }, 400);
          const template = await updateEmailTemplate(parseInt(req.params.id, 10), {
            subject,
            htmlBody,
          });
          if (!template) return json({ error: "Not found" }, 404);
          return json(template);
        });
      },
      async DELETE(req) {
        return adminJson(req, async () => {
          const deleted = await deleteEmailTemplate(parseInt(req.params.id, 10));
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
          const body = await req.json();
          const templateId = parseInt(body.template_id, 10);
          const subject = sanitize(body.subject, 240);
          const scheduledAt = new Date(body.scheduled_at);
          if (!templateId || !subject || Number.isNaN(scheduledAt.getTime())) {
            return json({ error: "Invalid campaign" }, 400);
          }
          const campaign = await createCampaign({
            templateId,
            subject,
            scheduledAt,
          });
          if (!campaign) return json({ error: "Template not found" }, 404);
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

    "/api/admin/stats": {
      async GET(req) {
        return adminJson(req, async () => json(await getNewsletterStats()));
      },
    },

    "/api/admin/preview": {
      async POST(req) {
        return adminJson(req, async () => {
          const body = await req.json();
          return json({
            html: renderEmailHtml(sanitizeHtml(body.html_body), {
              name: "Ada Beispiel",
              confirmUrl: `${BASE_URL}/api/confirm/beispiel`,
              deleteUrl: `${BASE_URL}/api/delete/beispiel`,
              signerCount: "1.000",
              unsubscribeUrl: `${BASE_URL}/abmelden/beispiel`,
            }),
          });
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

function shutdown() {
  console.log("Shutting down...");
  clearInterval(campaignWorker);
  close().then(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
