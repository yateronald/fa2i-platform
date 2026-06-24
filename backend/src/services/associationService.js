'use strict';

/**
 * Association_Service
 *
 * Association is a REGISTRY record: the super admin creates name + emblem + logo
 * with no president initially. A president / ASSOCIATION_MANAGER is assigned in a
 * separate step. President fields are therefore optional on the association record.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
 */

const { withTransaction } = require('../db/pool');
const associationsRepository = require('../db/repositories/associationsRepository');
const usersRepository = require('../db/repositories/usersRepository');
const credentialService = require('./credentialService');
const emailService = require('./emailService');
const photoStorageService = require('./photoStorageService');

/**
 * Validate that an email address has the correct format:
 * - Contains exactly one '@'
 * - Non-empty local part (before @)
 * - Non-empty domain part (after @) containing at least one '.'
 * - Domain segments separated by '.' are all non-empty
 *
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  const atIndex = email.indexOf('@');
  // Must contain '@' and only one
  if (atIndex === -1 || email.lastIndexOf('@') !== atIndex) {
    return false;
  }

  const localPart = email.substring(0, atIndex);
  const domainPart = email.substring(atIndex + 1);

  // Non-empty local part
  if (localPart.length === 0) {
    return false;
  }

  // Non-empty domain containing at least one dot
  if (domainPart.length === 0) {
    return false;
  }

  if (!domainPart.includes('.')) {
    return false;
  }

  // Every segment between dots must be non-empty
  const segments = domainPart.split('.');
  for (const segment of segments) {
    if (segment.length === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Validate the (legacy) full association creation input.
 * Collects all errors and returns them as an array.
 *
 * @param {{ name?: any, logo?: any, presidentName?: any, presidentEmail?: any }} input
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateInput(input) {
  const errors = [];

  // Name validation
  if (!input.name || (typeof input.name === 'string' && input.name.trim().length === 0)) {
    errors.push('Le nom est requis');
  } else if (typeof input.name === 'string' && input.name.length > 200) {
    errors.push('Le nom ne doit pas dépasser 200 caractères');
  }

  // Logo validation
  if (!input.logo) {
    errors.push('Le logo est requis');
  }

  // President name validation
  if (!input.presidentName || (typeof input.presidentName === 'string' && input.presidentName.trim().length === 0)) {
    errors.push('Le nom du président est requis');
  } else if (typeof input.presidentName === 'string' && input.presidentName.length > 200) {
    errors.push('Le nom du président ne doit pas dépasser 200 caractères');
  }

  // President email validation
  if (!input.presidentEmail || (typeof input.presidentEmail === 'string' && input.presidentEmail.trim().length === 0)) {
    errors.push("L'email du président est requis");
  } else if (typeof input.presidentEmail === 'string') {
    if (input.presidentEmail.length > 254) {
      errors.push("L'email du président ne doit pas dépasser 254 caractères");
    } else if (!isValidEmail(input.presidentEmail)) {
      errors.push("L'email du président est invalide");
    }
  }

  return errors;
}

/**
 * Create an association with full validation and atomic persistence (LEGACY).
 *
 * Retained for backward compatibility / existing tests. The registry workflow
 * uses {@link createRegistryAssociation} + {@link assignManager} instead.
 *
 * @param {{ name: string, logo: Buffer|string, presidentName: string, presidentEmail: string }} input
 * @param {object} [deps] - Dependency overrides for testing.
 * @returns {Promise<{ success: true, association: object } | { success: false, errors: string[] } | { success: false, error: string }>}
 */
