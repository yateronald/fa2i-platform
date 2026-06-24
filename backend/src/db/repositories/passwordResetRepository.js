'use strict';

/**
 * Password reset codes repository.
 * Parameterized queries for the password_reset_codes table.
 *
 * Only a HASH of the code is ever stored. Codes are single-use (consumed_at),
 * time-limited (expires_at) and attempt-limited (attempts).
 */

/**
 * Invalidate all of a user's currently-active (unconsumed) reset codes by
 * marking them consumed. Called before issuing a fresh code so only the latest
 * code is ever valid.
 * @param {import('pg').PoolClient} client
 * @param {string} userId
 * @returns {Promise<number>} number of rows invalidated
 */
async function invalidateActiveForUser(client, userId) {
  const result = await client.query(
    `UPDATE password_reset_codes
     SET consumed_at = now()
     WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId]
  );
  return result.rowCount;
}

/**
 * Insert a new reset code record.
 * @param {import('pg').PoolClient} client
 * @param {{ userId: string, codeHash: string, expiresAt: Date|string }} data
 * @returns {Promise<object>} the inserted row
 */
async function create(client, data) {
  const { userId, codeHash, expiresAt } = data;
  const result = await client.query(
    `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, codeHash, expiresAt]
  );
  return result.rows[0];
}

/**
 * Find a user's latest active code: unconsumed and not expired.
 * @param {import('pg').PoolClient} client
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function findLatestActiveByUser(client, userId) {
  const result = await client.query(
    `SELECT * FROM password_reset_codes
     WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Increment the attempt counter for a code (on a wrong guess).
 * @param {import('pg').PoolClient} client
 * @param {string|number} id
 * @returns {Promise<number>} the new attempts value
 */
async function incrementAttempts(client, id) {
  const result = await client.query(
    `UPDATE password_reset_codes
     SET attempts = attempts + 1
     WHERE id = $1
     RETURNING attempts`,
    [id]
  );
  return result.rows[0] ? result.rows[0].attempts : 0;
}

/**
 * Mark a code as consumed (single-use).
 * @param {import('pg').PoolClient} client
 * @param {string|number} id
 * @returns {Promise<void>}
 */
async function consume(client, id) {
  await client.query(
    `UPDATE password_reset_codes SET consumed_at = now() WHERE id = $1`,
    [id]
  );
}

module.exports = {
  invalidateActiveForUser,
  create,
  findLatestActiveByUser,
  incrementAttempts,
  consume,
};
