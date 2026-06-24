/**
 * Participants repository.
 * Exposes parameterized query functions for the participants table.
 */

/**
 * Find a participant by election ID and user ID.
 * @param {import('pg').PoolClient} client
 * @param {string} electionId
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function findByElectionAndUser(client, electionId, userId) {
  const result = await client.query(
    'SELECT * FROM participants WHERE election_id = $1 AND user_id = $2 LIMIT 1',
    [electionId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Create a participant record.
 * @param {import('pg').PoolClient} client
 * @param {{ election_id: string, user_id: string }} participantData
 * @returns {Promise<object>} The inserted row.
 */
async function create(client, participantData) {
  const { election_id, user_id } = participantData;
  const result = await client.query(
    'INSERT INTO participants (election_id, user_id) VALUES ($1, $2) RETURNING *',
    [election_id, user_id]
  );
  return result.rows[0];
}

/**
 * Remove a participant (voter) from an election.
 * Only the join row is deleted; the underlying user account is preserved.
 * @param {import('pg').PoolClient} client
 * @param {string} electionId
 * @param {string} userId
 * @returns {Promise<boolean>} True if a participant row was removed.
 */
async function remove(client, electionId, userId) {
  const result = await client.query(
    'DELETE FROM participants WHERE election_id = $1 AND user_id = $2',
    [electionId, userId]
  );
  return result.rowCount > 0;
}

/**
 * Find all participants for an election.
 * @param {import('pg').PoolClient} client
 * @param {string} electionId
 * @returns {Promise<object[]>}
 */
async function findByElection(client, electionId) {
  const result = await client.query(
    'SELECT * FROM participants WHERE election_id = $1',
    [electionId]
  );
  return result.rows;
}

/**
 * Find a participant in an election by the participant's (case-insensitive) email.
 * Used to block duplicate emails within a single election.
 * @param {import('pg').PoolClient} client
 * @param {string} electionId
 * @param {string} emailLower - The lowercased email to look up.
 * @returns {Promise<object|null>} A row with user_id, or null.
 */
async function findByEmailInElection(client, electionId, emailLower) {
  const result = await client.query(
    `SELECT p.user_id FROM participants p JOIN users u ON u.id = p.user_id
     WHERE p.election_id = $1 AND u.email_lower = $2 LIMIT 1`,
    [electionId, emailLower]
  );
  return result.rows[0] || null;
}

/**
 * Count the participants of an election that belong to a given association.
 * Used to enforce per-association voter quotas on federation elections.
 * @param {import('pg').PoolClient} client
 * @param {string} electionId
 * @param {string} associationId
 * @returns {Promise<number>} The participant count for that association.
 */
async function countByElectionAndAssociation(client, electionId, associationId) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS c FROM participants p JOIN users u ON u.id = p.user_id
     WHERE p.election_id = $1 AND u.association_id = $2`,
    [electionId, associationId]
  );
  return result.rows[0] ? result.rows[0].c : 0;
}

module.exports = {
  findByElectionAndUser,
  create,
  remove,
  findByElection,
  findByEmailInElection,
  countByElectionAndAssociation,
};
