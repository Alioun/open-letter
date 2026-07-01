# Open Letter Platform

A **config-driven open-letter / signature-collection platform** — fork it per campaign. It collects verified signatures with email confirmation and displays them publicly, with a live goal counter, an admin dashboard, transactional + newsletter email, and optional regional (German-state) and event (Zoom) modules.

Everything campaign-specific — branding, theme (colours/fonts), the letter text, FAQ, legal entity, emails, and which optional features are on — lives in a single config per letter under [`config/letters/`](config/letters). One deployment serves one letter, selected by the `LETTER_CONFIG` env var.

The reference/example campaign that ships in this repo is **"Gehaltsdeckel jetzt"** (`config/letters/gehaltsdeckel/`): an open letter by the base of Die Linke demanding caps on parliamentary salaries. A minimal, English, feature-stripped starter lives in `config/letters/example/`.

## Launch a new open letter

1. **Copy a letter config:** `cp -r config/letters/example config/letters/my-letter` (start from `example`, or from `gehaltsdeckel` for the full feature set).
2. **Edit `config/letters/my-letter/index.js`** — `brand`, `meta` (title/OG/canonical/analytics), `theme` (`colors`, `fonts`, `style`), `hero` (+ seed `milestones`), `nav`, `list`, `sign` (criteria, privacy, field labels), `footer`, `legal`, `email` (`from`, `signoff`, `templates`), and `features` (which optional modules are on).
3. **Edit `config/letters/my-letter/content.jsx`** — the rich page content: `LetterArticle` (the letter itself) and `FaqContent` (the FAQ).
4. **Register it** in `config/letter.config.js` and `config/content.jsx` (add it to the `LETTERS` / `CONTENT` maps).
5. **Add assets** to `public/` (`og.png`, favicon, etc.) — regenerate the OG image with `bun run og` once the site runs.
6. **Set env:** `LETTER_CONFIG=my-letter`, plus `BASE_URL`, `RESEND_*`, and the required secrets (see below).
7. **`bun run db:setup`** (seeds the config's email templates) and deploy.

No application code changes are needed — content, branding, theme and feature flags are all config.

### Config schema (per letter)

| Key | What it controls |
| --- | --- |
| `brand` | `name`, `wordmark`, `lang`, `locale` |
| `theme` | `colors` (palette → CSS variables), `fonts` (`display`/`body`), `style` (`shadowOffset`, `radius`, `borderWidth`) — drives the page, emails, and generated images |
| `meta` | `<head>`: title, description, canonical, OG/Twitter, favicon, JSON-LD `schemaAbout`, optional `analytics` `{src, websiteId}` |
| `hero` | headline lines, CTA labels, counter/goal labels, seed `milestones` |
| `nav` / `navCta` / `list` | nav items, top-bar CTA, signer-list heading |
| `sign` | section heading, `criteria`, `privacyNote`, form copy, and `fields` (labels/placeholders for the two optional `kreisverband`/`occupation` columns) |
| `footer` / `legal` | footer blurb + contact; Impressum/Datenschutz responsible entity, address, contact, disclaimer |
| `email` | `from`, `signoff`, `provider` (`resend`/`smtp`) + `smtp` connection details, `pacing` (rate-limit delays), and the `templates` map (seeded into the DB, admin-editable) |
| `features` | `kreisverbandField`, `occupationField`, `germanyMap`, `stateResolution`, `zoomEvent` — toggle the optional modules |
| `zoom` | event label/date/duration (only read when `features.zoomEvent`) |

The rich letter body and FAQ are React components in the sibling `content.jsx`.

### Admin-editable settings

The admin dashboard (served at the secret `/${ADMIN_PATH}` route) can edit, at runtime without redeploying:

- **Milestones** (Einstellungen tab) — the goal thresholds for the progress bar; seeded from `hero.milestones`, stored in `app_settings`, served via `/api/stats`.
- **Email templates** and **campaigns**; and the **Zoom event** settings when that module is enabled.

## Stack

- **Runtime**: [Bun](https://bun.sh) — package manager, bundler, HTTP server (no Vite, no framework)
- **Frontend**: React 18, vanilla CSS
- **Backend**: `Bun.serve()` with route handlers
- **Database**: SQLite, **encrypted at rest with [SQLCipher](https://www.zetetic.net/sqlcipher/)** via [`@journeyapps/sqlcipher`](https://www.npmjs.com/package/@journeyapps/sqlcipher) — a node-sqlite3 / N-API build that bundles SQLCipher (async, promise-based access)
- **Jobs**: [Honker](https://honker.dev) durable queues + cron scheduler (campaign sends, zoom mailings, backups, state resolution) — persisted inside the same SQLite file
- **Email**: Resend HTTP API or any SMTP server (nodemailer) for transactional mail

## Project Structure

```
diaetendeckel/
├── package.json
├── index.template.html        # HTML shell with a {{HEAD}} placeholder
├── index.generated.html       # Generated at startup from the active letter (gitignored)
├── config/                    # Per-letter config — the only place campaigns differ
│   ├── letter.config.js       # Selects the active letter's data by LETTER_CONFIG
│   ├── content.jsx            # Selects the active letter's rich JSX (letter + FAQ)
│   ├── theme-css.js           # Builds :root CSS-variable overrides from theme
│   ├── html.js                # Renders <head> from meta (title/OG/JSON-LD/analytics)
│   └── letters/
│       ├── gehaltsdeckel/     # Reference campaign (index.js + content.jsx)
│       └── example/           # Minimal English starter (features off)
├── .env.example
├── .gitignore
├── Dockerfile                 # Production multi-stage build
├── Dockerfile.dev             # Dev/demo build (includes seed + trickle)
├── .dockerignore
├── docker-compose.yml         # Production (encrypted SQLite on a volume)
├── docker-compose.dev.yml     # Dev/demo (SQLite + seed data + trickle)
├── db/
│   ├── connection.js          # Shared SQLCipher-keyed connection (@journeyapps/sqlcipher, async)
│   ├── schema.sql             # Tables + indexes (SQLite)
│   ├── setup.js               # Idempotent schema application
│   ├── seed.js                # Dev: 200 demo signers + live trickle
│   ├── jobs.js                # Honker durable queues + scheduler (encrypted DB)
│   ├── migrate-pg-to-sqlite.js # One-time Postgres → encrypted SQLite migration
│   └── restore-backup.js      # Restore an encrypted backup into DATABASE_PATH
├── server/
│   ├── index.js               # Bun.serve() — routes + security headers
│   ├── db.js                  # Parameterized queries (async, promise-returning)
│   ├── email.js               # Email templates + Resend/SMTP transport
│   └── ratelimit.js           # In-memory sliding window rate limiter
├── src/
│   ├── main.jsx               # React entry point
│   ├── App.jsx                # Full SPA — all sections + modals
│   └── index.css              # All styles + responsive breakpoints
└── vendor/
    └── libhonker_ext.dylib    # Prebuilt Honker extension (macOS arm64) for local dev
```

## Quick Start (local)

Prerequisites: [Bun](https://bun.sh) installed. SQLCipher itself is bundled by
the `@journeyapps/sqlcipher` native module and compiled during `bun install`
(it links OpenSSL for crypto) — you do **not** need to install SQLCipher or
`libsqlcipher` separately.

```bash
git clone <repo-url> && cd diaetendeckel
bun install
cp .env.example .env           # set DATABASE_ENCRYPTION_KEY (required)
bun run db:setup               # create tables + indexes (idempotent)
bun run dev                    # → http://localhost:3000 (HMR enabled)
```

The database is encrypted at rest with SQLCipher. `DATABASE_ENCRYPTION_KEY` is
**required** — the app refuses to start without it.

To populate with demo data in a second terminal:

```bash
bun run db:seed                # seeds 200 signers, then trickles 1 every 6s
```

## Quick Start (Docker — demo with sample data)

No local Bun or Postgres needed:

```bash
docker compose -f docker-compose.dev.yml up --build
```

This creates the encrypted SQLite database, seeds 200 verified signers, trickles a new one every 6 seconds, and serves the app at `http://localhost:3000`.

## Environment Variables

| Variable           | Required   | Default                 | Description                                                                                                           |
| ------------------ | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `LETTER_CONFIG`    | No         | `gehaltsdeckel`         | Which open letter to serve — a directory name under `config/letters/`                                                |
| `DATABASE_PATH`    | No         | `./data/diaetendeckel.db` | Path to the encrypted SQLite database file                                                                          |
| `DATABASE_ENCRYPTION_KEY` | Yes | —                       | SQLCipher passphrase. The app fails closed (won't start) without it.                                                 |
| `HONKER_EXTENSION_PATH` | No    | platform default        | Path to the Honker SQLite extension (`libhonker_ext.{dylib,so}`) for durable jobs                                    |
| `SOURCE_DATABASE_URL` | Migration only | —                | Old Postgres connection string, read by `db:migrate`                                                                |
| `PORT`             | No         | `3000`                  | Server port                                                                                                           |
| `BASE_URL`         | No         | `http://localhost:3000` | Public URL (used in verification emails)                                                                              |
| `NODE_ENV`         | No         | `development`           | `production` enables CSP headers + asset minification                                                                 |
| `ADMIN_PATH`       | Yes        | —                       | Secret single-segment admin path, without leading or trailing slashes. Use `my-secret-panel`, not `/my-secret-panel`. |
| `ADMIN_PASSWORD`   | Yes        | —                       | Admin login password                                                                                                  |
| `ADMIN_JWT_SECRET` | Yes        | —                       | Long random secret for admin session JWTs                                                                             |
| `EMAIL_PROVIDER`   | No         | `email.provider` (config) | Mail transport: `resend` or `smtp`. Overrides the active letter config.                                            |
| `EMAIL_FROM`       | No         | `email.from` (config)   | Verified sender for either provider (alias of `RESEND_FROM`)                                                          |
| `RESEND_API_KEY`   | Yes when provider=resend (prod) | —          | Resend API key used to send transactional email                                                                       |
| `RESEND_FROM`      | No         | `Gehaltsdeckel Initiative <noreply@gehaltsdeckel.jetzt>` | Verified sender used for outbound email                                                  |
| `SMTP_HOST`        | Yes when provider=smtp (prod) | `email.smtp.host` (config) | SMTP server hostname                                                                                       |
| `SMTP_PORT`        | No         | `email.smtp.port` or `587` | SMTP port (`465` = implicit TLS, `587` = STARTTLS)                                                                  |
| `SMTP_SECURE`      | No         | `email.smtp.secure` or `false` | `true` for implicit TLS (port 465); `false` uses STARTTLS                                                       |
| `SMTP_USER`        | No         | —                       | SMTP username (omit for an unauthenticated relay)                                                                     |
| `SMTP_PASS`        | No         | —                       | SMTP password                                                                                                         |
| `EMAIL_MESSAGE_DELAY_MS` | No   | `email.pacing.messageDelayMs` or `550` | Delay (ms) between one-by-one sends (zoom link mailing)                                            |
| `EMAIL_BATCH_DELAY_MS` | No     | `email.pacing.batchDelayMs` or `1000` | Delay (ms) between 100-email batch chunks (campaigns, reminders)                                    |
| `BACKUP_ENCRYPTION_KEY` | No    | `DATABASE_ENCRYPTION_KEY` | Separate SQLCipher key for backup files. Defaults to the live DB key.                                              |
| `BACKUP_DIR`       | No         | `/app/backups`          | Directory for database backup files                                                                                   |
| `BACKUP_KEEP`      | No         | `48`                    | Number of hourly backup files to retain                                                                               |
| `BACKUP_GZIP`      | No         | `true`                  | Gzip the encrypted backup snapshot                                                                                    |

See `.env.example` for a template.

## Scripts

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `bun run dev`      | Start dev server with watch mode + HMR            |
| `bun run start`    | Start production server                           |
| `bun run db:setup` | Apply database schema (idempotent)                |
| `bun run db:seed`  | Seed 200 demo signers + trickle new ones every 6s |
| `bun run db:migrate` | One-time migrate from Postgres (`SOURCE_DATABASE_URL`) into encrypted SQLite |
| `bun run db:restore <file\|--latest>` | Restore an encrypted backup into `DATABASE_PATH` |

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
- Sends verification email through Resend
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

SQLite, encrypted at rest with SQLCipher via `@journeyapps/sqlcipher` — a
node-sqlite3 build that bundles the SQLCipher amalgamation and loads over N-API.
(`bun:sqlite` can't be used for this: its `Database.setCustomSQLite()` is a
silent no-op on Bun's Linux builds, so `PRAGMA key` would be ignored and the
database left unencrypted.) `PRAGMA key` is applied as the first statement on
every connection; the app verifies `PRAGMA cipher_version` is active and fails
closed otherwise. The driver's API is asynchronous, so database access is
promise-based (`await`ed) throughout. The file, its WAL, and all backups are
encrypted.

Core table `signers` (`id`, `name`, `email` unique, `kreisverband`, `occupation`,
`state`, `newsletter`, `show_publicly`, `verified`, token columns, `created_at`),
plus `email_templates`, `campaigns` (with `audience` + JSON `recipient_ids`),
`zoom_registrations`, `zoom_event_mailings`, `app_settings`, and the
KV/state-resolution caches.

Conventions: timestamps are ISO-8601 UTC `TEXT`; booleans are `0/1`. Schema
creation is idempotent (`IF NOT EXISTS`) — safe to run on every container start.

### Migrating from Postgres (zero data loss)

```bash
SOURCE_DATABASE_URL=postgres://…  DATABASE_PATH=/app/data/diaetendeckel.db \
DATABASE_ENCRYPTION_KEY=…  bun run db:migrate
```

Copies every table preserving primary-key ids, converting booleans, timestamps,
and the `recipient_ids` array, then prints per-table source vs destination row
counts and aborts on any mismatch. Run it during a brief maintenance window with
the app stopped, then start the app pointed at the new file.

## Email

The mail transport is chosen per letter via `email.provider` in the config, or
overridden per-deployment with the `EMAIL_PROVIDER` env var. Two providers are
supported:

- **`resend`** (default) — Resend's HTTP Email API. Set `RESEND_API_KEY`. See
  `resend-email-setup.txt` for domain verification and deployment setup.
- **`smtp`** — any SMTP server (mailbox.org, a self-hosted relay, Gmail, etc.)
  via [nodemailer](https://nodemailer.com). Non-secret connection details
  (`host`/`port`/`secure`) live in the letter config under `email.smtp` or in
  `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`; credentials come from `SMTP_USER` /
  `SMTP_PASS` only. SMTP has no batch endpoint, so batch sends loop per message.

In both cases **secrets stay in env** — never put API keys or SMTP passwords in
the committed config. The sender address is `email.from` (override with
`EMAIL_FROM` / `RESEND_FROM`).

**Pacing:** the mailing workers insert delays to stay under provider rate limits
— `email.pacing.messageDelayMs` between one-by-one sends and
`email.pacing.batchDelayMs` between 100-email batch chunks (defaults `550`/`1000`
ms, tuned for Resend's ~2/s). Override per-deployment with
`EMAIL_MESSAGE_DELAY_MS` / `EMAIL_BATCH_DELAY_MS` — raise them for a stricter SMTP
relay, or lower them if your provider allows faster sends.

**Dev/demo:** point `provider=smtp` at a local catcher like
[Mailpit](https://github.com/axllent/mailpit)/MailHog on `localhost:1025`
(`SMTP_SECURE=false`), or set `RESEND_API_KEY` to test real Resend delivery.
Without a configured provider, development starts but email submission fails when
a route tries to send mail.

**Production:** the selected provider's credentials are required — `RESEND_API_KEY`
for `resend`, or `SMTP_HOST` (plus `SMTP_USER`/`SMTP_PASS` for authenticated
relays) for `smtp`. The app fails closed at startup if they're missing.

## Security

- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. In production: `Content-Security-Policy` restricting sources to `'self'` + Google Fonts.
- **Rate limiting**: In-memory sliding window, 3 sign requests per IP per 15 minutes.
- **Input sanitization**: All text trimmed, HTML tags stripped, lengths capped. Parameterized SQL queries throughout.
- **Token security**: `crypto.randomUUID()` (128-bit), 24h expiry, cleared after use.
- **No email exposure**: `/api/signers` never returns email addresses. `/api/sign` returns the same response whether the email exists or not.

## Durable jobs (Honker)

Background work — scheduled **campaign sends**, **zoom event mailings**, and
**hourly backups** — runs on durable [Honker](https://honker.dev) queues instead
of in-memory timers. The Honker SQLite extension is loaded into the app's
SQLCipher-keyed connection and driven via its `honker_*` SQL functions, so job
rows live inside the **same encrypted database** (encrypted at rest) and survive
restarts, with automatic retries and dead-lettering.

- Creating a campaign enqueues a `campaigns` job delivered at its scheduled time;
  a reconciler re-enqueues any due/failed campaign so sends survive restarts.
- A cron scheduler fires the zoom-mailing check (every 60s) and the hourly backup.
- The extension binary is **not on npm**, so it ships with this repo / image:
  - **Local dev (macOS, Apple Silicon):** a prebuilt `vendor/libhonker_ext.dylib`
    is committed and loaded by default (`bun run dev` works with no extra steps).
  - **Docker / Linux:** the images build the Linux `libhonker_ext.so` from source
    in a Rust stage and set `HONKER_EXTENSION_PATH` automatically.
  - **Other local platforms (Linux/Intel macOS):** build it from the
    [Honker repo](https://github.com/russellromney/honker)
    (`cargo build --release -p honker-extension`) and point `HONKER_EXTENSION_PATH`
    at the resulting `libhonker_ext.{dylib,so}`.

## Backups

Hourly backups write a consistent, SQLCipher-encrypted snapshot to `BACKUP_DIR`
(default `/app/backups`), keeping the most recent `BACKUP_KEEP` files (default
48). Each snapshot is produced via SQLCipher's `sqlcipher_export()` into an
ATTACHed keyed file, then gzipped (`.sqlite.gz`). Because the snapshot is itself
SQLCipher-encrypted, backups are encrypted at rest with no extra step.

By default backups use `DATABASE_ENCRYPTION_KEY`; set `BACKUP_ENCRYPTION_KEY` to
use a distinct key. **Store the key securely and separately from the backups** —
without it, a backup cannot be opened.

### Restoring a backup

```bash
# Restore the most recent backup (app stopped) — moves any existing DB aside
# to <path>.pre-restore-<timestamp> first, then verifies row counts.
DATABASE_PATH=/app/data/diaetendeckel.db DATABASE_ENCRYPTION_KEY=… \
  bun run db:restore --latest

# Or a specific file:
bun run db:restore /app/backups/backup-2026-06-09T12-00-00.sqlite.gz
```

The restore re-keys the snapshot to `DATABASE_ENCRYPTION_KEY`, so it works even
if the backup used a separate `BACKUP_ENCRYPTION_KEY`.

## Deployment (Dokploy)

The database is a single encrypted SQLite file on a persistent volume — there is
no separate database service.

### Production

```bash
docker compose up --build
```

Set in Dokploy UI or `.env`:

- `DATABASE_ENCRYPTION_KEY` — SQLCipher key (required). Generate: `openssl rand -hex 32`
- `BASE_URL` — public URL (e.g. `https://diaetendeckel.example.de`)
- `RESEND_API_KEY` — Resend API key with send access (when `provider=resend`)
- `RESEND_FROM` / `EMAIL_FROM` — optional verified sender override
- For SMTP instead: set `EMAIL_PROVIDER=smtp` + `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`

The `data` volume holds `diaetendeckel.db`; the `backups` volume holds the hourly
encrypted snapshots. Back up the key separately from both.

### Dev / Demo

```bash
docker compose -f docker-compose.dev.yml up --build
```

Includes Postgres, auto-seeds 200 signers, and trickles new ones every 6 seconds. Default DB password: `devpass`.

In all cases, the app runs `db/setup.js` on startup to ensure the schema exists. Health check at `/api/health` confirms DB connectivity.
