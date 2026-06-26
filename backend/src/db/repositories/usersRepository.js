/**
 * Users repository.
 * Exposes parameterized query functions for the users table.
 */

async function findByEmail(client, emailLower) {
  const result = await client.query(
    'SELECT * FROM users WHERE email_lower = $1 AND is_active = TRUE LIMIT 1',
    [emailLower]
  );
  return result.rows[0] || null;
}

/**
 * Find a user by normalized email and association ID.
 * @param {import('pg').PoolClient} client
 * @param {string} emailLower - Normalized (lowercased) email.
 * @param {string} associationId - The association to scope the lookup to.
 * @returns {Promise<object|null>}
 */
async function findByEmailAndAssociation(client, emailLower, associationId) {
  const result = await client.query(
    'SELECT * FROM users WHERE email_lower = $1 AND association_id = $2 AND is_active = TRUE LIMIT 1',
    [emailLower, associationId]
  );
  return result.rows[0] || null;
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Check if any user with the given role exists.
 * @param {import('pg').PoolClient} client
 * @param {string} role - e.g. 'FEDERATION_ADMINISTRATOR'
 * @returns {Promise<boolean>}
 */
async function existsByRole(client, role) {
  const result = await client.query(
    'SELECT 1 FROM users WHERE role = $1 AND is_active = TRUE LIMIT 1',
    [role]
  );
  return result.rowCount > 0;
}

/**
 * Create a new user record.
 * @param {import('pg').PoolClient} client
 * @param {{ email: string, emailLower: string, passwordHash: string, role: string, associationId: string|null, fullName?: string|null, canAddFederationVoters?: boolean, canManageMembers?: boolean }} userData
 * @returns {Promise<object>} The inserted row.
 */
async function create(client, userData) {
  const {
    email,
    emailLower,
    passwordHash,
    role,
    associationId,
    fullName = null,
    phone = null,
    canAddFederationVoters = false,
    canManageMembers = false,
  } = userData;
  const result = await client.query(
    `INSERT INTO users (email, email_lower, password_hash, role, association_id, full_name, phone, can_add_federation_voters, can_manage_members, is_temporary_password, temp_password_set_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, now())
     RETURNING *`,
    [email, emailLower, passwordHash, role, associationId, fullName, phone, canAddFederationVoters, canManageMembers]
  );
  return result.rows[0];
}

async function updatePassword(client, id, passwordHash) {
  const result = await client.query(
    `UPDATE users
     SET password_hash = $1,
         is_temporary_password = FALSE,
         temp_password_set_at = NULL
     WHERE id = $2 AND is_active = TRUE`,
    [passwordHash, id]
  );
  return result.rowCount;
}

/**
 * Reset a user's password to a new PERMANENT password (forgot-password flow).
 * Clears the temporary-password flag and any lockout/failure state so the user
 * can log in immediately with the new password.
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @param {string} passwordHash
 * @returns {Promise<number>} affected row count
 */
async function resetPasswordById(client, id, passwordHash) {
  const result = await client.query(
    `UPDATE users
     SET password_hash = $1,
         is_temporary_password = FALSE,
         temp_password_set_at = NULL,
         failed_login_count = 0,
         locked_until = NULL
     WHERE id = $2 AND is_active = TRUE`,
    [passwordHash, id]
  );
  return result.rowCount;
}

/**
 * Update a user's email and reset them to a new temporary password.
 * Clears lockout/failure state and marks the password temporary again.
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @param {{ email: string, emailLower: string, passwordHash: string }} data
 * @returns {Promise<object|null>} the updated row
 */
async function updateEmailAndResetTempPassword(client, id, data) {
  const { email, emailLower, passwordHash } = data;
  const result = await client.query(
    `UPDATE users
     SET email = $1,
         email_lower = $2,
         password_hash = $3,
         is_temporary_password = TRUE,
         temp_password_set_at = now(),
         failed_login_count = 0,
         locked_until = NULL
     WHERE id = $4 AND is_active = TRUE
     RETURNING *`,
    [email, emailLower, passwordHash, id]
  );
  return result.rows[0] || null;
}

async function updateFailedAttempts(client, id, count) {
  const result = await client.query(
    'UPDATE users SET failed_login_count = $1 WHERE id = $2',
    [count, id]
  );
  return result.rowCount;
}

async function updateLockedUntil(client, id, lockedUntil) {
  const result = await client.query(
    'UPDATE users SET locked_until = $1 WHERE id = $2',
    [lockedUntil, id]
  );
  return result.rowCount;
}

async function updateLastActivity(client, id, lastActivityAt) {
  const result = await client.query(
    'UPDATE users SET last_activity_at = $1 WHERE id = $2 AND is_active = TRUE',
    [lastActivityAt, id]
  );
  return result.rowCount;
}

/** List federation-scope users (association_id IS NULL). */
async function listFederationUsers(client) {
  const result = await client.query(
    `SELECT id, email, role, is_active, is_temporary_password, created_at
     FROM users WHERE association_id IS NULL ORDER BY created_at DESC`
  );
  return result.rows;
}

/** Find a federation user by normalized email (association_id IS NULL), regardless of active state. */
async function findFederationUserByEmail(client, emailLower) {
  const result = await client.query(
    'SELECT * FROM users WHERE email_lower = $1 AND association_id IS NULL LIMIT 1',
    [emailLower]
  );
  return result.rows[0] || null;
}

/**
 * Find the first user matching the given normalized email ANYWHERE in the
 * system, regardless of association_id or active state. Used for the global
 * existing-account check when adding a participant: if an account already
 * exists (any association, active or not), it is reused without resetting the
 * password or sending a credential email.
 * @param {import('pg').PoolClient} client
 * @param {string} emailLower - Normalized (lowercased) email.
 * @returns {Promise<object|null>}
 */
async function findAnyByEmail(client, emailLower) {
  const result = await client.query(
    'SELECT * FROM users WHERE email_lower = $1 LIMIT 1',
    [emailLower]
  );
  return result.rows[0] || null;
}

/** Find a user by id regardless of active state. */
async function findByIdAny(client, id) {
  const result = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] || null;
}

