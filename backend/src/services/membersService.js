'use strict';

/**
 * Members_Service
 *
 * Manages the member roster of an association. Membership is an
 * ASSOCIATION-ONLY feature: only an ASSOCIATION_MANAGER, or an
 * ASSOCIATION_ELECTION_MANAGER who has been granted the can_manage_members
 * flag, may manage members — and only for their OWN association
 * (identity.association_id). Federation roles are never member managers.
 *
 * Adding a member resolves or creates a VOTER account scoped to the
 * association. A brand-new account receives a generated temporary password and
 * a branded credentials email (the association's own logo + name). An existing
 * account (found anywhere by email) is reused as-is: no password reset, no
 * email. Removing a member only unlinks the membership; the user account is
 * preserved.
 */

const { withTransaction } = require('../db/pool');
const usersRepository = require('../db/repositories/usersRepository');
const associationsRepository = require('../db/repositories/associationsRepository');
const membersRepository = require('../db/repositories/membersRepository');
const participantsRepository = require('../db/repositories/participantsRepository');
const credentialService = require('./credentialService');
const emailService = require('./emailService');
const accessControlService = require('./accessControlService');
const { isValidEmail } = require('./associationService');

/**
 * Build an access-denied result for a caller who may not manage members.
 * @returns {{ success: false, error: string }}
 */
function accessDenied() {
  return { success: false, error: 'Accès refusé' };
}

/**
 * Resolve injectable dependencies, falling back to the real implementations.
 * @param {object} [deps]
 */
function resolveDeps(deps) {
  return {
    usersRepo: (deps && deps.usersRepository) || usersRepository,
    assocRepo: (deps && deps.associationsRepository) || associationsRepository,
    membersRepo: (deps && deps.membersRepository) || membersRepository,
    participantsRepo: (deps && deps.participantsRepository) || participantsRepository,
    credSvc: (deps && deps.credentialService) || credentialService,
    emailSvc: (deps && deps.emailService) || emailService,
    txRunner: (deps && deps.withTransaction) || withTransaction,
    txOpts: deps && deps.pool ? { pool: deps.pool } : undefined,
    emailDeps: deps && deps.emailDeps,
  };
}

/**
 * Validate an optional phone number. Empty/missing is allowed (the field is
 * optional). When provided it must be a plausible phone: digits and the common
 * separators (+, spaces, dashes, parentheses), 4–30 characters.
 * @param {string|null|undefined} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
  if (phone == null || String(phone).trim() === '') return true;
  const p = String(phone).trim();
  return /^[+]?[0-9 ()\-]{4,30}$/.test(p);
}

/**
 * Validate a single member row (email + full name, optional phone).
 * @param {{ email?: string, fullName?: string, phone?: string }} input
 * @returns {string[]} Array of error messages (empty if valid).
 */
function validateMemberInput(input) {
  const errors = [];
  const email = input && input.email;
  const fullName = input && input.fullName;
  const phone = input && input.phone;

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

  if (!isValidPhone(phone)) {
    errors.push('Le numéro de téléphone est invalide');
  }

  return errors;
}

/**
 * List the members of the caller's association.
 *
 * @param {{ id: string, role: string, association_id: string|null, can_manage_members?: boolean }} identity
 * @param {object} [deps]
 * @returns {Promise<{ success: true, members: object[] } | { success: false, error: string }>}
 */
async function listMembers(identity, deps) {
  if (!accessControlService.canManageMembers(identity)) {
    return accessDenied();
  }
  const { membersRepo, txRunner, txOpts } = resolveDeps(deps);

  const members = await txRunner(async (client) => {
    return membersRepo.listByAssociation(client, identity.association_id);
  }, txOpts);

  return { success: true, members };
}

/**
 * Add a single member to the caller's association.
 *
 * Reuses an existing account (found anywhere by email) without a password reset
 * or email; otherwise creates a new VOTER scoped to the association with a
 * temporary password and sends branded credentials. A user already on the
 * roster is reported as a duplicate.
 *
 * @param {{ id: string, role: string, association_id: string|null, can_manage_members?: boolean }} identity
 * @param {{ email: string, fullName: string }} input
 * @param {object} [deps]
 * @returns {Promise<{ success: true, created: boolean, existingAccount: boolean, member: object } | { success: false, errors?: string[], error?: string }>}
 */
