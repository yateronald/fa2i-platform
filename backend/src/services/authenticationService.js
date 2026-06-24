'use strict';

const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const usersRepository = require('../db/repositories/usersRepository');
const credentialService = require('./credentialService');

const INVALID_CREDENTIALS_ERROR = 'Invalid credentials';
const TEMPORARILY_UNAVAILABLE_ERROR = 'Authentication is temporarily unavailable';
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_EXPIRY = '30m'; // JWT safety-net expiry

/**
 * Authenticate a user by identifier (email) and password.
 *
 * Returns a uniform "Invalid credentials" error for:
 *   - Unknown identifier
 *   - Wrong password
 *   - Expired temporary password (older than 72 hours)
 *
 * Returns "Account is temporarily locked. Try again in X minutes." while locked (Req 5.3, 5.4).
 *
 * Returns "Authentication is temporarily unavailable" if the account store throws.
 *
 * Uses dependency injection for testability: deps can override repository and credentialService.
 *
 * @param {string} identifier - The user's email/login identifier.
 * @param {string} password - The plaintext password to verify.
 * @param {object} [deps] - Optional dependency overrides for testing.
 * @param {object} [deps.usersRepo] - Override for usersRepository.
 * @param {object} [deps.credential] - Override for credentialService.
 * @param {object} [deps.dbPool] - Override for the database pool.
 * @param {object} [deps.now] - Override for current time (Date instance) for testing.
 * @returns {Promise<{success: boolean, error?: string, user?: object, mustRotatePassword?: boolean}>}
 */
async function authenticate(identifier, password, deps) {
  const repo = (deps && deps.usersRepo) || usersRepository;
  const cred = (deps && deps.credential) || credentialService;
  const dbPool = (deps && deps.dbPool) || pool;
  const now = (deps && deps.now) || new Date();

  let user;
  let client;

  // Attempt to look up the user; if the store is unavailable, fail closed
  try {
    client = await dbPool.connect();
    const emailLower = identifier.toLowerCase().trim();
    user = await repo.findByEmail(client, emailLower);
  } catch (err) {
    // Account store is unavailable (Req 5.7)
    return { success: false, error: TEMPORARILY_UNAVAILABLE_ERROR };
  } finally {
    if (client) {
      client.release();
    }
  }

  // Unknown identifier → non-revealing error (Req 5.2)
  if (!user) {
    return { success: false, error: INVALID_CREDENTIALS_ERROR };
  }

  // Check if the account is currently locked (Req 5.4)
  if (user.locked_until) {
    const lockedUntilTime = new Date(user.locked_until).getTime();
    const nowTime = now.getTime();
    if (lockedUntilTime > nowTime) {
      const minutesRemaining = Math.ceil((lockedUntilTime - nowTime) / 60000);
      return {
        success: false,
        error: `Account is temporarily locked. Try again in ${minutesRemaining} minutes.`,
      };
    }
  }

  // Verify password
  const passwordMatch = await cred.verifyPassword(password, user.password_hash);

  // Wrong password → increment failure count, possibly lock (Req 5.3)
  if (!passwordMatch) {
    const newCount = (user.failed_login_count || 0) + 1;

    // Update the failure count in the database
    let updateClient;
    try {
      updateClient = await dbPool.connect();
      await repo.updateFailedAttempts(updateClient, user.id, newCount);

      // If threshold reached, lock the account for 15 minutes (Req 5.3)
      if (newCount >= LOCKOUT_THRESHOLD) {
        const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
        await repo.updateLockedUntil(updateClient, user.id, lockedUntil);
      }
    } catch (_err) {
      // Best effort — lockout state update failure should not change the auth response
    } finally {
      if (updateClient) {
        updateClient.release();
      }
    }

    return { success: false, error: INVALID_CREDENTIALS_ERROR };
  }

  // Password is correct; check if it's a temporary password
  if (user.is_temporary_password) {
    // Check 72-hour expiry (Req 3.6)
    const expired = cred.isTemporaryExpired(user.temp_password_set_at, now);

    if (expired) {
      // Expired temporary password → non-revealing error (same message)
      return { success: false, error: INVALID_CREDENTIALS_ERROR };
    }

    // Reset failed_login_count on success (Req 5.6)
    let updateClient;
    try {
      updateClient = await dbPool.connect();
      await repo.updateFailedAttempts(updateClient, user.id, 0);
    } catch (_err) {
      // Best effort
    } finally {
      if (updateClient) {
        updateClient.release();
      }
    }

    // Valid temporary password → must rotate (Req 3.7)
    return { success: true, user, mustRotatePassword: true };
  }

  // Password is correct and not temporary → full access
  // Reset failed_login_count on success (Req 5.6)
  let updateClient;
  try {
    updateClient = await dbPool.connect();
    await repo.updateFailedAttempts(updateClient, user.id, 0);
  } catch (_err) {
    // Best effort
  } finally {
    if (updateClient) {
      updateClient.release();
    }
  }

  return { success: true, user, mustRotatePassword: false };
}

