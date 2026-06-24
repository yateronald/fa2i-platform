-- 008_association_members.sql
-- Adds support for the association membership feature (association-only):
--  1. A join table linking associations to their member users.
--  2. A per-user flag granting permission to manage an association's members.

-- Membership link: a user belongs to an association's member roster.
CREATE TABLE IF NOT EXISTS association_members (
  association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (association_id, user_id)
);

-- Per-user permission flag: may this user manage their association's members?
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_members BOOLEAN NOT NULL DEFAULT FALSE;
