'use strict';

/**
 * Elections routes: CRUD for elections and sub-resources.
 *
 * POST /elections — create an election
 * GET /elections — list elections
 * GET /elections/:id — get a specific election
 * POST /elections/:id/participating-associations — add participating association
 * POST /elections/:id/positions — add a position
 * GET /elections/:id/positions — list positions
 * POST /elections/:id/positions/:positionId/candidates — add a candidate
 * GET /elections/:id/positions/:positionId/candidates — list candidates
 * POST /elections/:id/participants — add a participant
 * POST /elections/:id/participants/bulk — add multiple participants
 * GET /elections/:id/participants — list participants
 *
 * Requirements: 7.2, 7.3, 8.6, 10.1, 13.1
 */

const { Router } = require('express');
const electionService = require('../services/electionService');
const accessControlService = require('../services/accessControlService');

const router = Router();

/**
 * Load an election by ID using a pooled client.
 * @param {string} electionId
 * @returns {Promise<object|null>}
 */
async function loadElection(electionId) {
  const { pool } = require('../db/pool');
  const electionsRepository = require('../db/repositories/electionsRepository');
  const client = await pool.connect();
  try {
    return await electionsRepository.findById(client, electionId);
  } finally {
    client.release();
  }
}

/**
 * Load a candidate by ID using a pooled client.
 * @param {string} candidateId
 * @returns {Promise<object|null>}
 */
async function loadCandidate(candidateId) {
  const { pool } = require('../db/pool');
  const candidatesRepository = require('../db/repositories/candidatesRepository');
  const client = await pool.connect();
  try {
    return await candidatesRepository.findById(client, candidateId);
  } finally {
    client.release();
  }
}

/**
 * True iff the user is a participant of the given election.
 * @param {string} electionId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isParticipant(electionId, userId) {
  const { pool } = require('../db/pool');
  const participantsRepository = require('../db/repositories/participantsRepository');
  const client = await pool.connect();
  try {
    const p = await participantsRepository.findByElectionAndUser(client, electionId, userId);
    return !!p;
  } finally {
    client.release();
  }
}

/**
 * GET /elections
 * Lists elections based on the caller's role:
 * - FEDERATION_ADMINISTRATOR: all federation elections
 * - ASSOCIATION_MANAGER: elections for their association
 * - VOTER: elections where they are a participant
 */
