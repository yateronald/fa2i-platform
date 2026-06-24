-- 006_association_users.sql
-- Adds support for association sub-users:
--  1. A new ASSOCIATION_ELECTION_MANAGER role on users.role.
--  2. A per-user flag granting permission to add voters to federation elections.

-- Allow the new ASSOCIATION_ELECTION_MANAGER role on users.role.
-- Mirrors the drop/re-add pattern from migration 002.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('FEDERATION_ADMINISTRATOR','ASSOCIATION_MANAGER','VOTER','FEDERATION_ELECTION_MANAGER','ASSOCIATION_ELECTION_MANAGER'));

-- Per-user permission flag: may this user add voters to federation elections?
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_add_federation_voters BOOLEAN NOT NULL DEFAULT FALSE;