async function createAssociation(input, deps) {
  const assocRepo = (deps && deps.associationsRepository) || associationsRepository;
  const usersRepo = (deps && deps.usersRepository) || usersRepository;
  const credSvc = (deps && deps.credentialService) || credentialService;
  const emailSvc = (deps && deps.emailService) || emailService;
  const photoSvc = (deps && deps.photoStorageService) || photoStorageService;
  const txRunner = (deps && deps.withTransaction) || withTransaction;

  // Step 1: Validate input fields
  const errors = validateInput(input);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Step 2: Check email uniqueness (requires a client from the transaction)
  const emailLower = input.presidentEmail.toLowerCase();

  try {
    const result = await txRunner(async (client) => {
      // Check email uniqueness within the transaction
      const existing = await assocRepo.findByEmail(client, emailLower);
      if (existing) {
        return { success: false, errors: ["L'email est déjà utilisé"] };
      }

      // Step 3a: Store the logo
      const logoResult = await photoSvc.storeImage(input.logo, 'logo');
      if (!logoResult.reference) {
        // Roll back — throw to trigger transaction rollback
        const err = new Error('LOGO_STORAGE_FAILED');
        err.isExpected = true;
        throw err;
      }

      // Step 3b: Generate temporary password and hash it
      const tempPassword = credSvc.generateTemporaryPassword();
      const passwordHash = await credSvc.hashPassword(tempPassword);

      // Step 3c: Insert association record
      const association = await assocRepo.create(client, {
        name: input.name,
        logoRef: logoResult.reference,
        presidentName: input.presidentName,
        presidentEmail: input.presidentEmail,
        presidentEmailLower: emailLower,
      });

      // Step 3d: Insert Association_Manager user record
      let user;
      try {
        user = await usersRepo.create(client, {
          email: input.presidentEmail,
          emailLower,
          passwordHash,
          role: 'ASSOCIATION_MANAGER',
          associationId: association.id,
        });
      } catch (userErr) {
        // Manager account cannot be created — throw to trigger rollback
        const err = new Error('MANAGER_CREATION_FAILED');
        err.isExpected = true;
        err.cause = userErr;
        throw err;
      }

      // Step 3e: Send credentials email (within transaction timing)
      await emailSvc.sendCredentials(
        input.presidentName,
        input.presidentEmail,
        tempPassword,
        deps && deps.emailDeps
      );

      return { success: true, association };
    }, deps && deps.pool ? { pool: deps.pool } : undefined);

    return result;
  } catch (err) {
    if (err.isExpected) {
      return { success: false, error: "L'association n'a pas pu être créée" };
    }
    throw err;
  }
}

/**
 * Validate registry creation input (name + emblem + logo).
 * @param {{ name?: any, emblem?: any, logo?: any }} input
 * @returns {string[]}
 */
function validateRegistryInput(input) {
  const errors = [];

  if (!input.name || (typeof input.name === 'string' && input.name.trim().length === 0)) {
    errors.push('Le nom est requis');
  } else if (typeof input.name === 'string' && input.name.length > 200) {
    errors.push('Le nom ne doit pas dépasser 200 caractères');
  }

  if (input.emblem != null && typeof input.emblem === 'string' && input.emblem.length > 500) {
    errors.push("L'emblème ne doit pas dépasser 500 caractères");
  }

  if (!input.logo) {
    errors.push('Le logo est requis');
  }

  return errors;
}

/**
 * Create an association registry record (name + emblem + logo, no president).
 *
 * 1. Validate name (required, <=200), emblem (optional, <=500), logo (required).
 * 2. Check case-insensitive name uniqueness.
 * 3. Within a transaction: store the logo, then insert the registry record.
 *    A null logo reference triggers a rollback.
 *
 * @param {{ name: string, emblem?: string|null, logo: Buffer|string }} input
 * @param {object} [deps] - Dependency overrides for testing.
 * @returns {Promise<{ success: true, association: object } | { success: false, errors: string[] } | { success: false, error: string }>}
 */
async function createRegistryAssociation(input, deps) {
  const assocRepo = (deps && deps.associationsRepository) || associationsRepository;
  const photoSvc = (deps && deps.photoStorageService) || photoStorageService;
  const txRunner = (deps && deps.withTransaction) || withTransaction;

  const errors = validateRegistryInput(input);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  const emblem = input.emblem != null && input.emblem !== '' ? input.emblem : null;
  const nameLower = input.name.toLowerCase();

  try {
    const result = await txRunner(async (client) => {
      // Case-insensitive name uniqueness
      const existing = await assocRepo.findByName(client, nameLower);
      if (existing) {
        return { success: false, errors: ['Une association portant ce nom existe déjà'] };
      }

      // Store the logo
      const logoResult = await photoSvc.storeImage(input.logo, 'logo');
      if (!logoResult.reference) {
        const err = new Error('LOGO_STORAGE_FAILED');
        err.isExpected = true;
        throw err;
      }

      const association = await assocRepo.createRegistry(client, {
        name: input.name,
        emblem,
        logoRef: logoResult.reference,
      });

      return { success: true, association };
    }, deps && deps.pool ? { pool: deps.pool } : undefined);

    return result;
  } catch (err) {
    if (err.isExpected) {
      return { success: false, error: "L'association n'a pas pu être créée" };
    }
    throw err;
  }
}

/**
 * Assign a president / ASSOCIATION_MANAGER to an existing registry association.
 *
 * 1. Load the association; missing → error.
 * 2. If it already has an active ASSOCIATION_MANAGER → error.
 * 3. Validate presidentName (1–200) and presidentEmail (valid, <=254).
 * 4. Ensure the email isn't already used by an active user in the association.
 * 5. Within a transaction: create the manager user, set president fields, and
 *    send a branded credentials email using the association's logo + name.
 *
 * @param {string} associationId
 * @param {{ presidentName: string, presidentEmail: string }} input
 * @param {object} [deps] - Dependency overrides for testing.
 * @returns {Promise<{ success: true, association: object } | { success: false, errors: string[] } | { success: false, error: string }>}
 */
