'use strict';

/**
 * Session middleware with forced-rotation gating.
 *
 * Validates the session cookie (or Authorization Bearer token), enforces idle
 * timeout via authenticationService.validateSession, looks up the user, attaches
 * them to req.user, and blocks access for users whose password is still temporary
 * (except for the password-change route).
 *
 * Uses dependency injection for testability.
 *
 * Requirements: 4.1, 3.7, 5.5
 */

const authenticationService = require('../services/authenticationService');
const usersRepository = require('../db/repositories/usersRepository');
const { pool } = require('../db/pool');

/** Paths that temporary-password users are allowed to access */
const PASSWORD_CHANGE_PATHS = ['/auth/change-password'];

/**
 * Create the requireSession middleware.
 *
 * @param {object} [deps] - Optional dependency overrides for testing.
 * @param {object} [deps.authService] - Override for authenticationService.
 * @param {object} [deps.usersRepo] - Override for usersRepository.
 * @param {object} [deps.dbPool] - Override for the database pool.
 * @param {function} [deps.getNow] - Override for current time factory.
 * @param {string[]} [deps.passwordChangePaths] - Override allowed paths for temp-password users.
 * @returns {function} Express middleware (req, res, next)
 */
function createRequireSession(deps) {
  const authService = (deps && deps.authService) || authenticationService;
  const usersRepo = (deps && deps.usersRepo) || usersRepository;
  const dbPool = (deps && deps.dbPool) || pool;
  const getNow = (deps && deps.getNow) || (() => new Date());
  const allowedPaths = (deps && deps.passwordChangePaths) || PASSWORD_CHANGE_PATHS;

  return async function requireSession(req, res, next) {
    // 1. Extract the session token from cookie or Authorization header
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        error: 'Session expired or invalid',
        mustReauthenticate: true,
      });
    }

    // 2. Validate the session (checks JWT + idle timeout)
    const now = getNow();
    const sessionResult = await authService.validateSession(token, now);

    if (!sessionResult.valid) {
      return res.status(401).json({
        error: 'Session expired or invalid',
        mustReauthenticate: true,
      });
    }

    // 3. Look up the full user record and attach to req.user
    let client;
    let user;
    try {
      client = await dbPool.connect();
      user = await usersRepo.findById(client, sessionResult.userId);
    } catch (_err) {
      return res.status(401).json({
        error: 'Session expired or invalid',
        mustReauthenticate: true,
      });
    } finally {
      if (client) {
        client.release();
      }
    }

    if (!user) {
      return res.status(401).json({
        error: 'Session expired or invalid',
        mustReauthenticate: true,
      });
    }

    req.user = user;

    // 4. Forced password rotation gating (Req 4.1, 3.7)
    if (user.is_temporary_password) {
      const requestPath = req.originalUrl || req.path || '';
      const isPasswordChangeRoute = allowedPaths.some(
        (allowed) => requestPath === allowed || requestPath.startsWith(allowed + '?')
      );

      if (!isPasswordChangeRoute) {
        return res.status(403).json({
          error: 'Password change required',
          mustRotatePassword: true,
        });
      }
    }

    // 5. All checks pass
    next();
  };
}

/**
 * Extract the session token from the request.
 * Looks in:
 *   1. req.cookies.session (cookie-parser middleware)
 *   2. Authorization: Bearer <token> header
 *
 * @param {object} req - Express request
 * @returns {string|null}
 */
function extractToken(req) {
  // Try cookie first
  if (req.cookies && req.cookies.session) {
    return req.cookies.session;
  }

  // Try Authorization header
  const authHeader = req.headers && req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

module.exports = createRequireSession;
module.exports.extractToken = extractToken;