router.get('/', async (req, res) => {
  try {
    const identity = req.user;
    const { pool } = require('../db/pool');
    const client = await pool.connect();
    try {
      let rows;
      if (identity.role === 'FEDERATION_ADMINISTRATOR' || identity.role === 'FEDERATION_ELECTION_MANAGER') {
        const result = await client.query(
          `SELECT e.id, e.name, e.scope, e.association_id, e.start_at, e.end_at, e.schedule_timezone, e.created_at,
                  a.name AS association_name, a.logo_ref AS association_logo
           FROM elections e
           LEFT JOIN associations a ON a.id = e.association_id
           WHERE e.scope = 'FEDERATION' ORDER BY e.created_at DESC`
        );
        rows = result.rows;
      } else if (identity.role === 'ASSOCIATION_MANAGER' || identity.role === 'ASSOCIATION_ELECTION_MANAGER') {
        const result = await client.query(
          `SELECT e.id, e.name, e.scope, e.association_id, e.start_at, e.end_at, e.schedule_timezone, e.created_at,
                  a.name AS association_name, a.logo_ref AS association_logo
           FROM elections e
           LEFT JOIN associations a ON a.id = e.association_id
           WHERE e.association_id = $1 ORDER BY e.created_at DESC`,
          [identity.association_id]
        );
        rows = result.rows;
      } else {
        // VOTER: elections where they are a participant
        const result = await client.query(
          `SELECT e.id, e.name, e.scope, e.association_id, e.start_at, e.end_at, e.schedule_timezone, e.created_at,
                  a.name AS association_name, a.logo_ref AS association_logo
           FROM elections e
           INNER JOIN participants p ON p.election_id = e.id
           LEFT JOIN associations a ON a.id = e.association_id
           WHERE p.user_id = $1
           ORDER BY e.created_at DESC`,
          [identity.id]
        );
        rows = result.rows;
      }

      // Compute state (Open/Closed) for each election
      const schedulingService = require('../services/schedulingService');
      const now = new Date();
      const elections = rows.map((election) => ({
        ...election,
        state: schedulingService.computeState(election, now),
      }));

      return res.status(200).json({ elections });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /elections/:id
 * Returns a single election with its computed state (Open/Closed).
 */
router.get('/:id', async (req, res) => {
  try {
    const identity = req.user;
    const { pool } = require('../db/pool');
    const electionsRepository = require('../db/repositories/electionsRepository');
    const schedulingService = require('../services/schedulingService');
    const client = await pool.connect();
    try {
      const election = await electionsRepository.findById(client, req.params.id);
      if (!election) return res.status(404).json({ error: 'Election not found' });

      const allowed =
        accessControlService.canManageElection(identity, election) ||
        (await isParticipant(req.params.id, identity.id));
      if (!allowed) return res.status(403).json({ error: 'Access denied' });

      // Attach association name + logo (federation elections have no association → null)
      let association_name = null;
      let association_logo = null;
      if (election.association_id) {
        const associationsRepository = require('../db/repositories/associationsRepository');
        const association = await associationsRepository.findById(client, election.association_id);
        if (association) {
          association_name = association.name;
          association_logo = association.logo_ref;
        }
      }

      const state = schedulingService.computeState(election, new Date());
      return res.status(200).json({ election: { ...election, association_name, association_logo, state } });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /elections/:id/positions
 * Lists positions for an election.
 */
router.get('/:id/positions', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const allowed =
      accessControlService.canManageElection(identity, election) ||
      (await isParticipant(req.params.id, identity.id));
    if (!allowed) return res.status(403).json({ error: 'Access denied' });

    const { pool } = require('../db/pool');
    const positionsRepository = require('../db/repositories/positionsRepository');
    const schedulingService = require('../services/schedulingService');
    const client = await pool.connect();
    try {
      const positions = await positionsRepository.findByElection(client, req.params.id);
      const now = new Date();

      // Determine which positions the calling user has already voted in.
      const votedResult = await client.query(
        'SELECT position_id FROM voter_voted_position WHERE user_id = $1 AND election_id = $2',
        [identity.id, req.params.id]
      );
      const votedSet = new Set(votedResult.rows.map((r) => r.position_id));

      // Optionally attach candidates in a SINGLE batched query (avoids the
      // N+1 pattern of one request per position). Enabled via ?include=candidates.
      let candidatesByPosition = null;
      const include = String(req.query.include || '');
      if (include.split(',').includes('candidates')) {
        const candidatesRepository = require('../db/repositories/candidatesRepository');
        const ids = positions.map((p) => p.id);
        const allCandidates = await candidatesRepository.findByPositions(client, ids);
        candidatesByPosition = new Map();
        for (const cand of allCandidates) {
          if (!candidatesByPosition.has(cand.position_id)) {
            candidatesByPosition.set(cand.position_id, []);
          }
          candidatesByPosition.get(cand.position_id).push(cand);
        }
      }

      const withState = positions.map((p) => ({
        ...p,
        state: schedulingService.computePositionState(p, now),
        has_voted: votedSet.has(p.id),
        ...(candidatesByPosition
          ? { candidates: candidatesByPosition.get(p.id) || [] }
          : {}),
      }));
      return res.status(200).json({ positions: withState });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /elections/:id/positions/:positionId/candidates
 * Lists candidates for a position.
 */
router.get('/:id/positions/:positionId/candidates', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const allowed =
      accessControlService.canManageElection(identity, election) ||
      (await isParticipant(req.params.id, identity.id));
    if (!allowed) return res.status(403).json({ error: 'Access denied' });

    const { pool } = require('../db/pool');
    const candidatesRepository = require('../db/repositories/candidatesRepository');
    const client = await pool.connect();
    try {
      const candidates = await candidatesRepository.findByPosition(client, req.params.positionId);
      return res.status(200).json({ candidates });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /elections/:id/positions/:positionId/result
 * Per-position results. Managers may view anytime; participants only once the
 * position is CLOSED. Denials disclose no counts.
 */
router.get('/:id/positions/:positionId/result', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const { pool } = require('../db/pool');
    const positionsRepository = require('../db/repositories/positionsRepository');
    const schedulingService = require('../services/schedulingService');
    const resultService = require('../services/resultService');

    const client = await pool.connect();
    let position;
    try {
      position = await positionsRepository.findById(client, req.params.positionId);
    } finally {
      client.release();
    }
    if (!position || position.election_id !== req.params.id) {
      return res.status(404).json({ error: 'Position not found' });
    }

    const participant = await isParticipant(req.params.id, identity.id);
    const positionState = schedulingService.computePositionState(position, new Date());

    const allowed = accessControlService.canViewPositionResult(identity, election, {
      isParticipant: participant,
      positionState,
    });
    if (!allowed) return res.status(403).json({ error: 'Access denied' });

    const result = await resultService.getPositionResult(req.params.positionId);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      result: {
        ...result.result,
        name: position.name,
        state: positionState,
        start_at: position.start_at,
        end_at: position.end_at,
        schedule_timezone: position.schedule_timezone,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /elections/:id/participants
 * Lists participants for an election, joined with user email/role.
 */
router.get('/:id/participants', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (!accessControlService.canManageElection(identity, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { pool } = require('../db/pool');
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT p.user_id, p.added_at, u.email, u.full_name, u.role, a.name AS association_name
         FROM participants p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN associations a ON a.id = u.association_id
         WHERE p.election_id = $1
         ORDER BY p.added_at DESC`,
        [req.params.id]
      );
      return res.status(200).json({ participants: rows });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections
 * Body: { name, start, end }
 * Creates a federation or association election depending on caller's role.
 */
router.post('/', async (req, res) => {
  try {
    const identity = req.user;
    const { name, start, end, timezone, votersPerAssociation } = req.body;

    let result;
    if (identity.role === 'FEDERATION_ADMINISTRATOR' || identity.role === 'FEDERATION_ELECTION_MANAGER') {
      result = await electionService.createFederationElection(identity, { name, start, end, timezone, votersPerAssociation });
    } else if (accessControlService.canCreateAssociationElection(identity)) {
      result = await electionService.createAssociationElection(identity, { name, start, end, timezone });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!result.success) {
      return res.status(400).json({ errors: result.errors });
    }

    return res.status(201).json({
      success: true,
      election: result.election,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections/:id/participating-associations
 * Body: { associationId }
 * Only FEDERATION_ADMINISTRATOR can add participating associations.
 */
router.post('/:id/participating-associations', async (req, res) => {
  try {
    const identity = req.user;

    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (election.scope !== 'FEDERATION' || !accessControlService.canManageFederationElection(identity)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { associationId } = req.body;
    if (!associationId) {
      return res.status(400).json({ error: 'associationId is required' });
    }

    const result = await electionService.addParticipatingAssociation(req.params.id, associationId);

    if (!result.success) {
      return res.status(409).json({ error: result.error });
    }

    return res.status(201).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections/:id/positions
 * Body: { name }
 * Creates a DRAFT position (name only). The voting window is set later via publish.
 */
router.post('/:id/positions', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (!accessControlService.canManageElection(identity, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name } = req.body;
    const result = await electionService.addPosition(req.params.id, { name });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(201).json({
      success: true,
      position: result.position,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections/:id/positions/:positionId/publish
 * Body: { start, end, timezone }
 * Publishes a DRAFT position by setting its voting window and locking candidates.
 */
router.post('/:id/positions/:positionId/publish', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (!accessControlService.canManageElection(identity, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Ensure the position exists and belongs to this election.
    const { pool } = require('../db/pool');
    const positionsRepository = require('../db/repositories/positionsRepository');
    const client = await pool.connect();
    let position;
    try {
      position = await positionsRepository.findById(client, req.params.positionId);
    } finally {
      client.release();
    }
    if (!position || position.election_id !== req.params.id) {
      return res.status(404).json({ error: 'Position not found' });
    }

    const { start, end, timezone } = req.body;
    const result = await electionService.publishPosition(req.params.positionId, { start, end, timezone });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      position: result.position,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections/:id/positions/:positionId/candidates
 * Body: { name, photo, motivation, photoMimeType, photoSize }
 */
router.post('/:id/positions/:positionId/candidates', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (!accessControlService.canManageElection(identity, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, photo, motivation, photoMimeType, photoSize } = req.body;

    const result = await electionService.addCandidate(req.params.positionId, {
      name,
      photo,
      motivation,
      photoMimeType,
      photoSize,
      createdBy: identity.id,
    });

    if (!result.success) {
      if (result.errors) {
        return res.status(400).json({ errors: result.errors });
      }
      return res.status(400).json({ error: result.error });
    }

    return res.status(201).json({
      success: true,
      candidate: result.candidate,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections/:id/participants
 * Body: { email, fullName, associationId }
 * Allowed for both federation and association elections. Authorization is
 * canManageElection (federation roles for federation elections; the association
 * manager for association elections).
 */
router.post('/:id/participants', async (req, res) => {
  try {
    const identity = req.user;

    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (
      !accessControlService.canManageElection(identity, election) &&
      !accessControlService.canAddFederationVoters(identity, election)
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Association elections: participants may ONLY be added from the member
    // roster. Manual single-add is reserved for federation elections.
    if (election.scope === 'ASSOCIATION') {
      return res.status(403).json({
        error: "Les participants d'une élection d'association doivent être ajoutés depuis les membres.",
      });
    }

    const { email, fullName, associationId } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const result = await electionService.addParticipant(
      election,
      { email, fullName, associationId },
      identity
    );

    if (!result.success) {
      const status = result.error === 'The user is already a participant of this election' ? 409 : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.status(201).json({
      success: true,
      participant: result.participant,
      created: result.created,
      existingAccount: result.existingAccount,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections/:id/participants/validate
 * Body: { participants: [{ fullName, email, associationId? }] }
 * Server-side validation preview (read-only). Management-only.
 */
router.post('/:id/participants/validate', async (req, res) => {
  try {
    const identity = req.user;

    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (
      !accessControlService.canManageElection(identity, election) &&
      !accessControlService.canAddFederationVoters(identity, election)
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Association elections: bulk validation preview is reserved for federation
    // (CSV/manual import). Association rosters come from members.
    if (election.scope === 'ASSOCIATION') {
      return res.status(403).json({
        error: "Les participants d'une élection d'association doivent être ajoutés depuis les membres.",
      });
    }

    const { participants } = req.body;
    const rows = Array.isArray(participants) ? participants : [];

    const result = await electionService.validateParticipants(election, rows, identity);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections/:id/participants/bulk
 * Body: { participants: [{ fullName, email, associationId? }] }
 * Adds multiple participants in one request. Management-only.
 */
router.post('/:id/participants/bulk', async (req, res) => {
  try {
    const identity = req.user;

    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (
      !accessControlService.canManageElection(identity, election) &&
      !accessControlService.canAddFederationVoters(identity, election)
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Association elections: bulk/CSV import is reserved for federation
    // elections. Association participants must come from the member roster.
    if (election.scope === 'ASSOCIATION') {
      return res.status(403).json({
        error: "Les participants d'une élection d'association doivent être ajoutés depuis les membres.",
      });
    }

    const { participants } = req.body;
    if (!Array.isArray(participants)) {
      return res.status(400).json({ error: 'participants must be an array' });
    }

    const result = await electionService.bulkAddParticipants(election, participants, identity);

    return res.status(200).json({ success: true, summary: result.summary });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /elections/:id/participants/from-members
 * Body: { userIds?: string[], all?: boolean }
 *
 * Adds members as voters by selecting from a member roster — the ONLY way to
 * add voters from the association side (no manual / CSV entry):
 *  - ASSOCIATION election: adds the election's association members. Requires
 *    canManageElection (the association manager/election manager).
 *  - FEDERATION election: adds the CALLER'S OWN association members, scoped to
 *    that association and capped by the per-association quota. Requires the
 *    voter-adding capability (canManageVoters → canAddFederationVoters).
 */
router.post('/:id/participants/from-members', async (req, res) => {
  try {
    const identity = req.user;

    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (!accessControlService.canManageVoters(identity, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { userIds, all } = req.body;

    let result;
    if (election.scope === 'ASSOCIATION') {
      result = await electionService.addMembersAsParticipants(election, { userIds, all }, identity);
    } else if (election.scope === 'FEDERATION') {
      result = await electionService.addAssociationMembersToFederationElection(
        election,
        { userIds, all },
        identity
      );
    } else {
      return res.status(400).json({ error: 'Scope d’élection non pris en charge' });
    }

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({ success: true, summary: result.summary });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /elections/:id
 * Body: { name?, start?, end?, timezone?, votersPerAssociation? }
 * Modify an election. OWNERSHIP: only the user who created the election may
 * modify it (Req: creator-only modify/delete). Other users — even with the same
 * role — are denied.
 */
router.patch('/:id', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (!accessControlService.canModifyElection(identity, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, start, end, timezone, votersPerAssociation } = req.body || {};
    const result = await electionService.updateElection(req.params.id, {
      name,
      start,
      end,
      timezone,
      votersPerAssociation,
    });

    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      const status = result.error === 'Election not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.status(200).json({ success: true, election: result.election });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /elections/:id
 * Delete an election. OWNERSHIP: only the user who created the election may
 * delete it (Req: creator-only modify/delete).
 */
router.delete('/:id', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (!accessControlService.canModifyElection(identity, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await electionService.deleteElection(req.params.id);
    if (!result.success) {
      const status = result.error === 'Election not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /elections/:id/positions/:positionId/candidates/:candidateId
 * Body: { name?, motivation?, photo?, photoMimeType?, photoSize? }
 * Modify a candidate. OWNERSHIP: only the user who created the candidate may
 * modify it (Req: creator-only modify/delete).
 */
router.patch('/:id/positions/:positionId/candidates/:candidateId', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const candidate = await loadCandidate(req.params.candidateId);
    if (!candidate || candidate.position_id !== req.params.positionId) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    if (!accessControlService.canModifyCandidate(identity, candidate, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, motivation, photo, photoMimeType, photoSize } = req.body || {};
    const result = await electionService.updateCandidate(req.params.candidateId, {
      name,
      motivation,
      photo,
      photoMimeType,
      photoSize,
    });

    if (!result.success) {
      if (result.errors) return res.status(400).json({ errors: result.errors });
      const status = result.error === 'Candidate not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.status(200).json({ success: true, candidate: result.candidate });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /elections/:id/positions/:positionId/candidates/:candidateId
 * Delete a candidate. OWNERSHIP: only the user who created the candidate may
 * delete it (Req: creator-only modify/delete).
 */
router.delete('/:id/positions/:positionId/candidates/:candidateId', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const candidate = await loadCandidate(req.params.candidateId);
    if (!candidate || candidate.position_id !== req.params.positionId) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    if (!accessControlService.canModifyCandidate(identity, candidate, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await electionService.deleteCandidate(req.params.candidateId);
    if (!result.success) {
      const status = result.error === 'Candidate not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /elections/:id/participants/:userId
 * Remove a voter (participant) from an election. ROLE-BASED (not creator-locked):
 * any user who may manage the election's voters (election manager / association
 * manager, or federation voter-adder) may remove voters. Applies to both
 * federation and association elections.
 */
router.delete('/:id/participants/:userId', async (req, res) => {
  try {
    const identity = req.user;
    const election = await loadElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    if (!accessControlService.canManageVoters(identity, election)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await electionService.removeParticipant(req.params.id, req.params.userId);
    if (!result.success) {
      const status = result.error === 'Participant introuvable' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
