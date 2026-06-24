-- 011_user_phone.sql
-- Adds an optional phone number to user accounts. Used by the association
-- member roster ("Ajouter un membre" → phone field). Nullable so existing
-- accounts and flows that don't collect a phone (CSV import, federation users)
-- are unaffected.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT;
