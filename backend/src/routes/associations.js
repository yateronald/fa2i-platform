'use strict';

/**
 * Associations routes: registry CRUD + manager assignment.
 *
 * GET    /associations            — list associations (federation roles)
 * GET    /associations/:id        — single association
 * POST   /associations            — create a registry record (super admin)
 * PATCH  /associations/:id        — update a registry record (super admin)
 * DELETE /associations/:id        — delete a registry record (super admin)
 * POST   /associations/:id/manager — assign a president/manager (super admin)
 * GET    /associations/:id/elections — list elections for an association
 *
 * Requirements: 2.1
 */

const { Router } = require('express');
const associationService = require('../services/associationService');

const router = Router();

/**
 * GET /associations
 * Returns all associations (with emblem + has_manager flag).
 * Used by the federation admin management view.
 */
router.get('/', async (req, res) => {
  try {
    if (
      req.user.role !== 'FEDERATION_ADMINISTRATOR' &&
      req.user.role !== 'FEDERATION_ELECTION_MANAGER'
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { pool } = require('../db/pool');
    const associationsRepo = require('../db/repositories/associationsRepository');
    const client = await pool.connect();
    try {
      const associations = await associationsRepo.listWithManagerFlag(client);
      return res.status(200).json({ associations });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /associations/:id/elections
 * Lists elections for an association with computed lifecycle state.
 * Allowed for FEDERATION_ADMINISTRATOR (any association) or the
 * ASSOCIATION_MANAGER of that association.
 */
router.get('/:id/elections', async (req, res) => {
  try {
    const identity = req.user;
    const associationId = req.params.id;
    const isFedAdmin =
      identity.role === 'FEDERATION_ADMINISTRATOR' || identity.role === 'FEDERATION_ELECTION_MANAGER';
    const isOwnManager = identity.role === 'ASSOCIATION_MANAGER' && identity.association_id === associationId;
    if (!isFedAdmin && !isOwnManager) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { pool } = require('../db/pool');
    const schedulingService = require('../services/schedulingService');
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, name, scope, association_id, start_at, end_at, schedule_timezone, created_at
         FROM elections WHERE association_id = $1 ORDER BY created_at DESC`,
        [associationId]
      );
      const now = new Date();
      const elections = rows.map((e) => ({ ...e, state: schedulingService.computeState(e, now) }));
      return res.status(200).json({ elections });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /associations/:id
 * Returns a single association by ID (with emblem).
 */
router.get('/:id', async (req, res) => {
  try {
    const u = req.user;
    const allowed =
      u.role === 'FEDERATION_ADMINISTRATOR' ||
      u.role === 'FEDERATION_ELECTION_MANAGER' ||
      (u.role === 'ASSOCIATION_MANAGER' && u.association_id === req.params.id);
    if (!allowed) return res.status(403).json({ error: 'Access denied' });

    const { pool } = require('../db/pool');
    const associationsRepo = require('../db/repositories/associationsRepository');
    const client = await pool.connect();
    try {
      const association = await associationsRepo.findById(client, req.params.id);
      if (!association) {
        return res.status(404).json({ error: 'Association not found' });
      }
      return res.status(200).json({ association });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /associations
 * Body: { name, emblem, logo }
 * Authorization: FEDERATION_ADMINISTRATOR (also enforced by authorize middleware at mount).
 */
router.post('/', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'FEDERATION_ADMINISTRATOR') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { name, emblem, logo } = req.body;

    const result = await associationService.createRegistryAssociation({ name, emblem, logo });

    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      return res.status(400).json({ error: result.error });
    }

    return res.status(201).json({ success: true, association: result.association });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /associations/:id
 * Body: { name, emblem, presidentName?, presidentEmail?, logo? }
 * Authorization: FEDERATION_ADMINISTRATOR only.
 */
router.patch('/:id', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'FEDERATION_ADMINISTRATOR') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { name, emblem, presidentName, presidentEmail, logo } = req.body;
    const result = await associationService.updateAssociation(req.params.id, {
      name,
      emblem,
      presidentName,
      presidentEmail,
      logo,
    });
    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json({ success: true, association: result.association });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /associations/:id
 * Authorization: FEDERATION_ADMINISTRATOR only.
 */
router.delete('/:id', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'FEDERATION_ADMINISTRATOR') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await associationService.deleteRegistryAssociation(req.params.id);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /associations/:id/manager
 * Body: { presidentName, presidentEmail }
 * Authorization: FEDERATION_ADMINISTRATOR only.
 */
router.post('/:id/manager', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'FEDERATION_ADMINISTRATOR') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { presidentName, presidentEmail } = req.body;
    const result = await associationService.assignManager(req.params.id, { presidentName, presidentEmail });
    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      // Conflict for "already has a manager"; otherwise a 400 validation/lookup error.
      const status = result.error === 'Cette association a déjà un gestionnaire' ? 409 : 400;
      return res.status(status).json({ error: result.error });
    }
    return res.status(201).json({ success: true, association: result.association });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
