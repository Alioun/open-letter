CREATE TABLE IF NOT EXISTS signers (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  kreisverband       TEXT DEFAULT '',
  newsletter         BOOLEAN DEFAULT FALSE,
  show_publicly      BOOLEAN DEFAULT TRUE,
  verified           BOOLEAN DEFAULT FALSE,
  verification_token TEXT UNIQUE,
  token_expires_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE signers ADD COLUMN IF NOT EXISTS show_publicly BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_signers_verified
  ON signers (verified, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signers_created
  ON signers (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signers_token
  ON signers (verification_token)
  WHERE verification_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signers_kreisverband
  ON signers (kreisverband)
  WHERE kreisverband != '' AND verified = TRUE;

ALTER TABLE signers ADD COLUMN IF NOT EXISTS deletion_token TEXT UNIQUE;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS deletion_token_expires_at TIMESTAMPTZ;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT UNIQUE;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS unsubscribe_token_created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_signers_deletion_token
  ON signers (deletion_token)
  WHERE deletion_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signers_unsubscribe_token
  ON signers (unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signers_newsletter
  ON signers (verified, newsletter)
  WHERE verified = TRUE AND newsletter = TRUE;

CREATE TABLE IF NOT EXISTS email_templates (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  html_body    TEXT NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id              SERIAL PRIMARY KEY,
  template_id     INTEGER REFERENCES email_templates(id),
  subject         TEXT NOT NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'scheduled',
  recipient_count INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_due
  ON campaigns (status, scheduled_at);

ALTER TABLE signers ADD COLUMN IF NOT EXISTS occupation TEXT DEFAULT '';

ALTER TABLE signers ADD COLUMN IF NOT EXISTS state TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_signers_state
  ON signers (state)
  WHERE verified = TRUE AND state != '';

CREATE TABLE IF NOT EXISTS kv_state_cache (
  kreisverband  TEXT PRIMARY KEY,
  state         TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'nominatim',
  resolved_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kv_not_typo (
  canonical     TEXT NOT NULL,
  outlier       TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (canonical, outlier)
);

CREATE TABLE IF NOT EXISTS occupation_not_typo (
  canonical     TEXT NOT NULL,
  outlier       TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (canonical, outlier)
);
