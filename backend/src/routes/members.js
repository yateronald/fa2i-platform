'use strict';

/**
 * Members routes: an association manager (or an election manager granted the
 * can_manage_members flag) manages their own association's member roster.
 *
 * GET    /members          — list the association's members
 * POST   /members          — add a single member
 * POST   /members/bulk     — add multiple members
 * DELETE /members/:userId  — remove a member (unlink only; account preserved)
 *
 * All routes require canManageMembers. Membership is association-only; the
 * caller always acts on their own association. Mounted behind requireSession
 * in app.js.
 */

const { Router } = require('express');
const membersService = require('../services/membersService');
const accessControlService = require('../services/accessControlService');

const router = Router();

/**
 * Map a service failure outcome to an HTTP status.
 */
function failureStatus(error) {
  if (error === 'Membre introuvable') return 404;
  if (error === 'Cet email est déjà utilisé') return 409;
  if (error === 'Cette personne est déjà membre') return 409;
  if (error === 'Accès refusé') return 403;
  if (error === 'Aucune modification fournie') return 400;
  return 400;
}

// GET /members — list the association's members
router.get('/', async (req, res) => {
  try {
    if (!accessControlService.canManageMembers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await membersService.listMembers(req.user);
    if (!result.success) {
      return res.status(failureStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ members: result.members });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /members — add a single member
router.post('/', async (req, res) => {
  try {
    if (!accessControlService.canManageMembers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { email, fullName, phone } = req.body;
    const result = await membersService.addMember(req.user, { email, fullName, phone });
    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      return res.status(failureStatus(result.error)).json({ error: result.error });
    }
    return res.status(201).json({
      member: result.member,
      created: result.created,
      existingAccount: result.existingAccount,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /members/bulk — add multiple members
router.post('/bulk', async (req, res) => {
  try {
    if (!accessControlService.canManageMembers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { members } = req.body;
    if (!Array.isArray(members)) {
      return res.status(400).json({ error: 'members must be an array' });
    }
    const result = await membersService.bulkAddMembers(req.user, members);
    if (!result.success) {
      return res.status(failureStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ summary: result.summary });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /members/:userId — modify a member (name/email) or toggle active state
router.patch('/:userId', async (req, res) => {
  try {
    if (!accessControlService.canManageMembers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { fullName, email, phone, isActive } = req.body || {};

    let result;
    if (typeof isActive === 'boolean') {
      result = await membersService.setMemberActive(req.user, req.params.userId, isActive);
    } else if (fullName !== undefined || email !== undefined || phone !== undefined) {
      result = await membersService.updateMember(req.user, req.params.userId, { fullName, email, phone });
    } else {
      return res.status(400).json({ error: 'Aucune modification fournie' });
    }

    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      return res.status(failureStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ success: true, member: result.member });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /members/:userId — remove a member (unlink only)
router.delete('/:userId', async (req, res) => {
  try {
    if (!accessControlService.canManageMembers(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await membersService.removeMember(req.user, req.params.userId);
    if (!result.success) {
      return res.status(failureStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
