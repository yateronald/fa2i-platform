'use strict';

/**
 * Association_User_Service
 *
 * Lets authorized callers manage the management sub-users scoped to an
 * association. Sub-users have one of two roles:
 *   - ASSOCIATION_MANAGER          (full control)
 *   - ASSOCIATION_ELECTION_MANAGER (election management; may optionally be
 *     granted permission to add voters to federation elections)
 *
 * Two kinds of caller are supported:
 *   - FEDERATION_ADMINISTRATOR (association_id = null): may manage the
 *     sub-users of ANY association. The target association is supplied
 *     explicitly by the caller (associationId).
 *   - ASSOCIATION_MANAGER (with association_id): the full-control president,
 *     locked to their OWN association. Any requested association id is ignored
 *     so a manager can never act on another association.
 *
 * Creation generates a temporary password and emails branded credentials using
 * the RESOLVED target association's own logo + name, mirroring User_Service /
 * Association_Service.
 */

const { withTransaction } = require('../db/pool');
const usersRepository = require('../db/repositories/usersRepository');
const associationsRepository = require('../db/repositories/associationsRepository');
const credentialService = require('./credentialService');
const emailService = require('./emailService');
const { isValidEmail } = require('./associationService');

/** Roles an association sub-user may hold. */
const ASSOCIATION_USER_ROLES = ['ASSOCIATION_MANAGER', 'ASSOCIATION_ELECTION_MANAGER'];

/**
 * Build an access-denied result for a caller who may not manage association users.
 * @returns {{ success: false, error: string }}
 */
function accessDenied() {
  return { success: false, error: 'Accès refusé' };
}

/**
 * True iff the caller is the full-control president of an association.
 * @param {{ role: string, association_id: string|null }} identity
 * @returns {boolean}
 */
function isAssociationManager(identity) {
  return !!identity && identity.role === 'ASSOCIATION_MANAGER' && identity.association_id != null;
}

/**
 * True iff the caller is the full federation administrator.
 * @param {{ role: string, association_id: string|null }} identity
 * @returns {boolean}
 */
function isFederationAdministrator(identity) {
  return !!identity && identity.role === 'FEDERATION_ADMINISTRATOR';
}

/**
 * Resolve which association the caller is allowed to act upon.
 *
 * - FEDERATION_ADMINISTRATOR: target = requestedAssociationId. If none was
 *   supplied → { error: 'Association requise' }. (Existence is validated
 *   against associationsRepository.findById inside the transaction.)
 * - ASSOCIATION_MANAGER with association_id: target = identity.association_id;
 *   requestedAssociationId is IGNORED so a manager can never reach another
 *   association.
 * - otherwise → { error: 'Accès refusé' }.
 *
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {string|null|undefined} requestedAssociationId
 * @returns {{ associationId: string } | { error: string }}
 */
function resolveManageContext(identity, requestedAssociationId) {
  if (isFederationAdministrator(identity)) {
    if (!requestedAssociationId) {
      return { error: 'Association requise' };
    }
    return { associationId: requestedAssociationId };
  }
  if (isAssociationManager(identity)) {
    return { associationId: identity.association_id };
  }
  return { error: 'Accès refusé' };
}

/**
 * Resolve injectable dependencies, falling back to the real implementations.
 * @param {object} [deps]
 */
function resolveDeps(deps) {
  return {
    usersRepo: (deps && deps.usersRepository) || usersRepository,
    assocRepo: (deps && deps.associationsRepository) || associationsRepository,
    credSvc: (deps && deps.credentialService) || credentialService,
    emailSvc: (deps && deps.emailService) || emailService,
    txRunner: (deps && deps.withTransaction) || withTransaction,
    txOpts: deps && deps.pool ? { pool: deps.pool } : undefined,
    emailDeps: deps && deps.emailDeps,
  };
}

/**
 * Create an association sub-user scoped to the resolved target association.
 *
 * A FEDERATION_ADMINISTRATOR targets input.associationId; an ASSOCIATION_MANAGER
 * is forced to their own association. The target association must exist.
 *
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {{ email: string, fullName: string, role: string, canAddFederationVoters?: boolean, associationId?: string }} input
 * @param {object} [deps] - Dependency overrides for testing.
 * @returns {Promise<{ success: true, user: object } | { success: false, errors?: string[], error?: string }>}
 */
