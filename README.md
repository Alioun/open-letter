# Diätendeckel jetzt

Campaign landing page for an open letter by the base of Die Linke demanding caps on parliamentary salaries. Collects verified signatures with email confirmation and displays them publicly.

## Stack

- **Runtime**: [Bun](https://bun.sh) — package manager, bundler, HTTP server (no Vite, no framework)
- **Frontend**: React 18, vanilla CSS
- **Backend**: `Bun.serve()` with route handlers
- **Database**: PostgreSQL 18 via [postgres.js](https://github.com/porsager/postgres)
- **Email**: nodemailer via mailbox.org SMTP — console log in dev, live delivery in production

## Project Structure

```
diaetendeckel/
├── package.json
├── index.html                 # HTML entry (Bun auto-bundles JS + CSS)
├── .env.example
├── .gitignore
├── Dockerfile                 # Production multi-stage build
├── Dockerfile.dev             # Dev/demo build (includes seed + trickle)
├── .dockerignore
├── docker-compose.yml         # Production (optional bundled Postgres)
├── docker-compose.dev.yml     # Dev/demo (Postgres + seed data + trickle)
├── db/
│   ├── schema.sql             # Table + indexes
│   ├── setup.js               # Idempotent schema application
│   └── seed.js                # Dev: 200 demo signers + live trickle
├── server/
│   ├── index.js               # Bun.serve() — routes + security headers
│   ├── db.js                  # Parameterized Postgres queries
│   ├── email.js               # Email abstraction (console / Resend)
│   └── ratelimit.js           # In-memory sliding window rate limiter
└── src/
    ├── main.jsx               # React entry point
    ├── App.jsx                # Full SPA — all sections + modals
    └── index.css              # All styles + responsive breakpoints
```

## Quick Start (local)

Prerequisites: [Bun](https://bun.sh) installed, PostgreSQL running.

```bash
git clone <repo-url> && cd diaetendeckel
bun install
cp .env.example .env           # edit DATABASE_URL to match your Postgres
bun run db:setup               # create table + indexes (idempotent)
bun run dev                    # → http://localhost:3000 (HMR enabled)
```

To populate with demo data in a second terminal:

```bash
bun run db:seed                # seeds 200 signers, then trickles 1 every 6s
```

## Quick Start (Docker — demo with sample data)

No local Bun or Postgres needed:

```bash
docker compose -f docker-compose.dev.yml up --build
```

This starts Postgres 18, creates the schema, seeds 200 verified signers, trickles a new one every 6 seconds, and serves the app at `http://localhost:3000`.

## Environment Variables

| Variable           | Required   | Default                 | Description                                                                                                           |
| ------------------ | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | Yes        | —                       | Postgres connection string                                                                                            |
| `PORT`             | No         | `3000`                  | Server port                                                                                                           |
| `BASE_URL`         | No         | `http://localhost:3000` | Public URL (used in verification emails)                                                                              |
| `NODE_ENV`         | No         | `development`           | `production` enables CSP headers + asset minification                                                                 |
| `ADMIN_PATH`       | Yes        | —                       | Secret single-segment admin path, without leading or trailing slashes. Use `my-secret-panel`, not `/my-secret-panel`. |
| `ADMIN_PASSWORD`   | Yes        | —                       | Admin login password                                                                                                  |
| `ADMIN_JWT_SECRET` | Yes        | —                       | Long random secret for admin session JWTs                                                                             |
| `MAILBOX_USER`     | Yes (prod) | —                       | mailbox.org account address used for SMTP auth                                                                        |
| `MAILBOX_PASSWORD` | Yes (prod) | —                       | mailbox.org account password                                                                                          |

See `.env.example` for a template.

## Scripts

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `bun run dev`      | Start dev server with watch mode + HMR            |
| `bun run start`    | Start production server                           |
| `bun run db:setup` | Apply database schema (idempotent)                |
| `bun run db:seed`  | Seed 200 demo signers + trickle new ones every 6s |

## API

| Method | Path                              | Description                                              |
| ------ | --------------------------------- | -------------------------------------------------------- |
| `GET`  | `/api/health`                     | Health check — `{ok, db}`, returns 503 if DB unreachable |
| `GET`  | `/api/stats`                      | Signature totals — `{total, today, week, kvCount}`       |
| `GET`  | `/api/signers`                    | Verified signers list (paginated, filterable)            |
| `POST` | `/api/sign`                       | Submit a signature — triggers verification email         |
| `GET`  | `/api/confirm/:token`             | Email confirmation link — verifies + redirects           |
| `GET`  | `/api/unsubscribe/:token`         | Newsletter unsubscribe state                             |
| `POST` | `/api/unsubscribe/:token/opt-out` | Opt out of newsletter emails                             |
| `POST` | `/api/unsubscribe/:token/delete`  | Delete signature from a newsletter link                  |

### POST /api/sign

```json
{
  "name": "Anna Berger",
  "email": "anna@example.org",
  "kv": "Berlin-Neukölln",
  "newsletter": true
}
```

- Rate limited: 3 requests per IP per 15 minutes (429 with `Retry-After` header)
- Validates: name >= 2 chars, valid email format
- Sanitizes all inputs (trim, strip HTML, length cap)
- Generates a UUID token with 24h expiry
- Sends verification email (console log in dev)
- Returns `{ok: true}` regardless of whether the email already exists (no information leakage)

### GET /api/signers

| Param    | Default | Description                                          |
| -------- | ------- | ---------------------------------------------------- |
| `filter` | `alle`  | `alle`, `heute` (last 24h), `kv` (with Kreisverband) |
| `search` | —       | Search by name or Kreisverband                       |
| `limit`  | `18`    | Results per page (max 100)                           |
| `offset` | `0`     | Pagination offset                                    |

Returns `{signers: [{id, name, kreisverband, created_at}], total}`. Email addresses are never exposed.

### GET /api/confirm/:token

Verifies a signature if the token is valid and not expired. Redirects to `/?confirmed=1` on success, `/?error=token-expired` on failure.

## Database

Single table `signers` with columns: `id`, `name`, `email` (unique), `kreisverband`, `newsletter`, `verified`, `verification_token` (unique), `token_expires_at`, `created_at`.

Four indexes optimized for the main queries: verified listing, recent signers, token lookup (partial), and Kreisverband filter (partial).

Schema creation is idempotent (`IF NOT EXISTS`) — safe to run on every container start.

## Email

**Default (dev):** Verification URLs are logged to the console. Click the URL to confirm a signature.

**Production:** Set `MAILBOX_USER` and `MAILBOX_PASSWORD` in `.env`. The app sends via `smtp.mailbox.org:587` (STARTTLS) using nodemailer. See `gmail-smtp-setup.txt` for the full DNS setup (SPF, DKIM, DMARC) required to send from `noreply@gehaltsdeckel.jetzt`.

## Security

- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. In production: `Content-Security-Policy` restricting sources to `'self'` + Google Fonts.
- **Rate limiting**: In-memory sliding window, 3 sign requests per IP per 15 minutes.
- **Input sanitization**: All text trimmed, HTML tags stripped, lengths capped. Parameterized SQL queries throughout.
- **Token security**: `crypto.randomUUID()` (128-bit), 24h expiry, cleared after use.
- **No email exposure**: `/api/signers` never returns email addresses. `/api/sign` returns the same response whether the email exists or not.

## Deployment (Dokploy)

### Production with bundled Postgres

```bash
docker compose --profile with-db up --build
```

Set in Dokploy UI or `.env`:

- `DB_PASSWORD` — strong random password
- `BASE_URL` — public URL (e.g. `https://diaetendeckel.example.de`)
- `RESEND_API_KEY` — (optional) for real email delivery

### Production with external Postgres

```bash
docker compose up --build
```

Set `DATABASE_URL` to your existing Postgres connection string. The `db` service is skipped entirely (behind a Docker Compose profile).

### Dev / Demo

```bash
docker compose -f docker-compose.dev.yml up --build
```

Includes Postgres, auto-seeds 200 signers, and trickles new ones every 6 seconds. Default DB password: `devpass`.

In all cases, the app runs `db/setup.js` on startup to ensure the schema exists. Health check at `/api/health` confirms DB connectivity.
