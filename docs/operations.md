# Operations

## Deployment (Docker / Dokploy)

The database is a single encrypted SQLite file on a persistent volume; there is
no separate database service.

### Production

```bash
docker compose up --build
```

Set in Dokploy UI or `.env`:

- `DATABASE_ENCRYPTION_KEY`: SQLCipher key (required). Generate: `openssl rand -hex 32`
- `BACKUP_ENCRYPTION_KEY`: distinct key for backups (required in production)
- `ADMIN_PATH`, `ADMIN_PASSWORD` (≥ 16 chars), `ADMIN_JWT_SECRET` (≥ 32 chars), `API_TOKEN_SECRET`
- `BASE_URL`: public URL (e.g. `https://diaetendeckel.example.de`)
- `RESEND_API_KEY`: Resend API key with send access (when `provider=resend`)
- `RESEND_FROM` / `EMAIL_FROM`: optional verified sender override
- For SMTP instead: set `EMAIL_PROVIDER=smtp` + `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`

The `data` volume holds `diaetendeckel.db`; the `backups` volume holds the hourly
encrypted snapshots. Back up the key separately from both.

### Dev / Demo

```bash
cp .env.example .env    # compose reads it; the placeholder values work for a demo
docker compose -f docker-compose.dev.yml up --build
```

This builds the encrypted SQLite database, auto-seeds 200 verified signers, and trickles a new one every 6 seconds. It uses dev defaults for `DATABASE_ENCRYPTION_KEY` / `API_TOKEN_SECRET` when they aren't set.

In all cases, the app runs `db/setup.js` on startup to ensure the schema exists. Health check at `/api/health` confirms DB connectivity.

## Scripts

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `bun run dev`      | Start dev server with watch mode + HMR            |
| `bun run start`    | Start production server                           |
| `bun run db:setup` | Apply database schema (idempotent)                |
| `bun run db:seed`  | Seed 200 demo signers + trickle new ones every 6s |
| `bun run db:migrate` | One-time migrate from Postgres (`SOURCE_DATABASE_URL`) into encrypted SQLite |
| `bun run db:restore <file\|--latest>` | Restore an encrypted backup into `DATABASE_PATH` |
| `bun run test`     | Run the test suite (`bun test`) |
| `bun run honker:build` | Build the Honker SQLite extension from source |
| `bun run og`       | Regenerate `public/og.png` from the running site |

## Backups

Hourly backups write a consistent, SQLCipher-encrypted snapshot to `BACKUP_DIR`
(default `/app/backups`), keeping `BACKUP_KEEP` hours of them (default
`privacy.backupRetentionHours`, 48). Each snapshot is produced via SQLCipher's `sqlcipher_export()` into an
ATTACHed keyed file, then gzipped (`.sqlite.gz`). Because the snapshot is itself
SQLCipher-encrypted, backups are encrypted at rest with no extra step.

Backups use `BACKUP_ENCRYPTION_KEY`, which is required in production; in
development it falls back to `DATABASE_ENCRYPTION_KEY`. **Store the key securely and separately from the backups**:
without it, a backup cannot be opened.

### Restoring a backup

```bash
# Restore the most recent backup (app stopped). Moves any existing DB aside
# to <path>.pre-restore-<timestamp> first, then verifies row counts. The
# aside copy is pruned with the backups after BACKUP_KEEP hours.
DATABASE_PATH=/app/data/diaetendeckel.db DATABASE_ENCRYPTION_KEY=… \
  bun run db:restore --latest

# Or a specific file:
bun run db:restore /app/backups/backup-2026-06-09T12-00-00.sqlite.gz
```

The restore re-keys the snapshot to `DATABASE_ENCRYPTION_KEY`, so it works even
if the backup used a separate `BACKUP_ENCRYPTION_KEY`.

A backup predates any deletion or opt-out made after it. So before replacing the
database, the restore reads its `erasure_log` (an HMAC of the address, what
happened, and when; kept `privacy.erasureLogDays`) and afterwards re-applies it
to the restored data: erased addresses are deleted again, newsletter and Treffen
opt-outs and names taken off the public list are applied again. Rows created
after the logged event are left alone.
If the old database can't be read, the restore says so loudly; then re-apply
those requests by hand before starting the app. Other edits on the settings page
(name, Kreisverband, occupation) are not logged and are lost with a restore:
the log holds no personal data to restore them from.

## Data retention

Retention periods and link lifetimes are set per letter in `privacy` of the
letter config (defaults and validation in `config/privacy.js`). The privacy
policy quotes the same values, so change them there, not in code.

| Key | Default | Enforced by |
| --- | --- | --- |
| `confirmationLinkHours` | 24 | sign-up, Treffen and deletion links expire; unconfirmed rows are swept every 5 min |
| `settingsLinkDays` | 90 | a signer's unsubscribe link can show/edit/delete data for this long after the last mail carrying it; opting out never expires. Treffen links work for as long as the registration exists |
| `emailJobRetentionHours` | 24 | queued mail jobs expire; dead-lettered mail jobs are deleted hourly after this |
| `treffenRetentionDays` | 14 | all Treffen registrations are deleted this long after the event date |
| `signerRetentionYears` | 3 | daily job deletes signatures and Treffen registrations older than this |
| `backupRetentionHours` | 48 | hourly backups (and pre-restore copies) are deleted after this; `BACKUP_KEEP` overrides it |
| `erasureLogDays` | 7 | erasures/opt-outs are kept (hashed) this long so a restore can re-apply them; must cover `backupRetentionHours` |
| `deliveryLogDays` | 30 | campaign/Treffen mailings log which address got the mail, so an interrupted send resumes without repeats; rows are deleted this long after sending, and an aborted campaign can only be retried within it |

### Ending a campaign

The privacy policy promises complete deletion when the campaign ends. Nothing
does that automatically. When the campaign is over:

1. Export anything that must be kept (aggregate numbers only, no personal data).
2. Stop the app and delete the database file (`DATABASE_PATH` plus `-wal`/`-shm`)
   and any `*.pre-restore-*` copies next to it.
3. Delete every file in `BACKUP_DIR`, and any off-site copies of it.
4. Delete any signer or Treffen lists copied out of the admin (the app has no
   export, but tables get copied into spreadsheets, mails and shared drives) and
   ask everyone who received one to do the same.
5. Delete the analytics data for the site. The mail provider deletes sent mail
   after `email.providerRetentionDays` (Resend: 30) on its own; delete it
   earlier in its dashboard if needed.
6. Note the date and what was deleted, in case someone asks.

## Durable jobs (Honker)

Background work (scheduled **campaign sends**, **zoom event mailings**, and
**hourly backups**) runs on durable [Honker](https://honker.dev) queues instead
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

## Migrating from Postgres (zero data loss)

```bash
SOURCE_DATABASE_URL=postgres://…  DATABASE_PATH=/app/data/diaetendeckel.db \
DATABASE_ENCRYPTION_KEY=…  bun run db:migrate
```

Copies every table preserving primary-key ids, converting booleans, timestamps,
and the `recipient_ids` array, then prints per-table source vs destination row
counts and aborts on any mismatch. Run it during a brief maintenance window with
the app stopped, then start the app pointed at the new file.

