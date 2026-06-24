'use strict';

/**
 * Candidates repository.
 * Exposes parameterized query functions for the candidates table.
 */

async function findById(client, id) {
  const result = await client.query(
    'SELECT id, position_id, name, photo_ref, motivation, created_by FROM candidates WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function findByPosition(client, positionId) {
  const result = await client.query(
    'SELECT id, position_id, name, photo_ref, motivation, created_by FROM candidates WHERE position_id = $1',
    [positionId]
  );
  return result.rows;
}

/**
 * Find all candidates for a set of positions in a single query.
 * Used to avoid N+1 fetches when loading an election's positions with their
 * candidates.
 * @param {import('pg').PoolClient | import('pg').Pool} client
 * @param {string[]} positionIds
 * @returns {Promise<object[]>} Candidates across all given positions.
 */
async function findByPositions(client, positionIds) {
  if (!Array.isArray(positionIds) || positionIds.length === 0) {
    return [];
  }
  const result = await client.query(
    'SELECT id, position_id, name, photo_ref, motivation, created_by FROM candidates WHERE position_id = ANY($1)',
    [positionIds]
  );
  return result.rows;
}

/**
 * Create a candidate record.
 * @param {import('pg').PoolClient | import('pg').Pool} client
 * @param {{ position_id: string, name: string, photo_ref: string, motivation: string, created_by?: string|null }} data
 * @returns {Promise<{ id: string, position_id: string, name: string, photo_ref: string, motivation: string, created_by: string|null }>}
 */
async function create(client, data) {
  const result = await client.query(
    `INSERT INTO candidates (position_id, name, photo_ref, motivation, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, position_id, name, photo_ref, motivation, created_by`,
    [data.position_id, data.name, data.photo_ref, data.motivation, data.created_by || null]
  );
  return result.rows[0];
}

/**
 * Update mutable fields of a candidate. Only provided fields are changed.
 * @param {import('pg').PoolClient | import('pg').Pool} client
 * @param {string} id
 * @param {{ name?: string, motivation?: string, photo_ref?: string }} fields
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
  if (fields.motivation !== undefined) {
    sets.push(`motivation = $${i++}`);
    values.push(fields.motivation);
  }
  if (fields.photo_ref !== undefined) {
    sets.push(`photo_ref = $${i++}`);
    values.push(fields.photo_ref);
  }

  if (sets.length === 0) {
    return findById(client, id);
  }

  values.push(id);
  const result = await client.query(
    `UPDATE candidates SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, position_id, name, photo_ref, motivation, created_by`,
    values
  );
  return result.rows[0] || null;
}

/**
 * Delete a candidate by ID.
 * @param {import('pg').PoolClient | import('pg').Pool} client
 * @param {string} id
 * @returns {Promise<boolean>} True if a row was deleted.
 */
async function remove(client, id) {
  const result = await client.query('DELETE FROM candidates WHERE id = $1', [id]);
  return result.rowCount > 0;
}

/**
 * Count the number of candidates for a given position.
 * @param {import('pg').PoolClient | import('pg').Pool} client
 * @param {string} positionId
 * @returns {Promise<number>}
 */
async function countByPosition(client, positionId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM candidates WHERE position_id = $1',
    [positionId]
  );
  return result.rows[0].count;
}

module.exports = {
  findById,
  findByPosition,
  findByPositions,
  create,
  update,
  remove,
  countByPosition,
};