async function addMember(identity, input, deps) {
  if (!accessControlService.canManageMembers(identity)) {
    return accessDenied();
  }

  input = input || {};
  const errors = validateMemberInput(input);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  const resolved = resolveDeps(deps);
  return addMemberInternal(identity, input, resolved);
}

/**
 * Shared internal helper: add one member within a transaction.
 * Assumes the caller has already been authorized and the input validated.
 *
 * @param {object} identity
 * @param {{ email: string, fullName: string }} input
 * @param {object} resolved - resolved dependencies.
 * @returns {Promise<object>}
 */
async function addMemberInternal(identity, input, resolved) {
  const { usersRepo, assocRepo, membersRepo, credSvc, emailSvc, txRunner, txOpts, emailDeps } = resolved;

  const associationId = identity.association_id;
  const email = input.email;
  const fullName = input.fullName;
  const phone =
    input.phone != null && String(input.phone).trim() !== '' ? String(input.phone).trim() : null;
  const emailLower = String(email).toLowerCase();

  let emailPayload = null;

  const result = await txRunner(async (client) => {
    // 1. Resolve or create the user account.
    const existing = await usersRepo.findAnyByEmail(client, emailLower);

    let userId;
    let created;

    if (existing) {
      userId = existing.id;
      created = false;
    } else {
      const tempPassword = credSvc.generateTemporaryPassword();
      const passwordHash = await credSvc.hashPassword(tempPassword);
      const newUser = await usersRepo.create(client, {
        email,
        emailLower,
        passwordHash,
        role: 'VOTER',
        associationId,
        fullName,
        phone,
      });
      userId = newUser.id;
      created = true;

      // Capture branding to email AFTER commit (no SMTP inside the transaction).
      const assoc = await assocRepo.findById(client, associationId);
      emailPayload = {
        fullName,
        email,
        tempPassword,
        logoUrl: (assoc && assoc.logo_ref) || null,
        brandName: (assoc && assoc.name) || 'FA2I',
      };
    }

    // 2. Reject when the user is already a member of this association.
    const alreadyMember = await membersRepo.findMembership(client, associationId, userId);
    if (alreadyMember) {
      return { success: false, error: 'Cette personne est déjà membre' };
    }

    // 3. Link the membership.
    await membersRepo.addMembership(client, associationId, userId);

    return {
      success: true,
      created,
      existingAccount: !created,
      member: { user_id: userId, email, full_name: fullName, phone: created ? phone : undefined },
    };
  }, txOpts);

  // Send the credentials email in the BACKGROUND so the response is not blocked
  // by SMTP latency. Only newly-created accounts get an email.
  if (result && result.success && emailPayload) {
    Promise.resolve(
      emailSvc.sendCredentials(emailPayload.fullName, emailPayload.email, emailPayload.tempPassword, {
        ...(emailDeps || {}),
        logoUrl: emailPayload.logoUrl,
        brandName: emailPayload.brandName,
      })
    ).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[email] member credential send failed:', err && err.message);
    });
  }

  return result;
}

/**
 * Add multiple members to the caller's association.
 *
 * Each row is validated and processed with the same logic as {@link addMember}.
 * Produces a summary distinguishing newly created (and emailed) accounts from
 * reused existing accounts, duplicates (already a member, including in-file
 * duplicates), and failed rows (validation/other errors).
 *
 * @param {{ id: string, role: string, association_id: string|null, can_manage_members?: boolean }} identity
 * @param {Array<{ email: string, fullName: string }>} rows
 * @param {object} [deps]
 * @returns {Promise<{ success: true, summary: { added: number, reused: number, duplicates: number, failed: Array<{ email: string, error: string }> } } | { success: false, error: string }>}
 */
