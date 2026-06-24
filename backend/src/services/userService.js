'use strict';

/**
 * User_Service
 *
 * Manages federation-scope user accounts (association_id NULL) and their
 * federation roles. Creation generates a temporary password and emails the
 * credentials, mirroring Association_Service's atomic creation flow.
 */

const { withTransaction } = require('../db/pool');
const usersRepository = require('../db/repositories/usersRepository');
const credentialService = require('./credentialService');
const emailService = require('./emailService');
const { isValidEmail } = require('./associationService');

const FEDERATION_ROLES = ['FEDERATION_ADMINISTRATOR', 'FEDERATION_ELECTION_MANAGER'];

/**
 * Create a federation-scope user (association_id NULL) with a given federation role.
 * Generates a temporary password and emails the credentials.
 *
 * @param {{ email: string, role: string }} input
 * @param {{ pool?: object, usersRepository?: object, credentialService?: object, emailService?: object, withTransaction?: Function, emailDeps?: object }} [deps]
 * @returns {Promise<{ success: true, user: object } | { success: false, errors: string[] }>}
 */
async function createFederationUser(input, deps) {
  const usersRepo = (deps && deps.usersRepository) || usersRepository;
  const credSvc = (deps && deps.credentialService) || credentialService;
  const emailSvc = (deps && deps.emailService) || emailService;
  const txRunner = (deps && deps.withTransaction) || withTransaction;

  const errors = [];
  if (!input.email || String(input.email).trim().length === 0) errors.push("L'email est requis");
  else if (input.email.length > 254) errors.push("L'email ne doit pas dépasser 254 caractères");
  else if (!isValidEmail(input.email)) errors.push("L'email est invalide");
  if (!input.role || !FEDERATION_ROLES.includes(input.role)) errors.push('Le rôle est invalide');
  if (errors.length > 0) return { success: false, errors };

  const emailLower = input.email.toLowerCase();
  try {
    const result = await txRunner(async (client) => {
      const existing = await usersRepo.findFederationUserByEmail(client, emailLower);
      if (existing) return { success: false, errors: ["Un utilisateur avec cet email existe déjà"] };

      const tempPassword = credSvc.generateTemporaryPassword();
      const passwordHash = await credSvc.hashPassword(tempPassword);
      const user = await usersRepo.create(client, {
        email: input.email,
        emailLower,
        passwordHash,
        role: input.role,
        associationId: null,
      });
      await emailSvc.sendCredentials(input.email, input.email, tempPassword, deps && deps.emailDeps);
      return { success: true, user: { id: user.id, email: user.email, role: user.role, is_active: user.is_active } };
    }, deps && deps.pool ? { pool: deps.pool } : undefined);
    return result;
  } catch (err) {
    throw err;
  }
}

module.exports = { createFederationUser, FEDERATION_ROLES };
