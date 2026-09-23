# Security

- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. In production: `Content-Security-Policy` restricting sources to `'self'` + Google Fonts.
- **Rate limiting**: In-memory sliding window, 30 sign requests per IP per 15 minutes; public read endpoints are also per-IP rate-limited.
- **Public API session tokens**: read endpoints are gated behind a 30-minute JWT issued by `/api/session`, signed with `API_TOKEN_SECRET` (a separate key from the admin JWTs). Set `REQUIRE_API_TOKEN=false` to disable the gate.
- **CORS allowlist**: API responses are restricted to `ALLOWED_ORIGINS` (defaults to `BASE_URL`).
- **Proxy-aware rate limiting**: with `TRUST_PROXY=true` the client IP is read from `X-Forwarded-For`, so per-IP limits stay correct behind a reverse proxy.
- **Input sanitization**: All text trimmed, HTML tags stripped, lengths capped. Parameterized SQL queries throughout.
- **Token security**: `crypto.randomUUID()` (128-bit), 24h expiry, cleared after use.
- **No email exposure**: `/api/signers` never returns email addresses. `/api/sign` returns the same response whether the email exists or not.

## Database encryption

SQLite, encrypted at rest with SQLCipher via `@journeyapps/sqlcipher`, a
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
creation is idempotent (`IF NOT EXISTS`), so it is safe to run on every container start.

