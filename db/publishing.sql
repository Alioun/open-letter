CREATE TABLE IF NOT EXISTS publications (
  revision INTEGER PRIMARY KEY,
  document TEXT NOT NULL,
  published_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publication_assets (
  hash TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_configuration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  source TEXT NOT NULL,
  active TEXT,
  candidate TEXT,
  state TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS email_attempts (
  scope TEXT PRIMARY KEY,
  profile_revision INTEGER NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  subject_hmac TEXT,
  created_at TEXT,
  updated_at TEXT NOT NULL,
  diagnostic TEXT
);
CREATE TABLE IF NOT EXISTS email_quota (
  account TEXT PRIMARY KEY,
  next_at INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER NOT NULL DEFAULT 0
);
