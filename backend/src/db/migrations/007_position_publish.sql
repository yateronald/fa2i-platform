-- Add a publish flag to positions to support the DRAFT -> PUBLISH workflow.
-- A position starts as a DRAFT (published = FALSE, no voting window) and becomes
-- votable only once it is published with a concrete voting window.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill existing positions so previously created posts keep working: any
-- position that already has a voting window is treated as published.
UPDATE positions SET published = TRUE WHERE start_at IS NOT NULL AND end_at IS NOT NULL;
