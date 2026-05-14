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
