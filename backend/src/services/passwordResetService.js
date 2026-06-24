'use strict';

/**
 * Password_Reset_Service
 *
 * Implements the "forgot password" flow for ANY account type (members,
 * association users, federation users).
 *
 * Security properties:
 *  - Non-revealing: requestReset always reports success, never disclosing
 *    whether an email is registered.
 *  - Codes are short numeric one-time codes; only a bcrypt HASH is stored.
 *  - Codes expire (RESET_CODE_TTL_MS) and are single-use.
 *  - Per-code attempt limit (MAX_CODE_ATTEMPTS) thwarts code guessing.
 *  - A resend cooldown avoids inbox flooding of a targeted address.
 *  - Only ACTIVE accounts can reset (a disabled account cannot log in anyway).
 */

const crypto = require('node:crypto');
const path = require('path');
const { withTransaction } = require('../db/pool');
const usersRepository = require('../db/repositories/usersRepository');
const associationsRepository = require('../db/repositories/associationsRepository');
const passwordResetRepository = require('../db/repositories/passwordResetRepository');
const credentialService = require('./credentialService');
const emailService = require('./emailService');

const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RESET_CODE_TTL_MIN = 15;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between sends
const CODE_LENGTH = 6;

// Bundled FA2I logo embedded in the default (federation) branded email.
const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'assets', 'fa2i-logo.jpg');

// Generic, non-revealing error returned for every "bad code / unknown user"
// case so the two are indistinguishable to a caller.
const GENERIC_CODE_ERROR = 'Code invalide ou expiré';

/**
 * Generate a cryptographically-random numeric code of CODE_LENGTH digits.
 * @returns {string}
 */
function generateCode() {
  const max = 10 ** CODE_LENGTH;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(CODE_LENGTH, '0');
}

function resolveDeps(deps) {
  return {
    usersRepo: (deps && deps.usersRepository) || usersRepository,
    assocRepo: (deps && deps.associationsRepository) || associationsRepository,
    resetRepo: (deps && deps.passwordResetRepository) || passwordResetRepository,
    cred: (deps && deps.credentialService) || credentialService,
    emailSvc: (deps && deps.emailService) || emailService,
    txRunner: (deps && deps.withTransaction) || withTransaction,
    txOpts: deps && deps.pool ? { pool: deps.pool } : undefined,
    now: (deps && deps.now) || new Date(),
  };
}

/**
 * Build branding (logo + name) for the reset email. Association accounts get
 * their association's logo + name; everyone else gets the bundled FA2I logo.
 */
async function resolveBranding(client, assocRepo, user) {
  if (user.association_id) {
    try {
      const assoc = await assocRepo.findById(client, user.association_id);
      if (assoc) {
        return { logoUrl: assoc.logo_ref || null, brandName: assoc.name || 'FA2I' };
      }
    } catch {
      /* fall through to default */
    }
  }
  return { logoPath: DEFAULT_LOGO_PATH, brandName: 'FA2I' };
}

/**
 * Request a password reset. ALWAYS resolves to { success: true } regardless of
 * whether the email exists (non-revealing). When the email maps to an active
 * account and no recent code was issued, a fresh code is generated, the prior
 * active codes are invalidated, and a branded email with the code is sent.
 *
 * @param {string} email
 * @param {object} [deps]
 * @returns {Promise<{ success: true }>}
 */
async function requestReset(email, deps) {
  const { usersRepo, assocRepo, resetRepo, cred, emailSvc, txRunner, txOpts, now } =
    resolveDeps(deps);

  const emailLower = String(email == null ? '' : email).toLowerCase().trim();
  if (!emailLower) {
    return { success: true };
  }

  // Resolve user + decide whether to send, inside one transaction.
  let sendPayload = null;
  await txRunner(async (client) => {
    const user = await usersRepo.findByEmail(client, emailLower); // active only
    if (!user) return;

    // Resend cooldown: if a code was issued very recently, do not issue another
    // (still report success to the caller).
    const latest = await resetRepo.findLatestActiveByUser(client, user.id);
    if (latest && latest.created_at) {
      const age = now.getTime() - new Date(latest.created_at).getTime();
      if (age < RESEND_COOLDOWN_MS) return;
    }

    const code = generateCode();
    const codeHash = await cred.hashPassword(code);
    const expiresAt = new Date(now.getTime() + RESET_CODE_TTL_MS);

    await resetRepo.invalidateActiveForUser(client, user.id);
    await resetRepo.create(client, { userId: user.id, codeHash, expiresAt });

    const branding = await resolveBranding(client, assocRepo, user);
    sendPayload = {
      accountHolder: user.full_name || user.email,
      identifier: user.email,
      code,
      branding,
    };
  }, txOpts);

  // Send the email AFTER the transaction commits (network I/O outside the tx).
  if (sendPayload) {
    try {
      await emailSvc.sendPasswordReset(sendPayload.accountHolder, sendPayload.identifier, sendPayload.code, {
        ...(deps && deps.emailDeps),
        ttlMinutes: RESET_CODE_TTL_MIN,
        ...sendPayload.branding,
      });
    } catch {
      // Never reveal send failures to the caller (non-revealing).
    }
  }

  return { success: true };
}

/**
 * Reset a password using an emailed code.
 *
 * Returns a generic error for unknown email / wrong / expired code (so the two
 * are indistinguishable). A valid code that is paired with a weak password
 * returns the composition error WITHOUT consuming the code, so the user can
 * retry with a stronger password.
 *
 * @param {string} email
 * @param {string} code
 * @param {string} newPassword
 * @param {object} [deps]
 * @returns {Promise<{ success: true } | { success: false, error: string }>}
 */
async function resetPassword(email, code, newPassword, deps) {
  const { usersRepo, resetRepo, cred, txRunner, txOpts } = resolveDeps(deps);

  const emailLower = String(email == null ? '' : email).toLowerCase().trim();
  const submittedCode = String(code == null ? '' : code).trim();

  if (!emailLower || !submittedCode) {
    return { success: false, error: GENERIC_CODE_ERROR };
  }

  return txRunner(async (client) => {
    const user = await usersRepo.findByEmail(client, emailLower); // active only
    if (!user) {
      return { success: false, error: GENERIC_CODE_ERROR };
    }

    const record = await resetRepo.findLatestActiveByUser(client, user.id);
    if (!record) {
      return { success: false, error: GENERIC_CODE_ERROR };
    }

    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      return {
        success: false,
        error: 'Trop de tentatives. Veuillez demander un nouveau code.',
      };
    }

    const codeMatches = await cred.verifyPassword(submittedCode, record.code_hash);
    if (!codeMatches) {
      await resetRepo.incrementAttempts(client, record.id);
      return { success: false, error: GENERIC_CODE_ERROR };
    }

    // Code is valid — now validate the new password. Do NOT consume the code on
    // a weak password so the user can retry.
    const composition = cred.meetsCompositionRule(newPassword);
    if (!composition.valid) {
      return { success: false, error: composition.error };
    }

    const passwordHash = await cred.hashPassword(newPassword);
    await usersRepo.resetPasswordById(client, user.id, passwordHash);
    await resetRepo.consume(client, record.id);

    return { success: true };
  }, txOpts);
}

module.exports = {
  requestReset,
  resetPassword,
  generateCode,
  RESET_CODE_TTL_MIN,
  MAX_CODE_ATTEMPTS,
};
