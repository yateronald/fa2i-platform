/**
 * Elections repository.
 * Exposes parameterized query functions for the elections table.
 */

/**
 * Find an election by its ID.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} id - UUID
 * @returns {Promise<object|null>}
 */
async function findById(client, id) {
  const { rows } = await client.query(
    'SELECT id, name, scope, association_id, start_at, end_at, schedule_timezone, voters_per_association, created_by, created_at FROM elections WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/**
 * Create a new election record.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {{ name: string, scope: string, association_id: string|null, start_at: string, end_at: string, schedule_timezone?: string|null, voters_per_association?: number|null, created_by?: string|null }} electionData
 * @returns {Promise<{ id: string, name: string, scope: string, association_id: string|null, start_at: Date, end_at: Date, schedule_timezone: string|null, voters_per_association: number|null, created_by: string|null }>}
 */
async function create(client, electionData) {
  const { name, scope, association_id, start_at, end_at, schedule_timezone, voters_per_association, created_by } = electionData;
  const { rows } = await client.query(
    `INSERT INTO elections (name, scope, association_id, start_at, end_at, schedule_timezone, voters_per_association, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, scope, association_id, start_at, end_at, schedule_timezone, voters_per_association, created_by`,
    [
      name,
      scope,
      association_id || null,
      start_at,
      end_at,
      schedule_timezone || null,
      voters_per_association == null ? null : voters_per_association,
      created_by || null,
    ]
  );
  return rows[0];
}

/**
 * Update mutable fields of an election. Only the provided fields are changed.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} id - UUID
 * @param {{ name?: string, start_at?: string, end_at?: string, schedule_timezone?: string|null, voters_per_association?: number|null }} fields
 * @returns {Promise<object|null>} The updated row, or null if not found.
 */
async function update(client, id, fields) {
  const sets = [];
  const values = [];
  let i = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(fields.name);
  }
  if (fields.start_at !== undefined) {
    sets.push(`start_at = $${i++}`);
    values.push(fields.start_at);
  }
  if (fields.end_at !== undefined) {
    sets.push(`end_at = $${i++}`);
    values.push(fields.end_at);
  }
  if (fields.schedule_timezone !== undefined) {
    sets.push(`schedule_timezone = $${i++}`);
    values.push(fields.schedule_timezone);
  }
  if (fields.voters_per_association !== undefined) {
    sets.push(`voters_per_association = $${i++}`);
    values.push(fields.voters_per_association);
  }

  if (sets.length === 0) {
    return findById(client, id);
  }

  values.push(id);
  const { rows } = await client.query(
    `UPDATE elections SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, name, scope, association_id, start_at, end_at, schedule_timezone, voters_per_association, created_by, created_at`,
    values
  );
  return rows[0] || null;
}

/**
 * Delete an election by ID. Related positions, candidates, participants and
 * votes are removed via ON DELETE CASCADE foreign keys.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} id - UUID
 * @returns {Promise<boolean>} True if a row was deleted.
 */
async function remove(client, id) {
  const { rowCount } = await client.query('DELETE FROM elections WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * Find elections belonging to a specific association.
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} associationId - UUID
 * @returns {Promise<object[]>}
 */
async function findByAssociation(client, associationId) {
  const { rows } = await client.query(
    'SELECT id, name, scope, association_id, start_at, end_at, schedule_timezone, voters_per_association, created_by, created_at FROM elections WHERE association_id = $1',
    [associationId]
  );
  return rows;
}

module.exports = {
  findById,
  create,
  update,
  remove,
  findByAssociation,
};
