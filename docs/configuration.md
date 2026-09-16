# Configuration

Everything specific to a campaign lives in `config/letters/<name>/`: `index.js` holds the data and `content.jsx` holds the letter body and FAQ. Secrets and deployment settings come from env.

## Letter config (`index.js`)

| Key | What it controls |
| --- | --- |
| `brand` | `name`, `wordmark`, `lang`, `locale` |
| `theme` | `colors` (palette → CSS variables), `fonts` (`display`/`body`), `style` (`shadowOffset`, `radius`, `borderWidth`) — drives the page, emails, and generated images |
| `meta` | `<head>`: title, description, canonical, OG/Twitter, favicon, JSON-LD `schemaAbout`, optional `analytics` `{src, websiteId, retentionMonths}` |
| `privacy` | retention periods and link lifetimes, enforced by the server and quoted in the privacy policy — see [Data retention](operations.md#data-retention) |
| `hero` | headline lines, CTA labels, counter/goal labels, seed `milestones` |
| `nav` / `navCta` / `list` | nav items, top-bar CTA, signer-list heading |
| `sign` | section heading, `criteria`, `privacyNote`, form copy, and `fields` (labels/placeholders for the two optional `kreisverband`/`occupation` columns) |
| `footer` / `legal` | footer blurb + contact; Impressum/Datenschutz responsible entity, address, contact, disclaimer |
| `email` | `from`, `signoff`, `provider` (`resend`/`smtp`) + `smtp` connection details, `providerRetentionDays` (how long the provider keeps sent mail; quoted in the privacy policy), `pacing` (rate-limit delays), and the `templates` map (seeded into the DB, admin-editable) |
| `pages` | copy for the server-rendered pages behind mail links (confirm, delete, Treffen); defaults in `server/pages.js` |
| `features` | `kreisverbandField`, `occupationField`, `germanyMap`, `stateResolution`, `zoomEvent` — toggle the optional modules |
| `zoom` | event label/date/duration (only read when `features.zoomEvent`) |


The rich letter body and FAQ are React components in the sibling `content.jsx`.

## Admin-editable settings

The admin dashboard (served at the secret `/${ADMIN_PATH}` route) can edit, at runtime without redeploying:

- **Milestones** (Einstellungen tab) — the goal thresholds for the progress bar; seeded from `hero.milestones`, stored in `app_settings`, served via `/api/stats`.
- **Email templates** and **campaigns**; and the **Zoom event** settings when that module is enabled.

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
| `ADMIN_JWT_SECRET` | Yes        | —                       | Random secret for admin session JWTs, at least 32 characters. In production it must be **distinct** from `API_TOKEN_SECRET` (fails closed if equal). |
| `API_TOKEN_SECRET` | Yes (prod) | —                       | Secret for signing public API session JWTs. Must be **distinct** from `ADMIN_JWT_SECRET` in production.               |
| `REQUIRE_API_TOKEN`| No         | `true`                  | Gate public read endpoints behind a session token from `/api/session`. Set `false` to disable the gate (escape hatch). |
| `ALLOWED_ORIGINS`  | No         | `BASE_URL`              | Comma-separated CORS allowlist for public API responses. Origins not listed fall back to `BASE_URL`.                  |
| `TRUST_PROXY`      | No         | `false`                 | Trust `X-Forwarded-For` for the client IP — set `true` behind a reverse proxy so per-IP rate-limiting is accurate. Warns at startup in production when unset. |
| `DATABASE_JOURNAL_MODE` | No    | SQLite default (`DELETE` in compose) | SQLite journal mode (`PRAGMA journal_mode`). Compose sets `DELETE`.                                   |
| `GIT_COMMIT`       | No         | —                       | Commit SHA surfaced at `/api/version`. Falls back to `COMMIT_SHA`, `SOURCE_COMMIT`, `GIT_SHA`, `SOURCE_VERSION`, and PaaS vars (`RAILWAY_`/`RENDER_`/`VERCEL_GIT_COMMIT_SHA`). |
| `EMAIL_PROVIDER`   | No         | `email.provider` (config) | Mail transport: `resend` or `smtp`. In production it must match the letter config's `email.provider` (the app refuses to start otherwise), because the privacy policy names the processor from the config. |
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
| `BACKUP_ENCRYPTION_KEY` | Yes (prod) | `DATABASE_ENCRYPTION_KEY` | Separate SQLCipher key for backup files. Required in production; falls back to the live DB key in development. |
| `BACKUP_DIR`       | No         | `/app/backups`          | Directory for database backup files                                                                                   |
| `BACKUP_KEEP`      | No         | `privacy.backupRetentionHours` (48) | Hours of hourly backups to retain. Overrides the letter config, which the privacy policy quotes — the server warns when they differ |
| `BACKUP_GZIP`      | No         | `true`                  | Gzip the encrypted backup snapshot                                                                                    |

See [`.env.example`](../.env.example) for a template.

## Email

The mail transport is chosen per letter via `email.provider` in the config.
`EMAIL_PROVIDER` can override it outside production; in production the two must
match, because the Datenschutzerklärung names the email processor from the
config, and the server refuses to start on a mismatch. Two providers are
supported:

- **`resend`** (default) — Resend's HTTP Email API. Set `RESEND_API_KEY`. See
  [`resend-email-setup.txt`](../resend-email-setup.txt) for domain verification and deployment setup.
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

