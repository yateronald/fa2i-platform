-- 009_creator_ownership.sql
-- Adds creator-ownership tracking so that only the user who CREATED an election
-- or a candidate may later modify or delete it (even other users with the same
-- role are not allowed). Applies to both federation and association elections.
--
-- Legacy rows created before this migration have created_by = NULL; the
-- application falls back to role-based authorization for those rows so they are
-- not orphaned.

-- Who created the election (NULL for pre-existing rows).
ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- Who created the candidate (NULL for pre-existing rows).
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
