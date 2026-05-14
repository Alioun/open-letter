import homepage from "../index.html";
import {
  getSigners,
  getStats,
  insertSigner,
  confirmSigner,
  healthCheck,
  close,
} from "./db.js";
import { sendVerificationEmail } from "./email.js";
import { checkRateLimit } from "./ratelimit.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || BASE_URL)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const isDev = process.env.NODE_ENV !== "production";

function getBaseUrl(req) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const origin = `${proto}://${host}`;
  return ALLOWED_ORIGINS.has(origin) ? origin : BASE_URL;
}

function sanitize(str) {
  return String(str || "")
    .trim()
    .replace(/<[^>]*>/g, "")
    .slice(0, 100);
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
          "default-src 'self'; font-src fonts.gstatic.com; style-src 'self' fonts.googleapis.com 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'",
      }),
};

function getClientIp(req) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

const server = Bun.serve({
  port: PORT,
  development: isDev,

  routes: {
    "/": homepage,

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
          return Response.redirect(`${getBaseUrl(req)}/?error=token-expired`, 302);
        } catch (err) {
          console.error("GET /api/confirm error:", err);
          return Response.redirect(`${BASE_URL}/?error=server-error`, 302);
        }
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
  close().then(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