async function createAssociationUser(identity, input, deps) {
  input = input || {};

  const ctx = resolveManageContext(identity, input.associationId);
  if (ctx.error) {
    return { success: false, error: ctx.error };
  }
  const targetAssociationId = ctx.associationId;

  const { usersRepo, assocRepo, credSvc, emailSvc, txRunner, txOpts, emailDeps } = resolveDeps(deps);

  const role = input.role;
  const fullName = input.fullName;
  const email = input.email;

  // Validate fields, collecting all errors.
  const errors = [];
  if (!role || !ASSOCIATION_USER_ROLES.includes(role)) {
    errors.push('Le rôle est invalide');
  }
  if (!email || String(email).trim().length === 0) {
    errors.push("L'email est requis");
  } else if (email.length > 254) {
    errors.push("L'email ne doit pas dépasser 254 caractères");
  } else if (!isValidEmail(email)) {
    errors.push("L'email est invalide");
  }
  if (!fullName || String(fullName).trim().length === 0) {
    errors.push('Le nom complet est requis');
  }
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // The federation-voter flag is only meaningful for election managers.
  const canAddFederationVoters =
    role === 'ASSOCIATION_ELECTION_MANAGER' ? input.canAddFederationVoters === true : false;

  // The member-management flag is only meaningful for election managers.
  const canManageMembers =
    role === 'ASSOCIATION_ELECTION_MANAGER' ? input.canManageMembers === true : false;

  const emailLower = email.toLowerCase();

  const result = await txRunner(async (client) => {
    // The resolved target association must exist.
    const assoc = await assocRepo.findById(client, targetAssociationId);
    if (!assoc) {
      return { success: false, error: 'Association introuvable' };
    }

    // Global uniqueness: no other management account may already use this email.
    const existing = await usersRepo.findManagementUserByEmailAnywhere(client, emailLower);
    if (existing) {
      return { success: false, error: 'Cet email est déjà utilisé par un compte de gestion' };
    }

    const tempPassword = credSvc.generateTemporaryPassword();
    const passwordHash = await credSvc.hashPassword(tempPassword);

    const user = await usersRepo.create(client, {
      email,
      emailLower,
      passwordHash,
      role,
      associationId: targetAssociationId,
      fullName,
      canAddFederationVoters,
      canManageMembers,
    });

    // Brand the credentials email with the target association's own logo + name.
    await emailSvc.sendCredentials(fullName, email, tempPassword, {
      ...(emailDeps || {}),
      logoUrl: assoc.logo_ref || null,
      brandName: assoc.name || 'FA2I',
    });

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        can_add_federation_voters: user.can_add_federation_voters,
        can_manage_members: user.can_manage_members,
        is_active: user.is_active,
        is_temporary_password: user.is_temporary_password,
        created_at: user.created_at,
      },
    };
  }, txOpts);

  return result;
}

/**
 * List the management sub-users belonging to the resolved target association.
 *
 * A FEDERATION_ADMINISTRATOR supplies associationId; an ASSOCIATION_MANAGER is
 * forced to their own association (the parameter is ignored).
 *
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {string|null|undefined} associationId
 * @param {object} [deps]
 * @returns {Promise<{ success: true, users: object[] } | { success: false, error: string }>}
 */
async function listAssociationUsers(identity, associationId, deps) {
  const ctx = resolveManageContext(identity, associationId);
  if (ctx.error) {
    return { success: false, error: ctx.error };
  }
  const targetAssociationId = ctx.associationId;

  const { usersRepo, txRunner, txOpts } = resolveDeps(deps);

  const users = await txRunner(async (client) => {
    return usersRepo.listAssociationManagementUsers(client, targetAssociationId);
  }, txOpts);

  return { success: true, users };
}

/**
 * Authorize the caller to act on a target management user.
 *
 * - FEDERATION_ADMINISTRATOR may act on a target in ANY association.
 * - ASSOCIATION_MANAGER may act only on a target in their OWN association.
 * In both cases the target MUST be an association management user, so this
 * endpoint can never touch federation users.
 *
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {object|null} target - the row returned by findByIdAny
 * @returns {boolean}
 */
