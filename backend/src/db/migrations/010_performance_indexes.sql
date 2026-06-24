-- 010_performance_indexes.sql
-- Adds indexes on foreign-key columns that sit on hot read paths. PostgreSQL
-- does NOT automatically index foreign keys, so without these the planner uses
-- sequential scans once the tables grow, hurting throughput under concurrent
-- load. All are created IF NOT EXISTS so the migration is idempotent.
--
-- Note: CREATE INDEX CONCURRENTLY cannot run inside the migration transaction,
-- so plain CREATE INDEX is used. On the current data volume this is fast; for a
-- large production table, build the equivalent index concurrently out-of-band.

-- candidates(position_id): read on every position view and every tally.
CREATE INDEX IF NOT EXISTS idx_candidates_position ON candidates(position_id);

-- positions(election_id): read whenever an election's positions are listed.
CREATE INDEX IF NOT EXISTS idx_positions_election ON positions(election_id);

-- votes(candidate_id): used for per-candidate vote counts in result tallying.
CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_id);

-- users(association_id): used for per-association voter-quota counts and joins.
CREATE INDEX IF NOT EXISTS idx_users_association ON users(association_id);