async function assignManager(associationId, input, deps) {
  const assocRepo = (deps && deps.associationsRepository) || associationsRepository;
  const usersRepo = (deps && deps.usersRepository) || usersRepository;
  const credSvc = (deps && deps.credentialService) || credentialService;
  const emailSvc = (deps && deps.emailService) || emailService;
  const txRunner = (deps && deps.withTransaction) || withTransaction;

  const presidentName = input && input.presidentName;
  const presidentEmail = input && input.presidentEmail;

  try {
    const result = await txRunner(async (client) => {
      // Step 1: Load association
      const assoc = await assocRepo.findById(client, associationId);
      if (!assoc) {
        return { success: false, error: 'Association introuvable' };
      }

      // Step 2: Already has a manager?
      const already = await assocRepo.hasManager(client, associationId);
      if (already) {
        return { success: false, error: 'Cette association a déjà un gestionnaire' };
      }

      // Step 3: Validate president fields
      const errors = [];
      if (!presidentName || (typeof presidentName === 'string' && presidentName.trim().length === 0)) {
        errors.push('Le nom du président est requis');
      } else if (typeof presidentName === 'string' && presidentName.length > 200) {
        errors.push('Le nom du président ne doit pas dépasser 200 caractères');
      }
      if (!presidentEmail || (typeof presidentEmail === 'string' && presidentEmail.trim().length === 0)) {
        errors.push("L'email du président est requis");
      } else if (typeof presidentEmail === 'string') {
        if (presidentEmail.length > 254) {
          errors.push("L'email du président ne doit pas dépasser 254 caractères");
        } else if (!isValidEmail(presidentEmail)) {
          errors.push("L'email du président est invalide");
        }
      }
      if (errors.length > 0) {
        return { success: false, errors };
      }

      const emailLower = presidentEmail.toLowerCase();

      // Step 4: Email not already used by an active user in this association
      const clash = await usersRepo.findByEmailAndAssociation(client, emailLower, associationId);
      if (clash) {
        return { success: false, error: 'Cet email est déjà utilisé' };
      }

      // Step 5: Create the manager + set president fields + send branded email
      const tempPassword = credSvc.generateTemporaryPassword();
      const passwordHash = await credSvc.hashPassword(tempPassword);

      await usersRepo.create(client, {
        email: presidentEmail,
        emailLower,
        passwordHash,
        role: 'ASSOCIATION_MANAGER',
        associationId,
        fullName: presidentName,
      });

      const updated = await assocRepo.setPresident(client, associationId, {
        presidentName,
        presidentEmail,
        presidentEmailLower: emailLower,
      });

      await emailSvc.sendCredentials(presidentName, presidentEmail, tempPassword, {
        logoUrl: assoc.logo_ref,
        brandName: assoc.name,
      });

      return { success: true, association: updated };
    }, deps && deps.pool ? { pool: deps.pool } : undefined);

    return result;
  } catch (err) {
    if (err.isExpected) {
      return { success: false, error: "Le gestionnaire n'a pas pu être assigné" };
    }
    throw err;
  }
}

/**
 * Update an existing association (registry-aware).
 *
 * Validates name and emblem; president fields are optional. When the association
 * already has a president AND a new, different president email is provided, the
 * linked manager account is synced: its email is updated, a new temporary
 * password is issued, and the credentials are re-sent.
 *
 * @param {string} id - UUID of the association to update.
 * @param {{ name: string, emblem?: string|null, presidentName?: string, presidentEmail?: string, logo?: string }} input
 * @param {object} [deps] - Dependency overrides for testing.
 * @returns {Promise<{ success: true, association: object } | { success: false, errors: string[] } | { success: false, error: string }>}
 */