async function bulkAddMembers(identity, rows, deps) {
  if (!accessControlService.canManageMembers(identity)) {
    return accessDenied();
  }

  const resolved = resolveDeps(deps);
  const summary = { added: 0, reused: 0, duplicates: 0, failed: [] };
  const list = Array.isArray(rows) ? rows : [];
  const seenEmails = new Set();

  for (const row of list) {
    const email = (row && row.email) || '';
    const emailLower = typeof email === 'string' ? email.toLowerCase() : '';

    // Minimal validation: invalid rows go to failed.
    const errors = validateMemberInput(row || {});
    if (errors.length > 0) {
      summary.failed.push({ email, error: errors[0] });
      continue;
    }

    // In-file duplicate: same email appeared earlier in this submission.
    if (emailLower && seenEmails.has(emailLower)) {
      summary.duplicates += 1;
      continue;
    }

    try {
      const result = await addMemberInternal(identity, row, resolved);
      if (result.success) {
        if (result.created) {
          summary.added += 1;
        } else {
          summary.reused += 1;
        }
        if (emailLower) seenEmails.add(emailLower);
      } else if (result.error === 'Cette personne est déjà membre') {
        summary.duplicates += 1;
        if (emailLower) seenEmails.add(emailLower);
      } else {
        summary.failed.push({ email, error: result.error });
      }
    } catch (err) {
      summary.failed.push({ email, error: err.message });
    }
  }

  return { success: true, summary };
}

/**
 * Enable or disable a member of the caller's association.
 *
 * Setting is_active = false on the underlying user disables the account: a
 * disabled user cannot authenticate (and therefore cannot vote), because
 * session lookup filters on is_active. Only the membership link's owner
 * association is affected; the account row itself is preserved.
 *
 * @param {{ id: string, role: string, association_id: string|null, can_manage_members?: boolean }} identity
 * @param {string} userId
 * @param {boolean} isActive
 * @param {object} [deps]
 * @returns {Promise<{ success: true, member: object } | { success: false, error: string }>}
 */
async function setMemberActive(identity, userId, isActive, deps) {
  if (!accessControlService.canManageMembers(identity)) {
    return accessDenied();
  }
  const { usersRepo, membersRepo, txRunner, txOpts } = resolveDeps(deps);

  return txRunner(async (client) => {
    const exists = await membersRepo.findMembership(client, identity.association_id, userId);
    if (!exists) {
      return { success: false, error: 'Membre introuvable' };
    }
    const updated = await usersRepo.setActive(client, userId, isActive);
    return {
      success: true,
      member: updated || { user_id: userId, is_active: isActive },
    };
  }, txOpts);
}

/**
 * Modify a member's account details (full name and/or email).
 *
 * - A provided non-empty full name updates the user's full_name.
 * - A provided email that differs (case-insensitive) from the current one is
 *   validated, checked for uniqueness against OTHER accounts, then applied. The
 *   account is reset to a new temporary password and branded credentials are
 *   re-sent to the NEW email (mirroring addMember's branding).
 * - When neither a name nor a changed email is supplied, the call is rejected
 *   as a no-op.
 *
 * @param {{ id: string, role: string, association_id: string|null, can_manage_members?: boolean }} identity
 * @param {string} userId
 * @param {{ fullName?: string, email?: string }} input
 * @param {object} [deps]
 * @returns {Promise<{ success: true, member: object, emailReset: boolean } | { success: false, error: string }>}
 */
