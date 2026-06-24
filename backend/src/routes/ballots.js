'use strict';

/**
 * Ballots routes: per-position vote casting.
 *
 * POST /elections/:id/positions/:positionId/vote — cast a vote for one candidate
 *
 * Requirements: 14.2
 */

const { Router } = require('express');
const voteService = require('../services/voteService');
const router = Router();

// POST /elections/:id/positions/:positionId/vote  body: { candidateId }
router.post('/:id/positions/:positionId/vote', async (req, res) => {
  try {
    const identity = req.user;
    const { candidateId } = req.body;
    if (!candidateId) return res.status(400).json({ error: 'candidateId est requis' });

    const result = await voteService.castPositionVote(identity, req.params.positionId, candidateId);
    if (!result.success) {
      const msg = result.error || '';
      let status = 400;
      if (msg.includes('éligible')) status = 403;
      else if (msg.includes('déjà voté')) status = 409;
      return res.status(status).json({ error: result.error });
    }
    return res.status(200).json({ success: true, recorded: result.recorded, confirmedAt: result.confirmedAt });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
