'use strict';

/**
 * Bootstrap admin provisioning.
 *
 * On startup, checks if any FEDERATION_ADMINISTRATOR user exists in the DB.
 * If not, creates one with a generated temporary password and logs the
 * credentials to console (since there's no other way to deliver them on
 * first run).
 *
 * Requirements: 1.1
 */

const { pool } = require('../db/pool');
const usersRepository = require('../db/repositories/usersRepository');
const credentialService = require('../services/credentialService');

const DEFAULT_ADMIN_EMAIL = 'admin@fa2i.org';

/**
 * Provision the initial Federation Administrator account if none exists.
 *
 * @param {object} [opts] - Options for testing
 * @param {import('pg').Pool} [opts.pool] - Pool override for testing
 * @param {object} [opts.usersRepo] - Repository override for testing
 * @param {object} [opts.credService] - Credential service override for testing
 * @param {function} [opts.logger] - Logger function (defaults to console.log)
 * @returns {Promise<{ created: boolean, email?: string }>}
 */
async function bootstrapAdmin(opts = {}) {
  const dbPool = opts.pool || pool;
  const repo = opts.usersRepo || usersRepository;
  const cred = opts.credService || credentialService;
  const logger = opts.logger || console.log;

  const client = await dbPool.connect();
  try {
    const exists = await repo.existsByRole(client, 'FEDERATION_ADMINISTRATOR');
    if (exists) {
      return { created: false };
    }

    const adminEmail = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
    const temporaryPassword = cred.generateTemporaryPassword();
    const passwordHash = await cred.hashPassword(temporaryPassword);

    await repo.create(client, {
      email: adminEmail,
      emailLower: adminEmail.toLowerCase(),
      passwordHash,
      role: 'FEDERATION_ADMINISTRATOR',
      associationId: null,
    });

    logger('======================================================');
    logger('  FA2I - Initial Federation Administrator provisioned');
    logger('======================================================');
    logger(`  Email:    ${adminEmail}`);
    logger(`  Password: ${temporaryPassword}`);
    logger('------------------------------------------------------');
    logger('  This password is temporary and must be changed on first login.');
    logger('  This message will not appear again.');
    logger('======================================================');

    return { created: true, email: adminEmail };
  } finally {
    client.release();
  }
}

module.exports = { bootstrapAdmin, DEFAULT_ADMIN_EMAIL };
