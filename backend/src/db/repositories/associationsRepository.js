/**
 * Associations repository.
 * Exposes parameterized query functions for the associations table.
 */

/**
 * Find an association by ID.
 * @param {import('pg').PoolClient} client
 * @param {string} id - UUID of the association.
 * @returns {Promise<object|null>}
 */
async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM associations WHERE id = $1 LIMIT 1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Find an association by president email (case-insensitive).
 * @param {import('pg').PoolClient} client
 * @param {string} emailLower - The lowercased president email to search for.
 * @returns {Promise<object|null>}
 */
async function findByEmail(client, emailLower) {
  const result = await client.query(
    'SELECT * FROM associations WHERE president_email_lower = $1 LIMIT 1',
    [emailLower]
  );
  return result.rows[0] || null;
}

/**
 * Find an association by name (case-insensitive).
 * @param {import('pg').PoolClient} client
 * @param {string} nameLower - The lowercased name to search for.
 * @returns {Promise<object|null>}
 */
async function findByName(client, nameLower) {
  const result = await client.query(
    'SELECT * FROM associations WHERE LOWER(name) = $1 LIMIT 1',
    [nameLower]
  );
  return result.rows[0] || null;
}

/**
 * Create a new association record (legacy full create with president fields).
 * @param {import('pg').PoolClient} client
 * @param {{ name: string, logoRef: string, presidentName: string, presidentEmail: string, presidentEmailLower: string }} data
 * @returns {Promise<object>} The inserted row.
 */
async function create(client, data) {
  const { name, logoRef, presidentName, presidentEmail, presidentEmailLower } = data;
  const result = await client.query(
    `INSERT INTO associations (name, logo_ref, president_name, president_email, president_email_lower)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, logoRef, presidentName, presidentEmail, presidentEmailLower]
  );
  return result.rows[0];
}

/**
 * Create a new association registry record (name + emblem + logo, no president).
 * @param {import('pg').PoolClient} client
 * @param {{ name: string, emblem: string|null, logoRef: string }} data
 * @returns {Promise<object>} The inserted row.
 */
async function createRegistry(client, { name, emblem, logoRef }) {
  const result = await client.query(
    `INSERT INTO associations (name, emblem, logo_ref)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, emblem, logoRef]
  );
  return result.rows[0];
}

/**
 * Update an association's editable fields, including emblem.
 * President fields may be null (registry record with no manager assigned).
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @param {{ name: string, emblem: string|null, logoRef: string, presidentName: string|null, presidentEmail: string|null, presidentEmailLower: string|null }} data
 * @returns {Promise<object|null>} the updated row
 */
async function update(client, id, data) {
  const { name, emblem, logoRef, presidentName, presidentEmail, presidentEmailLower } = data;
  const result = await client.query(
    `UPDATE associations
     SET name = $1, emblem = $2, logo_ref = $3, president_name = $4, president_email = $5, president_email_lower = $6
     WHERE id = $7
     RETURNING *`,
    [name, emblem, logoRef, presidentName, presidentEmail, presidentEmailLower, id]
  );
  return result.rows[0] || null;
}

/**
 * Set the president fields on an association (when assigning a manager).
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @param {{ presidentName: string, presidentEmail: string, presidentEmailLower: string }} data
 * @returns {Promise<object|null>} the updated row
 */
async function setPresident(client, id, { presidentName, presidentEmail, presidentEmailLower }) {
  const result = await client.query(
    `UPDATE associations
     SET president_name = $2, president_email = $3, president_email_lower = $4
     WHERE id = $1
     RETURNING *`,
    [id, presidentName, presidentEmail, presidentEmailLower]
  );
  return result.rows[0] || null;
}

/**
 * Check whether an association already has an active ASSOCIATION_MANAGER.
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function hasManager(client, id) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM users u
       WHERE u.association_id = $1 AND u.role = 'ASSOCIATION_MANAGER' AND u.is_active = TRUE
     ) AS has_manager`,
    [id]
  );
  return result.rows[0] ? result.rows[0].has_manager === true : false;
}

/**
 * List all associations with a boolean flag indicating whether each has an
 * active ASSOCIATION_MANAGER.
 * @param {import('pg').PoolClient} client
 * @returns {Promise<object[]>}
 */
async function listWithManagerFlag(client) {
  const result = await client.query(
    `SELECT a.id, a.name, a.emblem, a.logo_ref, a.president_name, a.president_email, a.created_at,
            EXISTS (
              SELECT 1 FROM users u
              WHERE u.association_id = a.id AND u.role = 'ASSOCIATION_MANAGER' AND u.is_active = TRUE
            ) AS has_manager
     FROM associations a
     ORDER BY a.name ASC`
  );
  return result.rows;
}

/**
 * Hard-delete an association by ID.
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @returns {Promise<number>} rowCount
 */
async function deleteById(client, id) {
  const result = await client.query('DELETE FROM associations WHERE id = $1', [id]);
  return result.rowCount;
}

/**
 * Count elections linked to an association.
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @returns {Promise<number>}
 */
async function countElections(client, id) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS c FROM elections WHERE association_id = $1',
    [id]
  );
  return result.rows[0].c;
}

/**
 * Count users linked to an association.
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @returns {Promise<number>}
 */
async function countUsers(client, id) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS c FROM users WHERE association_id = $1',
    [id]
  );
  return result.rows[0].c;
}

module.exports = {
  findById,
  findByEmail,
  findByName,
  create,
  createRegistry,
  update,
  setPresident,
  hasManager,
  listWithManagerFlag,
  deleteById,
  countElections,
  countUsers,
};
