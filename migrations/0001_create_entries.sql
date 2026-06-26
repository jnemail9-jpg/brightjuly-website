-- Competition entries for Bright July.
CREATE TABLE IF NOT EXISTS entries (
  id                TEXT PRIMARY KEY,             -- uuid
  created_at        TEXT NOT NULL,                -- ISO 8601
  parent_name       TEXT NOT NULL,
  email             TEXT NOT NULL,
  squad_name        TEXT NOT NULL,
  participants      INTEGER,
  pledge            TEXT,
  platform          TEXT NOT NULL,
  post_url          TEXT,
  story             TEXT NOT NULL,
  postcode          TEXT,
  photo_key         TEXT,                         -- R2 object key (added in a later increment)
  consent_promo     INTEGER NOT NULL DEFAULT 0,   -- 0/1
  consent_terms     INTEGER NOT NULL DEFAULT 0,   -- 0/1
  consent_marketing INTEGER NOT NULL DEFAULT 0,   -- 0/1
  status            TEXT NOT NULL DEFAULT 'new',  -- new | shortlisted | winner | rejected …
  ip                TEXT,
  country           TEXT,
  user_agent        TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_email ON entries(email);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at);
