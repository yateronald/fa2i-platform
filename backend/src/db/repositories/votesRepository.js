'use strict';

/**
 * Votes repository.
 * Exposes parameterized query functions for the votes table.
 */

/**
 * Create a vote record (anonymous — no user_id column).
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {{ election_id: string, position_id: string, candidate_id: string }} voteData
 * @returns {Promise<object>} The inserted row.
 */
async function create(client, voteData) {
  const { election_id, position_id, candidate_id } = voteData;
  const result = await client.query(
    `INSERT INTO votes (election_id, position_id, candidate_id)
     VALUES ($1, $2, $3)
     RETURNING id, election_id, position_id, candidate_id, recorded_at`,
    [election_id, position_id, candidate_id]
  );
  return result.rows[0];
}

/**
 * Count total votes for a given position.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} positionId - UUID
 * @returns {Promise<number>}
 */
async function countByPosition(client, positionId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM votes WHERE position_id = $1',
    [positionId]
  );
  return result.rows[0].count;
}

/**
 * Count votes for a specific candidate.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} candidateId - UUID
 * @returns {Promise<number>}
 */
async function countByCandidate(client, candidateId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM votes WHERE candidate_id = $1',
    [candidateId]
  );
  return result.rows[0].count;
}

/**
 * Get per-candidate vote counts for a given position.
 * Returns an array of { candidate_id, count } for all candidates that received votes.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} positionId - UUID
 * @returns {Promise<Array<{ candidate_id: string, count: number }>>}
 */
async function getCandidateCountsByPosition(client, positionId) {
  const result = await client.query(
    `SELECT candidate_id, COUNT(*)::int AS count
     FROM votes
     WHERE position_id = $1
     GROUP BY candidate_id`,
    [positionId]
  );
  return result.rows;
}

/**
 * Count the number of voters who cast a vote for a given position.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} positionId - UUID
 * @returns {Promise<number>}
 */
async function countVotersByPosition(client, positionId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM voter_voted_position WHERE position_id = $1',
    [positionId]
  );
  return result.rows[0].count;
}

/**
 * Count the number of distinct voters who cast at least one vote in a given election.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} electionId - UUID
 * @returns {Promise<number>}
 */
async function countVotersByElection(client, electionId) {
  const result = await client.query(
    'SELECT COUNT(DISTINCT user_id)::int AS count FROM voter_voted_position WHERE election_id = $1',
    [electionId]
  );
  return result.rows[0].count;
}

module.exports = {
  create,
  countByPosition,
  countByCandidate,
  getCandidateCountsByPosition,
  countVotersByPosition,
  countVotersByElection,
};
