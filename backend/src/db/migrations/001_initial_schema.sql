-- =============================================================================
-- FA2I Voting System - Initial Schema Migration
-- =============================================================================
-- Creates the complete database schema for the FA2I secure voting platform.
-- All temporal columns use TIMESTAMPTZ to store absolute instants with offset.
-- Designed for PostgreSQL 13+ (gen_random_uuid() is built-in).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Associations
-- ----------------------------------------------------------------------------
CREATE TABLE associations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  logo_ref        TEXT NOT NULL,
  president_name  TEXT NOT NULL CHECK (char_length(president_name) BETWEEN 1 AND 200),
  president_email TEXT NOT NULL CHECK (char_length(president_email) BETWEEN 1 AND 254),
  president_email_lower TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Users (all roles: FEDERATION_ADMINISTRATOR, ASSOCIATION_MANAGER, VOTER)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL,
  email_lower           TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('FEDERATION_ADMINISTRATOR','ASSOCIATION_MANAGER','VOTER')),
  association_id        UUID REFERENCES associations(id),
  is_temporary_password BOOLEAN NOT NULL DEFAULT TRUE,
  temp_password_set_at  TIMESTAMPTZ,
  failed_login_count    INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_activity_at      TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email_lower, association_id)
);

-- ----------------------------------------------------------------------------
-- Elections (federation or association scope)
-- CHECK: start must precede end (Req 11.5, 12.6)
-- CHECK: association_id required iff scope = 'ASSOCIATION'
-- ----------------------------------------------------------------------------
CREATE TABLE elections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  scope          TEXT NOT NULL CHECK (scope IN ('FEDERATION','ASSOCIATION')),
  association_id UUID REFERENCES associations(id),
  start_at       TIMESTAMPTZ NOT NULL,
  end_at         TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_at < end_at),
  CHECK ((scope = 'ASSOCIATION') = (association_id IS NOT NULL))
);

-- ----------------------------------------------------------------------------
-- Federation election participating associations (Req 7.2, 7.6)
-- Composite PK prevents duplicate association per election
-- ----------------------------------------------------------------------------
CREATE TABLE federation_election_associations (
  election_id    UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  association_id UUID NOT NULL REFERENCES associations(id),
  PRIMARY KEY (election_id, association_id)
);

-- ----------------------------------------------------------------------------
-- Positions within an election
-- ----------------------------------------------------------------------------
CREATE TABLE positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) >= 1)
);

-- ----------------------------------------------------------------------------
-- Candidates for a position
-- ----------------------------------------------------------------------------
CREATE TABLE candidates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  photo_ref   TEXT NOT NULL,
  motivation  TEXT NOT NULL CHECK (char_length(motivation) BETWEEN 1 AND 1000)
);

-- ----------------------------------------------------------------------------
-- Participants: users eligible to vote in a given election (Req 13.5)
-- ----------------------------------------------------------------------------
CREATE TABLE participants (
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (election_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Voter-voted marker: the one-vote-per-voter integrity anchor (Req 15.1, 15.4)
-- PK on (election_id, user_id) guarantees exactly one ballot per voter
-- ----------------------------------------------------------------------------
CREATE TABLE voter_voted (
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (election_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Votes: anonymous ballot selections - NO user_id column (Req 15.5)
-- Index on position_id for efficient per-position tallies
-- ----------------------------------------------------------------------------
CREATE TABLE votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id  UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id  UUID NOT NULL REFERENCES positions(id),
  candidate_id UUID NOT NULL REFERENCES candidates(id),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_votes_position ON votes(position_id);

-- ----------------------------------------------------------------------------
-- Ballot audit: every submission attempt logged (Req 15.6)
-- ----------------------------------------------------------------------------
CREATE TABLE ballot_audit (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  election_id  UUID NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED')),
  reason       TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Email delivery log: tracks credential email delivery (Req 3.5)
-- ----------------------------------------------------------------------------
CREATE TABLE email_delivery_log (
  id             BIGSERIAL PRIMARY KEY,
  account_holder TEXT NOT NULL,
  identifier     TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('SENT','FAILED')),
  attempts       INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