/**
 * Establish a session for a successfully authenticated user.
 * Signs a JWT with { userId } using SESSION_SECRET with a 30-minute expiry as a safety net.
 *
 * Also updates last_activity_at to `now` for idle-timeout tracking.
 *
 * @param {string} userId - The authenticated user's ID.
 * @param {object} [deps] - Optional dependency overrides for testing.
 * @param {object} [deps.usersRepo] - Override for usersRepository.
 * @param {object} [deps.dbPool] - Override for the database pool.
 * @param {string} [deps.sessionSecret] - Override for SESSION_SECRET.
 * @param {Date} [deps.now] - Override for current time.
 * @param {function} [deps.signJwt] - Override for jwt.sign.
 * @returns {Promise<string>} The signed JWT session token.
 */
async function establishSession(userId, deps) {
  const repo = (deps && deps.usersRepo) || usersRepository;
  const dbPool = (deps && deps.dbPool) || pool;
  const secret = (deps && deps.sessionSecret) || process.env.SESSION_SECRET;
  const now = (deps && deps.now) || new Date();
  const sign = (deps && deps.signJwt) || jwt.sign;

  // Update last_activity_at to now
  let client;
  try {
    client = await dbPool.connect();
    await repo.updateLastActivity(client, userId, now);
  } finally {
    if (client) {
      client.release();
    }
  }

  // Sign and return the JWT
  const token = sign({ userId }, secret, { expiresIn: SESSION_EXPIRY });
  return token;
}

/**
 * Validate an existing session token.
 * Verifies the JWT, checks last_activity_at from the users table:
 *   - If idle ≥30 minutes, returns { valid: false, expired: true }
 *   - Otherwise updates last_activity_at to `now` and returns { valid: true, userId }
 *
 * @param {string} token - The JWT session token to validate.
 * @param {Date} now - The current instant for idle-timeout computation.
 * @param {object} [deps] - Optional dependency overrides for testing.
 * @param {object} [deps.usersRepo] - Override for usersRepository.
 * @param {object} [deps.dbPool] - Override for the database pool.
 * @param {string} [deps.sessionSecret] - Override for SESSION_SECRET.
 * @param {function} [deps.verifyJwt] - Override for jwt.verify.
 * @returns {Promise<{valid: boolean, userId?: string, expired?: boolean}>}
 */
async function validateSession(token, now, deps) {
  const repo = (deps && deps.usersRepo) || usersRepository;
  const dbPool = (deps && deps.dbPool) || pool;
  const secret = (deps && deps.sessionSecret) || process.env.SESSION_SECRET;
  const verify = (deps && deps.verifyJwt) || jwt.verify;

  // Verify the JWT signature and expiry
  let payload;
  try {
    payload = verify(token, secret);
  } catch (_err) {
    return { valid: false, expired: true };
  }

  const { userId } = payload;
  if (!userId) {
    return { valid: false, expired: true };
  }

  // Look up the user and check last_activity_at for idle timeout
  let client;
  try {
    client = await dbPool.connect();
    const user = await repo.findById(client, userId);

    if (!user) {
      return { valid: false, expired: true };
    }

    // Check idle timeout
    if (user.last_activity_at) {
      const lastActivity = new Date(user.last_activity_at).getTime();
      const nowTime = now.getTime();
      const idleDuration = nowTime - lastActivity;

      if (idleDuration >= SESSION_IDLE_TIMEOUT_MS) {
        return { valid: false, expired: true };
      }
    }

    // Session is valid — refresh last_activity_at
    await repo.updateLastActivity(client, userId, now);

    return { valid: true, userId };
  } catch (_err) {
    return { valid: false, expired: true };
  } finally {
    if (client) {
      client.release();
    }
  }
}

module.exports = {
  authenticate,
  establishSession,
  validateSession,
};
