'use strict';

/**
 * Positions repository.
 * Exposes parameterized query functions for the positions table.
 */

/**
 * Find a position by its ID.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} id - UUID
 * @returns {Promise<object|null>}
 */
async function findById(client, id) {
  const { rows } = await client.query(
    'SELECT id, election_id, name, start_at, end_at, schedule_timezone, published FROM positions WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/**
 * Find all positions for an election.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} electionId - UUID
 * @returns {Promise<object[]>}
 */
async function findByElection(client, electionId) {
  const { rows } = await client.query(
    'SELECT id, election_id, name, start_at, end_at, schedule_timezone, published FROM positions WHERE election_id = $1',
    [electionId]
  );
  return rows;
}

/**
 * Create a new position record.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {{ election_id: string, name: string, start_at?: string, end_at?: string, schedule_timezone?: string }} positionData
 * @returns {Promise<{ id: string, election_id: string, name: string, start_at: string, end_at: string, schedule_timezone: string }>}
 */
async function create(client, positionData) {
  const { election_id, name, start_at = null, end_at = null, schedule_timezone = null } = positionData;
  const { rows } = await client.query(
    `INSERT INTO positions (election_id, name, start_at, end_at, schedule_timezone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, election_id, name, start_at, end_at, schedule_timezone`,
    [election_id, name, start_at, end_at, schedule_timezone]
  );
  return rows[0];
}

/**
 * Count the number of positions for a given election.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} electionId - UUID
 * @returns {Promise<number>}
 */
async function countByElection(client, electionId) {
  const { rows } = await client.query(
    'SELECT COUNT(*)::int AS count FROM positions WHERE election_id = $1',
    [electionId]
  );
  return rows[0].count;
}

/**
 * Publish a position: set its voting window and mark it published.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} id - UUID of the position to publish.
 * @param {{ start_at: string, end_at: string, schedule_timezone?: string|null }} windowData
 * @returns {Promise<{ id: string, election_id: string, name: string, start_at: string, end_at: string, schedule_timezone: string, published: boolean }>}
 */
async function publish(client, id, { start_at, end_at, schedule_timezone = null }) {
  const { rows } = await client.query(
    `UPDATE positions
     SET start_at = $2, end_at = $3, schedule_timezone = $4, published = TRUE
     WHERE id = $1
     RETURNING id, election_id, name, start_at, end_at, schedule_timezone, published`,
    [id, start_at, end_at, schedule_timezone]
  );
  return rows[0];
}

module.exports = {
  findById,
  findByElection,
  create,
  countByElection,
  publish,
};
