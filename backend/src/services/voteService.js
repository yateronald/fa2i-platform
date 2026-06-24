'use strict';

const { pool, withTransaction } = require('../db/pool');
const schedulingService = require('./schedulingService');
const accessControlService = require('./accessControlService');
const participantsRepository = require('../db/repositories/participantsRepository');
const positionsRepository = require('../db/repositories/positionsRepository');
const candidatesRepository = require('../db/repositories/candidatesRepository');
const electionsRepository = require('../db/repositories/electionsRepository');
const auditRepository = require('../db/repositories/auditRepository');

/**
 * Vote_Service
 *
 * Records and validates votes under the PER-POSITION voting model.
 * A voter casts one vote for one candidate in a single position, only while
 * that position's voting window is OPEN. Integrity is one vote per voter per
 * position, enforced by the voter_voted_position primary key. Votes stored in
 * the votes table remain anonymous (no user_id).
 */

/**
 * Best-effort audit logging helper.
 * Never throws — if audit fails the vote outcome is unchanged.
 */
async function logAudit(auditRepo, dbPool, { user_id, election_id, outcome, reason }) {
  try {
    await auditRepo.create(dbPool, { user_id, election_id, outcome, reason });
  } catch (_) {
    // best-effort: swallow audit write failures
  }
}

/**
 * Cast a single vote for one candidate in one position.
 *
 * Pre-checks (in order):
 *   1. Look up the position
 *   2. Look up the parent election (for scope / association)
 *   3. Compute the position's voting-window state — must be OPEN
 *   4. Check eligibility — participant + scope membership
 *   5. Validate the candidate belongs to the position
 *
 * On any pre-check failure nothing is recorded. Regardless of accept or reject,
 * a ballot_audit entry is always written (best-effort).
 *
 * @param {object} identity - { id, role, association_id }
 * @param {string} positionId - UUID of the position
 * @param {string} candidateId - UUID of the chosen candidate
 * @param {object} [deps] - Dependency injection overrides for testing
 * @param {import('pg').Pool} [deps.pool] - Database pool
 * @param {Function} [deps.withTransaction] - Transaction helper
 * @param {object} [deps.schedulingService] - Scheduling service
 * @param {object} [deps.accessControlService] - Access control service
 * @param {object} [deps.participantsRepository] - Participants repository
 * @param {object} [deps.positionsRepository] - Positions repository
 * @param {object} [deps.candidatesRepository] - Candidates repository
 * @param {object} [deps.electionsRepository] - Elections repository
 * @param {object} [deps.auditRepository] - Audit repository
 * @returns {Promise<{ success: boolean, error?: string, recorded?: boolean, confirmedAt?: string }>}
 */
async function castPositionVote(identity, positionId, candidateId, deps) {
  const _pool = (deps && deps.pool) || pool;
  const _schedulingService = (deps && deps.schedulingService) || schedulingService;
  const _accessControlService = (deps && deps.accessControlService) || accessControlService;
  const _participantsRepository = (deps && deps.participantsRepository) || participantsRepository;
  const _positionsRepository = (deps && deps.positionsRepository) || positionsRepository;
  const _candidatesRepository = (deps && deps.candidatesRepository) || candidatesRepository;
  const _electionsRepository = (deps && deps.electionsRepository) || electionsRepository;
  const _auditRepository = (deps && deps.auditRepository) || auditRepository;

  // 1. Look up the position
  const position = await _positionsRepository.findById(_pool, positionId);
  if (!position) {
    return { success: false, error: 'Poste introuvable' };
  }

  const electionId = position.election_id;

  // 2. Look up the parent election (for scope / association)
  const election = await _electionsRepository.findById(_pool, electionId);

  // 3. The position must be published, and its voting-window state must be OPEN.
  //    An unpublished (DRAFT) position is treated exactly like a not-open window.
  const state = position.published
    ? _schedulingService.computeState(
        { start_at: position.start_at, end_at: position.end_at },
        new Date()
      )
    : 'CLOSED';
  if (state !== 'OPEN') {
    await logAudit(_auditRepository, _pool, {
      user_id: identity.id,
      election_id: electionId,
      outcome: 'REJECTED',
      reason: 'Poste ' + positionId + ': Position not open',
    });
    return { success: false, error: "Le vote n'est pas ouvert pour ce poste" };
  }

  // 4. Eligibility: participant + scope membership
  const participant = await _participantsRepository.findByElectionAndUser(
    _pool,
    electionId,
    identity.id
  );
  const isParticipant = !!participant;
  const eligible = _accessControlService.canCastBallot(identity, election, { isParticipant });
  if (!eligible) {
    await logAudit(_auditRepository, _pool, {
      user_id: identity.id,
      election_id: electionId,
      outcome: 'REJECTED',
      reason: 'Poste ' + positionId + ': Not eligible',
    });
    return { success: false, error: "Vous n'êtes pas éligible pour voter dans cette élection" };
  }

  // 5. Validate the candidate belongs to the position
  const candidate = await _candidatesRepository.findById(_pool, candidateId);
  if (!candidate || candidate.position_id !== positionId) {
    return { success: false, error: 'Candidat invalide pour ce poste' };
  }

  // All pre-checks passed — atomic write
  const _withTransaction = (deps && deps.withTransaction) || withTransaction;

  try {
    await _withTransaction(async (client) => {
      // 1. Insert the per-position voter marker (integrity anchor)
      await client.query(
        'INSERT INTO voter_voted_position (election_id, position_id, user_id) VALUES ($1, $2, $3)',
        [electionId, positionId, identity.id]
      );

      // 2. Insert the anonymous vote row (no user_id)
      await client.query(
        'INSERT INTO votes (election_id, position_id, candidate_id) VALUES ($1, $2, $3)',
        [electionId, positionId, candidateId]
      );
    }, { pool: _pool });
  } catch (err) {
    // Unique violation on voter_voted_position PK → already voted for this position
    if (err.code === '23505') {
      await logAudit(_auditRepository, _pool, {
        user_id: identity.id,
        election_id: electionId,
        outcome: 'REJECTED',
        reason: 'Poste ' + positionId + ': Already voted',
      });
      return { success: false, error: 'Vous avez déjà voté pour ce poste' };
    }
    // Any other failure during recording
    await logAudit(_auditRepository, _pool, {
      user_id: identity.id,
      election_id: electionId,
      outcome: 'REJECTED',
      reason: 'Poste ' + positionId + ': Recording failure',
    });
    return { success: false, error: "Le vote n'a pas été enregistré" };
  }

  // Vote accepted — audit the success (best-effort)
  await logAudit(_auditRepository, _pool, {
    user_id: identity.id,
    election_id: electionId,
    outcome: 'ACCEPTED',
    reason: 'Poste ' + positionId,
  });

  // Invalidate cached aggregate results so the dashboard reflects this vote
  // promptly (best-effort; never blocks or fails the vote).
  try {
    require('./resultService').clearResultCache(electionId);
  } catch (_) {
    // ignore cache invalidation failures
  }

  return { success: true, recorded: true, confirmedAt: new Date().toISOString() };
}

module.exports = {
  castPositionVote,
};
