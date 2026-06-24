'use strict';

/**
 * Federation elections routes.
 *
 * GET /federation-elections — lists federation elections that an association
 * manager (or federation roles) can contribute voters to. For association
 * managers, attaches how many voters they've already registered per election.
 */

const { Router } = require('express');
const router = Router();

// GET /federation-elections — federation elections an association manager can add voters to
router.get('/', async (req, res) => {
  try {
    const identity = req.user;
    const allowed = ['FEDERATION_ADMINISTRATOR', 'FEDERATION_ELECTION_MANAGER', 'ASSOCIATION_MANAGER', 'ASSOCIATION_ELECTION_MANAGER'].includes(identity.role);
    if (!allowed) return res.status(403).json({ error: 'Access denied' });
    const { pool } = require('../db/pool');
    const schedulingService = require('../services/schedulingService');
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, name, scope, start_at, end_at, schedule_timezone, voters_per_association, created_at
         FROM elections WHERE scope = 'FEDERATION' ORDER BY created_at DESC`
      );
      const now = new Date();
      let result = rows.map((e) => ({ ...e, state: schedulingService.computeState(e, now) }));
      // For association-scoped callers, attach how many voters they've already registered for each election
      if (
        identity.association_id &&
        (identity.role === 'ASSOCIATION_MANAGER' || identity.role === 'ASSOCIATION_ELECTION_MANAGER')
      ) {
        const counts = await client.query(
          `SELECT p.election_id, COUNT(*)::int AS used
           FROM participants p JOIN users u ON u.id = p.user_id
           WHERE u.association_id = $1 GROUP BY p.election_id`,
          [identity.association_id]
        );
        const map = {};
        for (const r of counts.rows) map[r.election_id] = r.used;
        result = result.map((e) => ({ ...e, usedByAssociation: map[e.id] || 0 }));
      }
      return res.status(200).json({ elections: result });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /federation-elections/:id/my-voters — caller's own association's voters for a federation election
router.get('/:id/my-voters', async (req, res) => {
  try {
    const identity = req.user;
    const accessControlService = require('../services/accessControlService');
    const { pool } = require('../db/pool');
    const client = await pool.connect();
    try {
      const { rows: electionRows } = await client.query(
        `SELECT id, name, scope, association_id FROM elections WHERE id = $1`,
        [req.params.id]
      );
      const election = electionRows[0];
      if (!election || election.scope !== 'FEDERATION') {
        return res.status(404).json({ error: 'Election not found' });
      }

      if (!identity.association_id || !accessControlService.canAddFederationVoters(identity, election)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { rows } = await client.query(
        `SELECT p.user_id, p.added_at, u.email, u.full_name
         FROM participants p
         JOIN users u ON u.id = p.user_id
         WHERE p.election_id = $1 AND u.association_id = $2
         ORDER BY p.added_at DESC`,
        [req.params.id, identity.association_id]
      );
      return res.status(200).json({ voters: rows });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;