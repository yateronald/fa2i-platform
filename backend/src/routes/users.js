'use strict';

/**
 * Users routes: federation user management.
 *
 * GET /users — list federation users
 * POST /users — create a federation user
 * PATCH /users/:id — update isActive and/or role (cannot modify self)
 * DELETE /users/:id — delete a federation user (cannot delete self)
 *
 * All routes are federation-admin-only (enforced at mount in app.js via authorize).
 */

const { Router } = require('express');
const userService = require('../services/userService');

const router = Router();

// GET /users — list federation users
router.get('/', async (req, res) => {
  try {
    const { pool } = require('../db/pool');
    const usersRepository = require('../db/repositories/usersRepository');
    const client = await pool.connect();
    try {
      const users = await usersRepository.listFederationUsers(client);
      return res.status(200).json({ users });
    } finally { client.release(); }
  } catch (err) { return res.status(500).json({ error: 'Internal server error' }); }
});

// POST /users — create a federation user
router.post('/', async (req, res) => {
  try {
    const { email, role } = req.body;
    const result = await userService.createFederationUser({ email, role });
    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      return res.status(400).json({ error: result.error });
    }
    return res.status(201).json({ success: true, user: result.user });
  } catch (err) { return res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /users/:id — update isActive and/or role (cannot modify self)
router.patch('/:id', async (req, res) => {
  try {
    if (req.user && req.user.id === req.params.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre compte' });
    }
    const { isActive, role } = req.body;
    const { pool } = require('../db/pool');
    const usersRepository = require('../db/repositories/usersRepository');
    const client = await pool.connect();
    try {
      const target = await usersRepository.findByIdAny(client, req.params.id);
      if (!target || target.association_id !== null) {
        return res.status(404).json({ error: 'Utilisateur introuvable' });
      }
      let updated = target;
      if (typeof isActive === 'boolean') {
        updated = await usersRepository.setActive(client, req.params.id, isActive);
      }
      if (role && ['FEDERATION_ADMINISTRATOR', 'FEDERATION_ELECTION_MANAGER'].includes(role)) {
        updated = await usersRepository.updateRole(client, req.params.id, role);
      }
      return res.status(200).json({ success: true, user: updated });
    } finally { client.release(); }
  } catch (err) { return res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /users/:id — delete a federation user (cannot delete self)
router.delete('/:id', async (req, res) => {
  try {
    if (req.user && req.user.id === req.params.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }
    const { pool } = require('../db/pool');
    const usersRepository = require('../db/repositories/usersRepository');
    const client = await pool.connect();
    try {
      const target = await usersRepository.findByIdAny(client, req.params.id);
      if (!target || target.association_id !== null) {
        return res.status(404).json({ error: 'Utilisateur introuvable' });
      }
      await usersRepository.deleteById(client, req.params.id);
      return res.status(200).json({ success: true });
    } finally { client.release(); }
  } catch (err) { return res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
