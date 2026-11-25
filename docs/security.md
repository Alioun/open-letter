# Security

## Requests and authentication

The server sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`. In production, its content security policy restricts resources to the configured sources, including the app and Google Fonts.

Public read routes require a 30-minute JWT from `/api/session` unless `REQUIRE_API_TOKEN=false`. `API_TOKEN_SECRET` signs these tokens. Admin sessions use a separate `ADMIN_JWT_SECRET`. Production rejects equal secrets. CORS uses `ALLOWED_ORIGINS`, which defaults to `BASE_URL`.

Signature requests use an in-memory sliding rate limit of 30 requests per IP per 15 minutes. Public reads also have per-IP limits. With `TRUST_PROXY=true`, the server takes the client address from the last `X-Forwarded-For` entry, which is the one the reverse proxy adds for the peer it saw. If that entry is missing or not an IP address, the server uses the socket address. It never reads `X-Real-IP` or an earlier `X-Forwarded-For` entry, because a client can set both. The proxy must set or append `X-Forwarded-For` itself; Caddy does this by default, and the shipped `Caddyfile` also overwrites `X-Real-IP`. Prevent direct access to the application port, since a direct client could write the whole header. Without `TRUST_PROXY`, the server ignores forwarding headers.

Admin sign-in allows 5 attempts per address per 15 minutes. Failed attempts from all addresses together are capped at 30 per 15 minutes, so a guess spread over many addresses stops there. While that cap is reached, nobody can sign in, including the team, and existing sessions keep working. Both limits answer 429 with `Retry-After`. Each failed attempt is logged with its address and never with the password that was tried.

An admin token lasts two hours and carries the session generation it was issued under. `POST /api/admin/logout-everywhere` raises the generation, which ends every session at once. Starting the server with a different `ADMIN_PASSWORD` does the same, and so does restoring a backup. The ordinary sign-out only discards the token in that browser. Tokens issued before this mechanism existed are rejected, so the first deploy signs everyone out once.

`robots.txt` does not name the admin path, and the admin page is served with `X-Robots-Tag: noindex`.

Text input is trimmed, stripped of HTML, and length-limited. Database queries use parameters. Public signer responses contain no email addresses. A signature request returns the same success response for new and existing addresses.

Confirmation and deletion links use UUID tokens. They expire after `privacy.confirmationLinkHours`, which defaults to 24 hours, and are cleared after use. Other link lifetimes follow the [retention configuration](operations.md#data-retention).

## Database encryption

`@journeyapps/sqlcipher` provides SQLite with SQLCipher through N-API. Each connection applies `PRAGMA key` before any other statement and checks `PRAGMA cipher_version`. The app refuses to proceed if encryption is unavailable. The database, its write-ahead log, and backup snapshots are encrypted. Database access uses the driver's asynchronous API.

Do not replace the driver with `bun:sqlite` without verifying encryption on every supported platform. On Bun's Linux builds, `Database.setCustomSQLite()` does not load SQLCipher, so `PRAGMA key` alone can leave a database unencrypted.

The database contains signatures, email templates, campaigns and selections, meeting registrations and mailings, settings, publications, images, email profiles, analytics, and resolution caches. See `db/schema.sql` and `db/publishing.sql` for the schema. Timestamps generally use ISO-8601 UTC text. Booleans use `0` and `1`. Schema creation uses `IF NOT EXISTS` and can run at every startup.

Keep encryption keys separate from backups. See [operations](operations.md) for restoration and the steps needed to preserve erasures and opt-outs. See [publishing and email administration](publishing.md) for publication transactions, preview and CSS isolation, credential handling, delivery reconciliation, and statistics collection.

## Erasure and in-flight mail

A queued invitation stores its private statistics token in the encrypted job payload so a retry preserves the mailed link. The signer row stores only its hash. Successful acknowledgement removes the pending job. Failed jobs expire under `privacy.emailJobRetentionHours`, and erasure deletes queued messages for the recipient.

Authorized erasure deletes the person's records and writes the restore tombstone in one transaction. Live erasure and restore share the same deletion rules. New send attempts carry a keyed address hash so erasure can remove them without preserving the address. Acceptance updates require the original recipient identity, so a provider response after erasure cannot recreate a delivery record.

An upgrade matches older send attempts to surviving campaign, registration, and queue records. Unmatched legacy attempts keep their existing retry protection until the delivery-log retention sweep removes them. They have no recoverable subject identity, so an erasure cannot reliably associate them with an address. Their original age limits retention even if a retry updates them.

Workers check current consent immediately before calling the provider. A message already submitted to an external provider cannot be recalled by a later opt-out or erasure. Backups retain encrypted historical data until they expire. Restoration can preserve later erasures only when their tombstones remain readable.
