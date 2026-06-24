'use strict';

/**
 * Association users routes: an association president manages their own
 * association's sub-users.
 *
 * GET    /association-users      — list the association's management sub-users
 * POST   /association-users      — create a sub-user
 * PATCH  /association-users/:id  — update role/flag and/or active state
 * DELETE /association-users/:id  — delete a sub-user
 *
 * All routes require canManageAssociationUsers: a FEDERATION_ADMINISTRATOR
 * (who supplies the target associationId) or an ASSOCIATION_MANAGER with an
 * association_id (locked to their own association). Mounted behind
 * requireSession in app.js.
 */

const { Router } = require('express');
const associationUserService = require('../services/associationUserService');
const accessControlService = require('../services/accessControlService');

const router = Router();

/**
 * Map a service "not found / cross-association" outcome to 404, otherwise 400.
 */
function failureStatus(error) {
  if (error === 'Utilisateur introuvable') return 404;
  if (error === 'Association introuvable') return 404;
  if (error === 'Association requise') return 400;
  if (error === 'Cet email est déjà utilisé par un compte de gestion') return 409;
  if (error === 'Accès refusé') return 403;
  return 400;
}

// GET /association-users — list the association's management sub-users
router.get('/', async (req, res) => {
  try {
    if (!accessControlService.canManageAssociationUsers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await associationUserService.listAssociationUsers(req.user, req.query.associationId);
    if (!result.success) {
      return res.status(failureStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ users: result.users });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /association-users — create a sub-user
router.post('/', async (req, res) => {
  try {
    if (!accessControlService.canManageAssociationUsers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { email, fullName, role, canAddFederationVoters, associationId } = req.body;
    const result = await associationUserService.createAssociationUser(req.user, {
      email,
      fullName,
      role,
      canAddFederationVoters,
      associationId,
    });
    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      return res.status(failureStatus(result.error)).json({ error: result.error });
    }
    return res.status(201).json({ success: true, user: result.user });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /association-users/:id — update role/flag and/or active state
router.patch('/:id', async (req, res) => {
  try {
    if (!accessControlService.canManageAssociationUsers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { role, canAddFederationVoters, isActive } = req.body;
    let user;

    if (role !== undefined) {
      const result = await associationUserService.updateAssociationUserRole(req.user, req.params.id, {
        role,
        canAddFederationVoters,
      });
      if (!result.success) {
        if (result.errors) return res.status(400).json({ errors: result.errors });
        return res.status(failureStatus(result.error)).json({ error: result.error });
      }
      user = result.user;
    }

    if (typeof isActive === 'boolean') {
      const result = await associationUserService.setAssociationUserActive(
        req.user,
        req.params.id,
        isActive
      );
      if (!result.success) {
        return res.status(failureStatus(result.error)).json({ error: result.error });
      }
      user = result.user;
    }

    if (!user) {
      return res.status(400).json({ error: 'Aucune modification fournie' });
    }
    return res.status(200).json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /association-users/:id — delete a sub-user
router.delete('/:id', async (req, res) => {
  try {
    if (!accessControlService.canManageAssociationUsers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await associationUserService.deleteAssociationUser(req.user, req.params.id);
    if (!result.success) {
      return res.status(failureStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