function canActOnTarget(identity, target) {
  if (!target || !ASSOCIATION_USER_ROLES.includes(target.role)) {
    return false;
  }
  if (isFederationAdministrator(identity)) {
    return true;
  }
  if (isAssociationManager(identity)) {
    return target.association_id === identity.association_id;
  }
  return false;
}

/**
 * Update a sub-user's role and federation-voter permission flag.
 *
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {string} userId
 * @param {{ role: string, canAddFederationVoters?: boolean }} input
 * @param {object} [deps]
 * @returns {Promise<{ success: true, user: object } | { success: false, errors?: string[], error?: string }>}
 */
async function updateAssociationUserRole(identity, userId, input, deps) {
  if (!isFederationAdministrator(identity) && !isAssociationManager(identity)) {
    return accessDenied();
  }
  const { usersRepo, txRunner, txOpts } = resolveDeps(deps);

  input = input || {};
  const role = input.role;
  if (!role || !ASSOCIATION_USER_ROLES.includes(role)) {
    return { success: false, errors: ['Le rôle est invalide'] };
  }
  const canAddFederationVoters =
    role === 'ASSOCIATION_ELECTION_MANAGER' ? input.canAddFederationVoters === true : false;
  const canManageMembers =
    role === 'ASSOCIATION_ELECTION_MANAGER' ? input.canManageMembers === true : false;

  const result = await txRunner(async (client) => {
    const target = await usersRepo.findByIdAny(client, userId);
    if (!canActOnTarget(identity, target)) {
      return { success: false, error: 'Utilisateur introuvable' };
    }
    const updated = await usersRepo.updateAssociationUser(client, userId, {
      role,
      canAddFederationVoters,
      canManageMembers,
    });
    return {
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        full_name: updated.full_name,
        role: updated.role,
        can_add_federation_voters: updated.can_add_federation_voters,
        can_manage_members: updated.can_manage_members,
        is_active: updated.is_active,
      },
    };
  }, txOpts);

  return result;
}

/**
 * Enable or disable a sub-user. A caller may not deactivate their own account.
 *
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {string} userId
 * @param {boolean} isActive
 * @param {object} [deps]
 * @returns {Promise<{ success: true, user: object } | { success: false, error: string }>}
 */
async function setAssociationUserActive(identity, userId, isActive, deps) {
  if (!isFederationAdministrator(identity) && !isAssociationManager(identity)) {
    return accessDenied();
  }
  if (identity.id === userId && isActive === false) {
    return { success: false, error: 'Vous ne pouvez pas désactiver votre propre compte' };
  }
  const { usersRepo, txRunner, txOpts } = resolveDeps(deps);

  const result = await txRunner(async (client) => {
    const target = await usersRepo.findByIdAny(client, userId);
    if (!canActOnTarget(identity, target)) {
      return { success: false, error: 'Utilisateur introuvable' };
    }
    const updated = await usersRepo.setActive(client, userId, isActive);
    return { success: true, user: updated };
  }, txOpts);

  return result;
}

/**
 * Delete a sub-user. A caller may not delete their own account.
 *
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {string} userId
 * @param {object} [deps]
 * @returns {Promise<{ success: true } | { success: false, error: string }>}
 */
async function deleteAssociationUser(identity, userId, deps) {
  if (!isFederationAdministrator(identity) && !isAssociationManager(identity)) {
    return accessDenied();
  }
  if (identity.id === userId) {
    return { success: false, error: 'Vous ne pouvez pas supprimer votre propre compte' };
  }
  const { usersRepo, txRunner, txOpts } = resolveDeps(deps);

  const result = await txRunner(async (client) => {
    const target = await usersRepo.findByIdAny(client, userId);
    if (!canActOnTarget(identity, target)) {
      return { success: false, error: 'Utilisateur introuvable' };
    }
    await usersRepo.deleteById(client, userId);
    return { success: true };
  }, txOpts);

  return result;
}

module.exports = {
  ASSOCIATION_USER_ROLES,
  resolveManageContext,
  createAssociationUser,
  listAssociationUsers,
  updateAssociationUserRole,
  setAssociationUserActive,
  deleteAssociationUser,
};
