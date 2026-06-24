'use strict';

/**
 * Results routes: election dashboard retrieval.
 *
 * GET /elections/:id/results — get election dashboard/results
 *
 * Requirements: 16.2
 */

const { Router } = require('express');
const resultService = require('../services/resultService');

const router = Router();

/**
 * GET /elections/:id/results
 * Returns per-position results and aggregate dashboard data for the election.
 * Authorization is enforced within the service (managers, federation admins,
 * participants after close).
 */
router.get('/:id/results', async (req, res) => {
  try {
    const identity = req.user;
    const electionId = req.params.id;

    const result = await resultService.getDashboard(identity, electionId);

    if (!result.success) {
      if (result.error === 'Access denied') {
        return res.status(403).json({ error: result.error });
      }
      return res.status(404).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      dashboard: result.dashboard,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
