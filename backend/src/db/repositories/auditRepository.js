/**
 * Audit repository.
 * Exposes parameterized query functions for the ballot_audit table.
 */

/**
 * Insert a ballot audit entry.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} client - DB connection (pool or client)
 * @param {{ user_id: string, election_id: string, outcome: 'ACCEPTED'|'REJECTED', reason?: string|null }} data
 * @returns {Promise<object>} The inserted audit row
 */
async function create(client, data) {
  const { user_id, election_id, outcome, reason } = data;
  const result = await client.query(
    `INSERT INTO ballot_audit (user_id, election_id, outcome, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [user_id, election_id, outcome, reason || null]
  );
  return result.rows[0];
}

module.exports = {
  create,
};
