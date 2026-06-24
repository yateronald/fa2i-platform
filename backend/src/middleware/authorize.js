'use strict';

/**
 * Authorization middleware factory.
 *
 * Enforces role/scope checks before controller logic using the
 * Access_Control_Service decision functions. Returns a uniform 403
 * response that discloses no protected data on denial.
 *
 * Usage:
 *   authorize('FEDERATION_ADMINISTRATOR')
 *   authorize({ role: 'ASSOCIATION_MANAGER', scope: 'ASSOCIATION' })
 *   authorize({ checkFn: (identity) => someDecision(identity) })
 *
 * Expects `req.user` to be set by the session middleware (requireSession)
 * with shape: { id, role, association_id, ... }
 *
 * Requirements: 1.1, 1.2, 6.6, 19.2, 19.3
 */

const accessControlService = require('../services/accessControlService');

/**
 * Create an Express middleware that enforces authorization.
 *
 * @param {string|object} config - A required role string, or an object:
 *   - role {string} - Required role (e.g. 'FEDERATION_ADMINISTRATOR')
 *   - scope {string} - Optional scope ('FEDERATION' or 'ASSOCIATION')
 *   - checkFn {function} - Optional custom check function receiving (req.user, req)
 * @returns {function} Express middleware (req, res, next)
 */
function authorize(config) {
  return function authorizeMiddleware(req, res, next) {
    const identity = req.user;

    // If no user is attached, deny immediately (session middleware should have handled this)
    if (!identity) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Normalize config
    const opts = typeof config === 'string' ? { role: config } : config || {};

    // If a custom check function is provided, use it
    if (typeof opts.checkFn === 'function') {
      const allowed = opts.checkFn(identity, req);
      if (!allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return next();
    }

    // Role check
    if (opts.role) {
      if (identity.role !== opts.role) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Scope check: for ASSOCIATION scope, ensure the user is accessing their own association
    if (opts.scope === 'ASSOCIATION') {
      // The target association can come from route params or request body
      const targetAssociationId =
        (req.params && req.params.associationId) ||
        (req.body && req.body.association_id);

      if (targetAssociationId) {
        try {
          accessControlService.assertSameAssociation(identity, targetAssociationId);
        } catch (err) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
    }

    next();
  };
}

module.exports = authorize;
