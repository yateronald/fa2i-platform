ALTER TABLE positions ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS schedule_timezone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
CREATE TABLE IF NOT EXISTS voter_voted_position (
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (position_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_vvp_election ON voter_voted_position(election_id);
