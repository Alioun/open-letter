# Operations

## Deployment

Run one application instance. Its encrypted SQLite database lives on a persistent volume; it needs no separate database service.

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

The `data` volume contains `diaetendeckel.db`; the `backups` volume contains encrypted hourly snapshots. Store their keys separately. Startup runs `db/setup.js`. `/api/health` returns 200 only when the database and durable jobs are ready. It returns 503 during initialization, job failure, or shutdown.

For a local demo:

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

The demo creates 200 verified signers and adds another every six seconds. Development defaults supply database and API secrets if they are unset. Use real provider credentials to test email delivery.

## Commands

| Command                               | Purpose                                                          |
| ------------------------------------- | ---------------------------------------------------------------- |
| `bun run dev`                         | Start development with file watching and hot module replacement. |
| `bun run start`                       | Start the production server.                                     |
| `bun run db:setup`                    | Create or update the database schema. Safe to repeat.            |
| `bun run db:seed`                     | Add 200 demo signers, then one every six seconds.                |
| `bun run db:migrate`                  | Copy an existing Postgres database into encrypted SQLite.        |
| `bun run db:restore <file\|--latest>` | Restore an encrypted backup into `DATABASE_PATH`.                |
| `bun run test`                        | Run the test suite.                                              |
| `bun run honker:build`                | Build the local Honker SQLite extension.                         |
| `bun run og`                          | Regenerate `public/og.png` from the running site.                |

See [publishing verification](publishing.md#verify-and-restore) for focused and full-application checks.

## Backups

The hourly job writes a consistent SQLCipher snapshot to `BACKUP_DIR`, which defaults to `/app/backups`. It uses `sqlcipher_export()` with a keyed attached database, then compresses the encrypted file as `.sqlite.gz`. `BACKUP_GZIP=false` disables compression.

`BACKUP_KEEP` sets retention in hours. Its default is `privacy.backupRetentionHours`, normally 48. It cannot exceed the erasure-log retention period. An unsafe override fails startup. Pre-restore copies follow the same retention period.

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

If the old database cannot be read, restoration reports that it could not recover the log. Reapply those requests before restarting. Other profile edits, such as a changed name, regional affiliation, or occupation, are not in the log and cannot be recovered this way.

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