/** Enable/disable a user. */
async function setActive(client, id, isActive) {
  const result = await client.query(
    'UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id, email, role, is_active',
    [id, isActive]
  );
  return result.rows[0] || null;
}

/**
 * Update a user's full name.
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @param {string} fullName
 * @returns {Promise<object|null>} the updated row (id, email, full_name, is_active)
 */
async function updateFullName(client, id, fullName) {
  const result = await client.query(
    'UPDATE users SET full_name = $2 WHERE id = $1 RETURNING id, email, full_name, is_active',
    [id, fullName]
  );
  return result.rows[0] || null;
}

/**
 * Update a user's phone number (nullable to allow clearing).
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @param {string|null} phone
 * @returns {Promise<object|null>} the updated row (id, email, full_name, phone, is_active)
 */
async function updatePhone(client, id, phone) {
  const result = await client.query(
    'UPDATE users SET phone = $2 WHERE id = $1 RETURNING id, email, full_name, phone, is_active',
    [id, phone]
  );
  return result.rows[0] || null;
}

/** Update a user's role. */
async function updateRole(client, id, role) {
  const result = await client.query(
    'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, role, is_active',
    [id, role]
  );
  return result.rows[0] || null;
}

/** Hard-delete a user. */
async function deleteById(client, id) {
  const result = await client.query('DELETE FROM users WHERE id = $1', [id]);
  return result.rowCount;
}

/**
 * Clear the rows that reference a user via a non-cascading foreign key so the
 * user account can then be safely hard-deleted. Removes the user from all
 * election participant lists and nulls out any election/candidate they created.
 *
 * IMPORTANT: this does NOT touch voting history (voter_voted /
 * voter_voted_position) or the anonymous votes — those must be preserved. It is
 * therefore only safe to hard-delete a user who has NO voting history (see
 * hasVotingHistory); a user who has voted is deactivated instead.
 *
 * Tables with ON DELETE CASCADE (association_members, password_reset_codes) are
 * handled automatically by the database when the user row is deleted.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} id - user id
 * @returns {Promise<void>}
 */
