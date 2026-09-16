-- SQLite (SQLCipher) schema for diaetendeckel.
--
-- Notes on the Postgres → SQLite translation:
--   SERIAL PRIMARY KEY      -> INTEGER PRIMARY KEY AUTOINCREMENT
--   BOOLEAN                 -> INTEGER (0/1)
--   TIMESTAMPTZ             -> TEXT (ISO-8601 UTC, e.g. 2026-06-09T12:34:56.789Z)
--   DEFAULT NOW()           -> DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
--   INTEGER[] (arrays)      -> TEXT holding a JSON array (or NULL)
-- The strftime default is chosen so DB-generated timestamps share the exact
-- same format as JavaScript `new Date().toISOString()`, keeping lexicographic
-- comparisons (`created_at > ?`) correct.
--
-- SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so every column lives in
-- the consolidated CREATE TABLE below. `CREATE TABLE/INDEX IF NOT EXISTS` keeps
-- the file idempotent across restarts.

CREATE TABLE IF NOT EXISTS signers (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  name                          TEXT NOT NULL,
  email                         TEXT NOT NULL UNIQUE,
  kreisverband                  TEXT DEFAULT '',
  occupation                    TEXT DEFAULT '',
  state                         TEXT DEFAULT '',
  newsletter                    INTEGER NOT NULL DEFAULT 0,
  show_publicly                 INTEGER NOT NULL DEFAULT 1,
  verified                      INTEGER NOT NULL DEFAULT 0,
  verification_token            TEXT UNIQUE,
  token_expires_at              TEXT,
  deletion_token                TEXT UNIQUE,
  deletion_token_expires_at     TEXT,
  unsubscribe_token             TEXT UNIQUE,
  unsubscribe_token_created_at  TEXT,
  created_at                    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_signers_verified
  ON signers (verified, created_at DESC);

-- Every public read filters on `verified = 1 AND show_publicly = 1` and then
-- needs one more column. Without that column in the index SQLite walks the
-- index and fetches each matching row from the table for it — at 100k signers
-- that per-row fetch, not the aggregation, was the entire cost: the signer
-- list's COUNT(*) took 632ms, the three GROUP BY endpoints ~710ms each, and
-- the search scan 664ms. Covering the column each one reads brings them to
-- 8ms, 5-36ms and 27ms respectively, for about 6 MB of index per 100k signers.
--
-- Keep these aligned with the queries in server/db.js: if a public read starts
-- reading another column, it needs to be in the matching index or the fetch
-- comes back.

-- /api/signers: count + the created_at-ordered page.
CREATE INDEX IF NOT EXISTS idx_signers_public
  ON signers (verified, show_publicly, created_at);

-- /api/kreisverband-stats and /api/state-stats (GROUP BY kreisverband, state).
CREATE INDEX IF NOT EXISTS idx_signers_public_kv
  ON signers (verified, show_publicly, kreisverband, state);

-- /api/occupations (GROUP BY occupation).
CREATE INDEX IF NOT EXISTS idx_signers_public_occ
  ON signers (verified, show_publicly, occupation);

-- /api/signers?search= — the LIKE scan can't use an index to seek, but keeping
-- name and kreisverband in one makes it an index-only scan instead of 95k
-- row fetches.
CREATE INDEX IF NOT EXISTS idx_signers_public_name
  ON signers (verified, show_publicly, name, kreisverband);

CREATE INDEX IF NOT EXISTS idx_signers_created
  ON signers (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signers_token
  ON signers (verification_token)
  WHERE verification_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signers_kreisverband
  ON signers (kreisverband)
  WHERE kreisverband != '' AND verified = 1;

CREATE INDEX IF NOT EXISTS idx_signers_deletion_token
  ON signers (deletion_token)
  WHERE deletion_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signers_unsubscribe_token
  ON signers (unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signers_newsletter
  ON signers (verified, newsletter)
  WHERE verified = 1 AND newsletter = 1;

CREATE INDEX IF NOT EXISTS idx_signers_state
  ON signers (state)
  WHERE verified = 1 AND state != '';

CREATE TABLE IF NOT EXISTS email_templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  html_body    TEXT NOT NULL,
  updated_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id     INTEGER REFERENCES email_templates(id),
  subject         TEXT NOT NULL,
  scheduled_at    TEXT NOT NULL,
  sent_at         TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled',
  recipient_count INTEGER,
  audience        TEXT NOT NULL DEFAULT 'newsletter',
  sent_offset     INTEGER NOT NULL DEFAULT 0,
  -- Hand-picked recipient list for audience = 'selection'; JSON array or NULL.
  recipient_ids   TEXT,
  created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_due
  ON campaigns (status, scheduled_at);

CREATE TABLE IF NOT EXISTS zoom_registrations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  kreisverband      TEXT DEFAULT '',
  delegierter       INTEGER NOT NULL DEFAULT 0,
  unsubscribe_token TEXT UNIQUE,
  created_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_zoom_reg_created
  ON zoom_registrations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zoom_reg_unsub
  ON zoom_registrations (unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;

-- Treffen sign-ups from the public form that haven't clicked the confirmation
-- link yet. Only confirmed rows move to zoom_registrations, which is what every
-- Treffen mailing reads. Unconfirmed rows are deleted once the link expires.
CREATE TABLE IF NOT EXISTS zoom_pending (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  kreisverband  TEXT DEFAULT '',
  delegierter   INTEGER NOT NULL DEFAULT 0,
  token         TEXT NOT NULL UNIQUE,
  expires_at    TEXT NOT NULL,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Erasures and opt-outs of the last privacy.erasureLogDays, keyed by an HMAC of
-- the email address. db/restore-backup.js re-applies them after restoring a
-- backup, which would otherwise bring the data back. See db/erasure-log.js.
CREATE TABLE IF NOT EXISTS erasure_log (
  email_hmac  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  at          TEXT NOT NULL,
  PRIMARY KEY (email_hmac, kind)
);

-- Pending "delete my data" requests from the privacy-policy form. Keyed by
-- email, not by signer, so an address that only registered for the Treffen can
-- be erased too. Rows live for the 24h link validity and are removed on use.
CREATE TABLE IF NOT EXISTS deletion_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS zoom_event_mailings (
  kind            TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'sending',
  recipient_count INTEGER,
  sent_at         TEXT,
  updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS kv_state_cache (
  kreisverband  TEXT PRIMARY KEY,
  state         TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'nominatim',
  resolved_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS kv_not_typo (
  canonical     TEXT NOT NULL,
  outlier       TEXT NOT NULL,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (canonical, outlier)
);

CREATE TABLE IF NOT EXISTS occupation_not_typo (
  canonical     TEXT NOT NULL,
  outlier       TEXT NOT NULL,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (canonical, outlier)
);
