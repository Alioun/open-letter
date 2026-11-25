# Operations

## Deployment

Run one application instance. Its encrypted SQLite database lives on a persistent volume. It needs no separate database service.

Set these values in the deployment environment or `.env`:

| Setting                                                                | Value                                                                                                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_ENCRYPTION_KEY`                                              | Database key. Generate it with `openssl rand -hex 32`.                                                                                                               |
| `BACKUP_ENCRYPTION_KEY`                                                | A separate backup key, required in production.                                                                                                                       |
| `ADMIN_PATH`, `ADMIN_PASSWORD`, `ADMIN_JWT_SECRET`, `API_TOKEN_SECRET` | Admin route and authentication secrets. Use a password of at least 16 characters, a JWT secret of at least 32 characters, and distinct admin/public signing secrets. |
| `BASE_URL`                                                             | Public URL, such as `https://letter.example.org`.                                                                                                                    |
| `RESEND_API_KEY`                                                       | Sending key when using Resend. `RESEND_FROM` or `EMAIL_FROM` can override the verified sender.                                                                       |
| `EMAIL_PROVIDER=smtp` and `SMTP_*`                                     | SMTP provider and connection settings when using SMTP.                                                                                                               |

```bash
docker compose up --build
```

The `data` volume contains `diaetendeckel.db`. The `backups` volume contains encrypted hourly snapshots. Store their keys separately. Startup runs `db/setup.js`. `/api/health` returns 200 only when the database and durable jobs are ready. It returns 503 during initialization, job failure, or shutdown. For alerting on mail and backups, see [monitoring](#monitoring).

To update a server that runs from a git checkout, run `scripts/deploy.sh` there. It fast-forwards to `main` on GitHub, rebuilds the app with the deployed commit baked in for `/api/version`, and waits until the container is healthy. If the checkout has local edits that the update would change, it stops before touching anything.

For a local demo:

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

The demo creates 200 verified signers and adds another every six seconds. Development defaults supply database and API secrets if they are unset. Use real provider credentials to test email delivery.

### HTTPS with Caddy

The app container publishes no port. Put a reverse proxy in front of it. `docker-compose.proxy.yml` adds Caddy, which gets a Let's Encrypt certificate for your domain. Point the domain's DNS at the server, open ports 80 and 443, and add to `.env`:

```bash
DOMAIN=letter.example.org
BASE_URL=https://letter.example.org
COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
```

Compose reads `COMPOSE_FILE` from `.env`, so `docker compose up -d`, `docker compose logs` and `scripts/deploy.sh` then include the proxy. `TRUST_PROXY` defaults to `true` in `docker-compose.yml`, which is right behind Caddy. See [security](security.md#requests-and-authentication) for how the client address is read.

`scripts/deploy.sh` restarts only the app. The proxy container keeps reading the `Caddyfile` it started with, even after an update replaced the file. After an update that changes `Caddyfile`, restart the proxy once:

```sh
docker compose restart caddy
```

### Images in `public/`

Image files directly in `public/` are served at the site root: `public/poster.jpg` is `/poster.jpg`. Use this for a letter's `hero.artwork.src` or `meta.ogImage`. Only `png`, `jpg`, `jpeg`, `webp`, `avif`, and `gif` files are served, cached for a day. Subfolders, dotfiles, and symlinks are not served. `docker-compose.yml` mounts `./public`, so an image copied into the checkout on the server is served without a rebuild.

### Pausing sign-ups

Set `SIGNING_PAUSED=1` and restart the app to stop new signatures. The letter and the list stay online. The form shows `ui.signForm.pausedTitle` and `pausedMessage` instead of its fields. Sign-up requests, resend requests, and confirmation links answer 503 with the same message. The default message says confirmation emails are unavailable. Change it in the letter config when you pause for another reason. Remove the setting and restart to open signing again.

Signing does not need a pause when mail is down. Sign-ups are stored and their confirmation mails wait in the queue. A sign-up that stays unconfirmed still expires after `privacy.confirmationLinkHours`. The admin start page counts those that never got a mail, see [below](#sign-ups-lost-without-a-confirmation-mail).

## Commands

| Command                               | Purpose                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `bun run dev`                         | Start development with file watching and hot module replacement.                |
| `bun run start`                       | Start the production server.                                                    |
| `bun run db:setup`                    | Create or update the database schema. Safe to repeat.                           |
| `bun run db:seed`                     | Add 200 demo signers and four first signers, then one signer every six seconds. |
| `bun run db:migrate`                  | Copy an existing Postgres database into encrypted SQLite.                       |
| `bun run db:restore <file\|--latest>` | Restore an encrypted backup into `DATABASE_PATH`.                               |
| `bun run test`                        | Run the test suite.                                                             |
| `bun run honker:build`                | Build the local Honker SQLite extension.                                        |
| `bun run og`                          | Regenerate `public/og.png` from the running site.                               |
| `bun scripts/generate-artwork.js`     | Redraw the example letter's placeholder `public/example-artwork.webp`.          |
| `bun scripts/preview-letter.js`       | Preview the letter design with demo data, without a database.                   |

See [publishing verification](publishing.md#verify-and-restore) for focused and full-application checks.

## Monitoring

Point an uptime monitor at `GET /api/health/operations`. It answers 200 while everything below is in order and 503 as soon as one check needs a person. A monitor that alerts on any status other than 200 is enough.

```json
{
  "ok": false,
  "checks": {
    "app": "ok",
    "mail": "ok",
    "mailQueue": "failed",
    "backup": "ok"
  }
}
```

| Check       | States                    | Meaning of a state other than `ok`                                                                                                                             |
| ----------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`       | `ok`, `down`              | The database or the durable jobs are not ready. Sign-ups are refused and no backup runs.                                                                       |
| `mail`      | `ok`, `not-ready`         | No validated email profile is active. Confirmation mails and campaigns wait. Fix it in the admin under Einstellungen.                                          |
| `mailQueue` | `ok`, `failed`, `unknown` | `failed`: at least one mail was given up on after its retries. It can be queued again in the email settings. The state clears when the failed mail is purged.  |
| `backup`    | `ok`, `failed`, `stale`   | `failed`: the last backup attempt failed. `stale`: no backup for more than three hours, or none at all three hours after start. See [backups](#backups) below. |

Anyone can read this endpoint, so it holds one word per check: no counts, no addresses, no paths, no error text. It allows 30 requests per minute per address.

To get numbers as well, set `HEALTH_TOKEN` (at least 16 characters, not the admin password) and send it as a bearer token. The answer then has a `details` object with `failedMails`, `queuedMails`, `lastMailAcceptedAt`, `lastBackupAt`, `lastBackupAgeHours`, and `lastBackupFailedAt`. A wrong token gets 401. Without `HEALTH_TOKEN`, nobody gets details.

```bash
curl -fsS https://letter.example.org/api/health/operations
curl -sS -H "Authorization: Bearer $HEALTH_TOKEN" \
  https://letter.example.org/api/health/operations
```

Example setup with a hosted monitor such as UptimeRobot or Uptime Kuma: an HTTP(s) check on `https://letter.example.org/api/health/operations` every five minutes, alerting when the status is not 200, with two retries before the alert so a restart during a deploy stays quiet. To have the alert say what is wrong, add a keyword check for `"ok":true` or let the monitor store the response body.

`/api/health` is a different check. It covers only the database and the durable jobs, and the container health check and `scripts/deploy.sh` rely on it. A paused email profile does not fail it, so do not use it for alerting on mail or backups.

Each failed admin sign-in writes one line to the application log, `[admin] failed login from <address>`. The line never contains what was typed. The sign-in limits cap how many such lines one address can cause, see [security](security.md#requests-and-authentication). Watch for them with `docker compose logs app | grep "failed login"`.

## Backups

The hourly job writes a consistent SQLCipher snapshot to `BACKUP_DIR`, which defaults to `/app/backups`. It uses `sqlcipher_export()` with a keyed attached database, then compresses the encrypted file as `.sqlite.gz`. `BACKUP_GZIP=false` disables compression.

`BACKUP_KEEP` sets retention in hours. Its default is `privacy.backupRetentionHours`, normally 48. It cannot exceed the erasure-log retention period. An unsafe override fails startup. Pre-restore copies follow the same retention period.

A backup that cannot be written fails its job. The job is retried and then dead-lettered, and the next hourly run tries again. `GET /api/admin/backup` returns the time and size of the last successful backup, the error and time of a failure since then, and the retention in hours.

Retention has one exception. While backups keep failing, the newest existing backup is kept even after it is older than the retention period, so that a restore point remains. That copy then holds data past the period the privacy policy states. The backup state reports its time as `expiredRestorePoint`, and each run logs it as an error. Fix the cause promptly; the next successful backup replaces the copy.

Production requires `BACKUP_ENCRYPTION_KEY`. Development falls back to `DATABASE_ENCRYPTION_KEY`. Without the backup key, you cannot open a backup. Store the key separately from the snapshots.

### Restore a backup

Stop the application first. To restore the newest backup:

```bash
DATABASE_PATH=/app/data/diaetendeckel.db DATABASE_ENCRYPTION_KEY=… \
  bun run db:restore --latest
```

To restore a named file:

```bash
bun run db:restore /app/backups/backup-2026-06-09T12-00-00.sqlite.gz
```

Restoration checks row counts, publication documents, and asset hashes. It moves an existing database to `<path>.pre-restore-<timestamp>` and re-keys the restored data with `DATABASE_ENCRYPTION_KEY`. The backup may use a different key.

Before replacement, restoration reads the old database's `erasure_log`. Afterward, it reapplies later erasures, newsletter and meeting opt-outs, and requests to hide names. Erasure covers registrations, pending requests, queued messages, delivery logs, and identifiable send attempts. Rows created after a logged event remain unchanged. The log stores an HMAC of the address, the action, and its time for `privacy.erasureLogDays`.

If the old database cannot be read, restoration reports that it could not recover the log. Reapply those requests before restarting. A function or organisation that was taken off is in the log and stays off. Other profile edits, such as a changed name or regional affiliation, are not in the log and cannot be recovered this way.

The admin log comes back as the backup held it. Entries made after the backup was taken are lost.

Restoration also keeps signing blocks as they stood in the replaced database: a block lifted after the backup was taken stays lifted, and one set after it stays set. It ends every admin session, because the backup predates any sign-out that happened since. Sign in again afterwards.

Restoration marks email validation stale. Revalidate delivery before releasing waiting mail. Startup rebuilds derived image caches. Browser drafts do not replace database backups.

## Data retention

Set retention periods and link lifetimes in the letter's `privacy` configuration. `config/privacy.js` defines and validates the defaults. The privacy policy uses the same values.

| Key                      | Default | Effect                                                                                                                                                                                       |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirmationLinkHours`  | 24      | Signature, meeting, and deletion links expire. Pending records are swept every five minutes.                                                                                                 |
| `settingsLinkDays`       | 90      | A signer can view, edit, or delete data through a settings link for this long after the last email containing it. Opt-out does not expire. Meeting links work while the registration exists. |
| `emailJobRetentionHours` | 24      | Queued messages expire. An hourly job deletes dead-letter messages after this period.                                                                                                        |
| `treffenRetentionDays`   | 14      | Meeting registrations are deleted this many days after the event.                                                                                                                            |
| `signerRetentionYears`   | 3       | A daily job deletes older signatures and meeting registrations.                                                                                                                              |
| `backupRetentionHours`   | 48      | Old backups and pre-restore copies are deleted. `BACKUP_KEEP` overrides this value.                                                                                                          |
| `erasureLogDays`         | 7       | Hashed erasure and opt-out records remain available for restoration. Must cover backup retention.                                                                                            |
| `deliveryLogDays`        | 30      | Delivery records prevent repeat sending after interruption. They expire after this period, which also limits campaign retries.                                                               |
| `adminLogDays`           | 30      | Entries of the admin log (Protokoll) are deleted after this many days; old and new values of a signature edit go earlier, with the signature. The privacy policy states this period.         |

### Sign-ups lost without a confirmation mail

The five-minute sweep counts the unconfirmed sign-ups it deletes for which the mail service never accepted a mail. These are people who signed while mail was down or paused. The admin start page shows the number for the last 30 days. The database keeps one number per day under the `signups_expired_unmailed` setting and nothing about who they were.

### Admin log

The admin records what was done under Einstellungen, in "Protokoll": moderation, edits, exports, merges, campaigns, template and website changes, settings, and signing everyone out. An entry holds the time, the action, the id it concerned, and a count. It never holds an email address. An edit of a signature also holds the old and new values; these are deleted with the signature, whether it is erased on request, removed in the admin, or deleted by age.

### Ending a campaign

The privacy policy promises deletion when the campaign ends. The app does not perform this closure automatically.

1. Keep only the aggregate figures you need.
2. Stop the app. Delete `DATABASE_PATH`, its `-wal` and `-shm` files, and adjacent `*.pre-restore-*` copies.
3. Delete backups in `BACKUP_DIR` and any off-site copies.
4. Delete copied signer and meeting lists from spreadsheets, email, or shared drives. Ask recipients of those copies to delete them too.
5. Delete the site's analytics data. Check the mail provider's retention period, configured as `email.providerRetentionDays`, and delete retained mail earlier if needed.
6. Record the deletion date and the data removed.

## Durable jobs

[Honker](https://honker.dev) stores scheduled campaigns, meeting mailings, email work, and hourly backup jobs in the same encrypted database. Its SQLite extension runs through `honker_*` SQL functions. Jobs survive restarts and support retries and dead-lettering.

Operations that require email commit their data changes and job together. The server never sends that mail inline as a fallback. A queue outage returns 503 before accepting a signup, replacing a confirmation or deletion token, or creating a campaign. Public reading, opt-out, and authorized erasure remain available. The email settings show the job outage instead of an empty queue count.

Creating a campaign enqueues a job for its scheduled time. Reconciliation recovers due work after restart. A cron scheduler checks meeting mail every 60 seconds and starts hourly backups. These maintenance jobs cannot run while Honker is unavailable. Restore readiness before treating the service as operational.

On SIGTERM or SIGINT, the server rejects new requests, drains accepted requests and active workers, and closes its database connections. Workers stop between recipients. Allow enough shutdown time for a provider request already in progress and any active backup. A forced kill can leave provider acceptance uncertain and require reconciliation.

The extension is not an npm package. Docker builds the Linux library in a Rust stage and sets `HONKER_EXTENSION_PATH`. For local development, run `bun run honker:build` with Git and Rust installed. It creates `vendor/libhonker_ext.dylib` on macOS or `vendor/libhonker_ext.so` on Linux. `HONKER_REF` can select a source ref. You can also build `honker-extension` from the [Honker repository](https://github.com/russellromney/honker) and set `HONKER_EXTENSION_PATH` to the resulting library.

See [delivery and storage ownership](architecture.md) for transaction, retry, consent, and event identity rules.

## Migrate from Postgres

Stop the app for the migration.

```bash
SOURCE_DATABASE_URL=postgres://… DATABASE_PATH=/app/data/diaetendeckel.db \
DATABASE_ENCRYPTION_KEY=… bun run db:migrate
```

The script checks for the source application schema before opening the target. An unrelated database is rejected, while an empty application database is valid. The script preserves primary-key IDs and converts booleans, timestamps, and `recipient_ids`. It compares source and destination row counts for each copied table and stops on a mismatch. Check the report before starting the app with the new database path.

`bun run verify:migration` checks the production migration against a disposable PostgreSQL 18 container and encrypted SQLite files. It covers type conversion, IDs, foreign keys, reruns, row counts, and invalid source or target databases. It requires Docker and loopback access. The command prints the path to its evidence and removes its own test databases and container.
