-- 005_association_registry.sql
-- Association becomes a registry record: super admin creates name + emblem + logo,
-- with NO president initially. President/manager fields become optional and are
-- populated in a separate "assign manager" step.

ALTER TABLE associations ADD COLUMN IF NOT EXISTS emblem TEXT;
ALTER TABLE associations ALTER COLUMN president_name DROP NOT NULL;
ALTER TABLE associations ALTER COLUMN president_email DROP NOT NULL;
ALTER TABLE associations ALTER COLUMN president_email_lower DROP NOT NULL;
ALTER TABLE elections ADD COLUMN IF NOT EXISTS voters_per_association INTEGER;
