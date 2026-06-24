/**
 * Association members repository.
 * Exposes parameterized query functions for the association_members join table.
 *
 * A membership links a user to an association's member roster. The same user
 * may appear in multiple associations' rosters; the composite primary key
 * (association_id, user_id) prevents duplicate links within one association.
 */

/**
 * Link a user to an association's member roster.
 * Idempotent: a duplicate link is silently ignored (ON CONFLICT DO NOTHING).
 * @param {import('pg').PoolClient} client
 * @param {string} associationId
 * @param {string} userId
 * @returns {Promise<object|null>} The inserted row, or null when it already existed.
 */
async function addMembership(client, associationId, userId) {
  const result = await client.query(
    `INSERT INTO association_members (association_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [associationId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Check whether a user is already a member of an association.
 * @param {import('pg').PoolClient} client
 * @param {string} associationId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function findMembership(client, associationId, userId) {
  const result = await client.query(
    'SELECT 1 FROM association_members WHERE association_id = $1 AND user_id = $2 LIMIT 1',
    [associationId, userId]
  );
  return result.rowCount > 0;
}

/**
 * List an association's members joined with their user account details.
 * @param {import('pg').PoolClient} client
 * @param {string} associationId
 * @returns {Promise<object[]>} Rows of { user_id, email, full_name, is_active, is_temporary_password, added_at }.
 */
async function listByAssociation(client, associationId) {
  const result = await client.query(
    `SELECT u.id AS user_id, u.email, u.full_name, u.phone, u.is_active, u.is_temporary_password, m.added_at
     FROM association_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.association_id = $1
     ORDER BY m.added_at DESC`,
    [associationId]
  );
  return result.rows;
}

/**
 * List the user ids of an association's members.
 * @param {import('pg').PoolClient} client
 * @param {string} associationId
 * @returns {Promise<string[]>}
 */
async function listUserIds(client, associationId) {
  const result = await client.query(
    'SELECT user_id FROM association_members WHERE association_id = $1',
    [associationId]
  );
  return result.rows.map((r) => r.user_id);
}

/**
 * List the user ids of an association's ACTIVE members only.
 * Joins to the users table and filters on is_active = TRUE so that disabled
 * members are excluded (e.g. when resolving members eligible to be added to an
 * election).
 * @param {import('pg').PoolClient} client
 * @param {string} associationId
 * @returns {Promise<string[]>}
 */
async function listActiveUserIds(client, associationId) {
  const result = await client.query(
    `SELECT m.user_id
     FROM association_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.association_id = $1 AND u.is_active = TRUE`,
    [associationId]
  );
  return result.rows.map((r) => r.user_id);
}

/**
 * Remove a user from an association's member roster.
 * Does NOT delete the underlying user account — only the membership link.
 * @param {import('pg').PoolClient} client
 * @param {string} associationId
 * @param {string} userId
 * @returns {Promise<object|null>} The deleted row, or null when no link existed.
 */
async function removeMembership(client, associationId, userId) {
  const result = await client.query(
    `DELETE FROM association_members
     WHERE association_id = $1 AND user_id = $2
     RETURNING *`,
    [associationId, userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  addMembership,
  findMembership,
  listByAssociation,
  listUserIds,
  listActiveUserIds,
  removeMembership,
};