async function updateMember(identity, userId, input, deps) {
  if (!accessControlService.canManageMembers(identity)) {
    return accessDenied();
  }

  input = input || {};
  const associationId = identity.association_id;
  const fullNameProvided =
    input.fullName != null && String(input.fullName).trim().length > 0;
  const emailProvided = input.email != null && String(input.email).trim().length > 0;
  const phoneProvided = input.phone !== undefined && input.phone !== null;

  const { usersRepo, assocRepo, membersRepo, credSvc, emailSvc, txRunner, txOpts, emailDeps } =
    resolveDeps(deps);

  return txRunner(async (client) => {
    // Membership must exist within the caller's association.
    const exists = await membersRepo.findMembership(client, associationId, userId);
    if (!exists) {
      return { success: false, error: 'Membre introuvable' };
    }

    const user = await usersRepo.findByIdAny(client, userId);
    if (!user) {
      return { success: false, error: 'Membre introuvable' };
    }

    const currentEmail = user.email;
    const currentEmailLower = (user.email_lower || String(currentEmail || '').toLowerCase());
    const newEmailLower = emailProvided ? String(input.email).toLowerCase() : null;
    const emailChanged = emailProvided && newEmailLower !== currentEmailLower;

    // Nothing to change.
    if (!fullNameProvided && !emailChanged && !phoneProvided) {
      return { success: false, error: 'Aucune modification fournie' };
    }

    let resultEmail = currentEmail;
    let resultFullName = user.full_name;
    let resultPhone = user.phone;
    let emailReset = false;

    // 1. Update the full name when provided.
    if (fullNameProvided) {
      const trimmed = String(input.fullName).trim();
      const updated = await usersRepo.updateFullName(client, userId, trimmed);
      resultFullName = (updated && updated.full_name) || trimmed;
    }

    // 1b. Update the phone when provided (empty string clears it).
    if (phoneProvided) {
      const trimmedPhone = String(input.phone).trim();
      const finalPhone = trimmedPhone === '' ? null : trimmedPhone;
      if (!isValidPhone(finalPhone)) {
        return { success: false, error: 'Le numéro de téléphone est invalide' };
      }
      const updated = await usersRepo.updatePhone(client, userId, finalPhone);
      resultPhone = updated ? updated.phone : finalPhone;
    }

    // 2. Change the email (with uniqueness check + password reset) when changed.
    if (emailChanged) {
      if (String(input.email).length > 254 || !isValidEmail(input.email)) {
        return { success: false, error: "L'email est invalide" };
      }

      const existing = await usersRepo.findAnyByEmail(client, newEmailLower);
      if (existing && existing.id !== userId) {
        return { success: false, error: 'Cet email est déjà utilisé' };
      }

      const tempPassword = credSvc.generateTemporaryPassword();
      const passwordHash = await credSvc.hashPassword(tempPassword);
      await usersRepo.updateEmailAndResetTempPassword(client, userId, {
        email: input.email,
        emailLower: newEmailLower,
        passwordHash,
      });
      resultEmail = input.email;
      emailReset = true;

      // Re-send branded credentials to the NEW email.
      const assoc = await assocRepo.findById(client, associationId);
      await emailSvc.sendCredentials(resultFullName || input.email, input.email, tempPassword, {
        ...(emailDeps || {}),
        logoUrl: (assoc && assoc.logo_ref) || null,
        brandName: (assoc && assoc.name) || 'FA2I',
      });
    }

    return {
      success: true,
      member: { user_id: userId, email: resultEmail, full_name: resultFullName, phone: resultPhone },
      emailReset,
    };
  }, txOpts);
}

/**
 * Remove a member from the caller's association.
 * Only unlinks the membership; the user account is preserved.
 *
 * @param {{ id: string, role: string, association_id: string|null, can_manage_members?: boolean }} identity
 * @param {string} userId
 * @param {object} [deps]
 * @returns {Promise<{ success: true } | { success: false, error: string }>}
 */
async function removeMember(identity, userId, deps) {
  if (!accessControlService.canManageMembers(identity)) {
    return accessDenied();
  }
  // Self-protection: a connected admin cannot remove their own account here.
  if (identity.id === userId) {
    return { success: false, error: 'Vous ne pouvez pas vous retirer vous-même.' };
  }

  const { usersRepo, membersRepo, participantsRepo, txRunner, txOpts } = resolveDeps(deps);

  return txRunner(async (client) => {
    const exists = await membersRepo.findMembership(client, identity.association_id, userId);
    if (!exists) {
      return { success: false, error: 'Membre introuvable' };
    }

    // Always unlink from the members roster.
    await membersRepo.removeMembership(client, identity.association_id, userId);

    const voted = await usersRepo.hasVotingHistory(client, userId);

    if (voted) {
      // The person already cast a ballot → their vote must be preserved for
      // history. Remove them only from elections where they did NOT vote, and
      // DEACTIVATE the account so they can no longer access the platform. The
      // account row, voting markers and anonymous votes are all kept.
      await participantsRepo.removeUnvotedForUser(client, userId);
      await usersRepo.setActive(client, userId, false);
      return { success: true, deactivated: true, accountDeleted: false };
    }

    // No voting history → safe to fully remove (clears participants + nulls any
    // created_by, then deletes the account; membership already unlinked).
    await usersRepo.clearUserReferences(client, userId);
    await usersRepo.deleteById(client, userId);
    return { success: true, accountDeleted: true };
  }, txOpts);
}

module.exports = {
  listMembers,
  addMember,
  bulkAddMembers,
  setMemberActive,
  updateMember,
  removeMember,
  validateMemberInput,
};