async function updateAssociation(id, input, deps) {
  const assocRepo = (deps && deps.associationsRepository) || associationsRepository;
  const photoSvc = (deps && deps.photoStorageService) || photoStorageService;
  const usersRepo = (deps && deps.usersRepository) || usersRepository;
  const credSvc = (deps && deps.credentialService) || credentialService;
  const emailSvc = (deps && deps.emailService) || emailService;
  const txRunner = (deps && deps.withTransaction) || withTransaction;

  // Validate name + emblem; president fields are optional.
  const errors = [];
  if (!input.name || (typeof input.name === 'string' && input.name.trim().length === 0)) {
    errors.push('Le nom est requis');
  } else if (input.name.length > 200) {
    errors.push('Le nom ne doit pas dépasser 200 caractères');
  }
  if (input.emblem != null && typeof input.emblem === 'string' && input.emblem.length > 500) {
    errors.push("L'emblème ne doit pas dépasser 500 caractères");
  }

  const emailProvided = input.presidentEmail != null && String(input.presidentEmail).trim().length > 0;
  if (input.presidentName != null && typeof input.presidentName === 'string' && input.presidentName.length > 200) {
    errors.push('Le nom du président ne doit pas dépasser 200 caractères');
  }
  if (emailProvided) {
    if (input.presidentEmail.length > 254) {
      errors.push("L'email du président ne doit pas dépasser 254 caractères");
    } else if (!isValidEmail(input.presidentEmail)) {
      errors.push("L'email du président est invalide");
    }
  }
  if (errors.length > 0) return { success: false, errors };

  const emailLower = emailProvided ? input.presidentEmail.toLowerCase() : null;

  try {
    const result = await txRunner(async (client) => {
      const existing = await assocRepo.findById(client, id);
      if (!existing) return { success: false, error: 'Association introuvable' };

      // Association-level email uniqueness (excluding self), only when an email is provided.
      if (emailProvided) {
        const byEmail = await assocRepo.findByEmail(client, emailLower);
        if (byEmail && byEmail.id !== id) {
          return { success: false, errors: ["L'email est déjà utilisé"] };
        }
      }

      // Logo: upload new if provided, else keep existing
      let logoRef = existing.logo_ref;
      if (input.logo) {
        const logoResult = await photoSvc.storeImage(input.logo, 'logo');
        if (!logoResult.reference) {
          const err = new Error('LOGO_STORAGE_FAILED'); err.isExpected = true; throw err;
        }
        logoRef = logoResult.reference;
      }

      // Resolve persisted president fields (unchanged unless explicitly provided).
      const newPresidentName = input.presidentName != null ? input.presidentName : existing.president_name;
      const newPresidentEmail = emailProvided ? input.presidentEmail : existing.president_email;
      const newPresidentEmailLower = emailProvided ? emailLower : existing.president_email_lower;

      const updated = await assocRepo.update(client, id, {
        name: input.name,
        emblem: input.emblem != null ? input.emblem : existing.emblem,
        logoRef,
        presidentName: newPresidentName,
        presidentEmail: newPresidentEmail,
        presidentEmailLower: newPresidentEmailLower,
      });

      // Sync the linked manager account ONLY when the association already had a
      // president and the provided email actually differs.
      const hadPresident = existing.president_email_lower != null;
      const emailChanged = emailProvided && hadPresident && existing.president_email_lower !== emailLower;
      if (emailChanged) {
        const manager = await usersRepo.findByEmailAndAssociation(
          client,
          existing.president_email_lower,
          id
        );
        if (manager) {
          // Guard: the new email must not already belong to a different active
          // user in this association.
          const clash = await usersRepo.findByEmailAndAssociation(client, emailLower, id);
          if (clash && clash.id !== manager.id) {
            return { success: false, errors: ["L'email est déjà utilisé par un autre compte de cette association"] };
          }
          const tempPassword = credSvc.generateTemporaryPassword();
          const passwordHash = await credSvc.hashPassword(tempPassword);
          await usersRepo.updateEmailAndResetTempPassword(client, manager.id, {
            email: input.presidentEmail,
            emailLower,
            passwordHash,
          });
          await emailSvc.sendCredentials(newPresidentName, input.presidentEmail, tempPassword, deps && deps.emailDeps);
        }
      }

      return { success: true, association: updated };
    }, deps && deps.pool ? { pool: deps.pool } : undefined);
    return result;
  } catch (err) {
    if (err.isExpected) return { success: false, error: "L'association n'a pas pu être mise à jour" };
    throw err;
  }
}

/**
 * Delete a registry association.
 *
 * Loads the association; if missing → error. Refuses deletion when any
 * elections or user accounts are linked to it. Otherwise hard-deletes it.
 *
 * @param {string} id
 * @param {object} [deps] - Dependency overrides for testing.
 * @returns {Promise<{ success: true } | { success: false, error: string }>}
 */
async function deleteRegistryAssociation(id, deps) {
  const assocRepo = (deps && deps.associationsRepository) || associationsRepository;
  const txRunner = (deps && deps.withTransaction) || withTransaction;

  return txRunner(async (client) => {
    const existing = await assocRepo.findById(client, id);
    if (!existing) {
      return { success: false, error: 'Association introuvable' };
    }

    const elections = await assocRepo.countElections(client, id);
    const users = await assocRepo.countUsers(client, id);
    if (elections > 0 || users > 0) {
      return {
        success: false,
        error: 'Impossible de supprimer: des élections ou des comptes sont liés à cette association',
      };
    }

    await assocRepo.deleteById(client, id);
    return { success: true };
  }, deps && deps.pool ? { pool: deps.pool } : undefined);
}

module.exports = {
  createAssociation,
  createRegistryAssociation,
  assignManager,
  updateAssociation,
  deleteRegistryAssociation,
  validateInput,
  validateRegistryInput,
  isValidEmail,
};
