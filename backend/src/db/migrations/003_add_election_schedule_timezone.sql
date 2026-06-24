-- Store the IANA timezone the schedule was entered in (for unambiguous display)
ALTER TABLE elections ADD COLUMN IF NOT EXISTS schedule_timezone TEXT;