async function clearUserReferences(client, id) {
  await client.query('DELETE FROM participants WHERE user_id = $1', [id]);
  await client.query('UPDATE elections SET created_by = NULL WHERE created_by = $1', [id]);
  await client.query('UPDATE candidates SET created_by = NULL WHERE created_by = $1', [id]);
}

/**
 * True iff the user has ANY voting history (has cast at least one ballot, at the
 * election or per-position level). Such a user must NOT be hard-deleted so the
 * voting record is preserved.
 * @param {import('pg').PoolClient} client
 * @param {string} id - user id
 * @returns {Promise<boolean>}
 */
async function hasVotingHistory(client, id) {
  const result = await client.query(
    `SELECT
       EXISTS(SELECT 1 FROM voter_voted_position WHERE user_id = $1)
       OR EXISTS(SELECT 1 FROM voter_voted WHERE user_id = $1) AS voted`,
    [id]
  );
  return result.rows[0] ? result.rows[0].voted === true : false;
}

/**
 * Find the first management-role user matching the given normalized email,
 * across ANY association and ANY active state. Used for the global uniqueness
 * check when creating a new management account.
 * @param {import('pg').PoolClient} client
 * @param {string} emailLower - Normalized (lowercased) email.
 * @returns {Promise<object|null>}
 */
async function findManagementUserByEmailAnywhere(client, emailLower) {
  const result = await client.query(
    `SELECT * FROM users
     WHERE email_lower = $1
       AND role IN ('FEDERATION_ADMINISTRATOR','FEDERATION_ELECTION_MANAGER','ASSOCIATION_MANAGER','ASSOCIATION_ELECTION_MANAGER')
     ORDER BY created_at ASC
     LIMIT 1`,
    [emailLower]
  );
  return result.rows[0] || null;
}

/**
 * List management-role users (ASSOCIATION_MANAGER, ASSOCIATION_ELECTION_MANAGER)
 * for a given association.
 * @param {import('pg').PoolClient} client
 * @param {string} associationId
 * @returns {Promise<object[]>}
 */
async function listAssociationManagementUsers(client, associationId) {
  const result = await client.query(
    `SELECT id, email, full_name, role, can_add_federation_voters, can_manage_members, is_active, is_temporary_password, created_at
     FROM users
     WHERE association_id = $1
       AND role IN ('ASSOCIATION_MANAGER','ASSOCIATION_ELECTION_MANAGER')
     ORDER BY created_at DESC`,
    [associationId]
  );
  return result.rows;
}

/**
 * Update an association sub-user's role and permission flags.
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @param {{ role: string, canAddFederationVoters: boolean, canManageMembers: boolean }} data
 * @returns {Promise<object|null>} the updated row
 */
async function updateAssociationUser(client, id, { role, canAddFederationVoters, canManageMembers = false }) {
  const result = await client.query(
    `UPDATE users
     SET role = $2, can_add_federation_voters = $3, can_manage_members = $4
     WHERE id = $1
     RETURNING *`,
    [id, role, canAddFederationVoters, canManageMembers]
  );
  return result.rows[0] || null;
}

module.exports = {
  findByEmail,
  findByEmailAndAssociation,
  findById,
  existsByRole,
  create,
  updatePassword,
  resetPasswordById,
  updateEmailAndResetTempPassword,
  updateFailedAttempts,
  updateLockedUntil,
  updateLastActivity,
  listFederationUsers,
  findFederationUserByEmail,
  findAnyByEmail,
  findByIdAny,
  setActive,
  updateFullName,
  updatePhone,
  updateRole,
  deleteById,
  clearUserReferences,
  hasVotingHistory,
  findManagementUserByEmailAnywhere,
  listAssociationManagementUsers,
  updateAssociationUser,
};
