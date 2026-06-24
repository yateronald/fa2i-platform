-- 012_password_reset_codes.sql
-- Supports the "forgot password" flow. A short numeric code is emailed to the
-- user; only a HASH of the code is stored (never the plaintext). Codes expire,
-- are single-use (consumed_at), and have a per-code attempt counter to thwart
-- guessing. Works for any account type (members, association users, federation
-- users) since it references the shared users table.

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup of a user's most recent / active codes.
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user ON password_reset_codes(user_id);
