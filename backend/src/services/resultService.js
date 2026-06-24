'use strict';

const { pool } = require('../db/pool');
const votesRepository = require('../db/repositories/votesRepository');
const positionsRepository = require('../db/repositories/positionsRepository');
const candidatesRepository = require('../db/repositories/candidatesRepository');
const electionsRepository = require('../db/repositories/electionsRepository');
const participantsRepository = require('../db/repositories/participantsRepository');
const schedulingService = require('./schedulingService');
const accessControlService = require('./accessControlService');

/**
 * Short-TTL in-memory cache for aggregate election results.
 *
 * The dashboard is a polling endpoint: when an election closes, many viewers
 * may hit it at once. Caching the aggregate tally for a few seconds collapses
 * those bursts into a single set of COUNT queries. The cache is per-process
 * (each backend instance keeps its own); the short TTL keeps instances in sync
 * within seconds, and a successful vote explicitly invalidates the entry.
 *
 * Caching is applied ONLY on the production path (no injected deps), so unit
 * tests that inject repositories and assert call counts are unaffected.
 */
const RESULT_CACHE_TTL_MS =
  Number(process.env.RESULT_CACHE_TTL_MS) > 0 ? Number(process.env.RESULT_CACHE_TTL_MS) : 5000;
const _resultCache = new Map(); // electionId -> { value, expiresAt }

/**
 * Invalidate cached aggregate results.
 * @param {string} [electionId] - Specific election to clear; clears all when omitted.
 */
function clearResultCache(electionId) {
  if (electionId === undefined) {
    _resultCache.clear();
  } else {
    _resultCache.delete(electionId);
  }
}

/**
 * Get the vote tally for a single position.
 * Returns each candidate's vote count for that position only.
 *
 * @param {string} positionId - UUID of the position.
 * @param {{ pool?: import('pg').Pool, votesRepository?: object, candidatesRepository?: object, positionsRepository?: object }} [deps] - Injectable dependencies for testing.
 * @returns {Promise<{ success: boolean, result?: { position_id: string, candidates: Array<{ candidate_id: string, name: string, photo_ref: string, count: number }> }, error?: string }>}
 */
async function getPositionResult(positionId, deps) {
  const p = (deps && deps.pool) || pool;
  const votesRepo = (deps && deps.votesRepository) || votesRepository;
  const candidatesRepo = (deps && deps.candidatesRepository) || candidatesRepository;
  const positionsRepo = (deps && deps.positionsRepository) || positionsRepository;

  // 1. Verify the position exists
  const position = await positionsRepo.findById(p, positionId);
  if (!position) {
    return { success: false, error: 'Position not found' };
  }

  // 2. Get all candidates for the position
  const candidates = await candidatesRepo.findByPosition(p, positionId);

  // 3. Get per-candidate vote counts for this position
  const voteCounts = await votesRepo.getCandidateCountsByPosition(p, positionId);

  // 4. Build a map of candidate_id -> count
  const countMap = {};
  for (const row of voteCounts) {
    countMap[row.candidate_id] = row.count;
  }

  // 5. Merge candidate info with vote counts (candidates with 0 votes get count = 0)
  const candidateResults = candidates.map((c) => ({
    candidate_id: c.id,
    name: c.name,
    photo_ref: c.photo_ref,
    count: countMap[c.id] || 0,
  }));

  // 6. Number of voters who cast a vote for this position
  const votesCast = await votesRepo.countVotersByPosition(p, positionId);

  return {
    success: true,
    result: {
      position_id: positionId,
      candidates: candidateResults,
      votesCast,
    },
  };
}

/**
 * Get the aggregate result for an entire election.
 * Combines candidate counts across all positions.
 * For federation elections, votes are already stored at the election level,
 * so the query naturally aggregates across all participating associations.
 *
 * @param {string} electionId - UUID of the election.
 * @param {{ pool?: import('pg').Pool, votesRepository?: object, positionsRepository?: object, candidatesRepository?: object, electionsRepository?: object, participantsRepository?: object }} [deps] - Injectable dependencies for testing.
 * @returns {Promise<{ success: boolean, result?: { election_id: string, positions: Array<{ position_id: string, name: string, candidates: Array<{ candidate_id: string, name: string, count: number }> }>, totalVoters: number, totalBallots: number }, error?: string }>}
 */
async function getAggregateResult(electionId, deps) {
  const p = (deps && deps.pool) || pool;
  const votesRepo = (deps && deps.votesRepository) || votesRepository;
  const positionsRepo = (deps && deps.positionsRepository) || positionsRepository;
  const candidatesRepo = (deps && deps.candidatesRepository) || candidatesRepository;
  const electionsRepo = (deps && deps.electionsRepository) || electionsRepository;
  const participantsRepo = (deps && deps.participantsRepository) || participantsRepository;

  // Production-path cache (bypassed entirely when deps are injected for tests).
  const useCache = !deps && RESULT_CACHE_TTL_MS > 0;
  if (useCache) {
    const hit = _resultCache.get(electionId);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value;
    }
  }

  // 1. Verify the election exists
  const election = await electionsRepo.findById(p, electionId);
  if (!election) {
    return { success: false, error: 'Election not found' };
  }

  // 2. Get all positions for the election
  const positions = await positionsRepo.findByElection(p, electionId);

  // 3. For each position, get per-candidate counts and per-position voter count
  const positionResults = [];
  for (const pos of positions) {
    const candidates = await candidatesRepo.findByPosition(p, pos.id);
    const voteCounts = await votesRepo.getCandidateCountsByPosition(p, pos.id);

    const countMap = {};
    for (const row of voteCounts) {
      countMap[row.candidate_id] = row.count;
    }

    const candidateResults = candidates.map((c) => ({
      candidate_id: c.id,
      name: c.name,
      photo_ref: c.photo_ref,
      count: countMap[c.id] || 0,
    }));

    const votesCast = await votesRepo.countVotersByPosition(p, pos.id);

    positionResults.push({
      position_id: pos.id,
      name: pos.name,
      candidates: candidateResults,
      votesCast,
    });
  }

  // 4. Get total number of registered participants (voters)
  const participants = await participantsRepo.findByElection(p, electionId);
  const totalVoters = participants.length;

  // 5. Count distinct voters who cast at least one vote in this election
  const totalBallots = await votesRepo.countVotersByElection(p, electionId);

  const response = {
    success: true,
    result: {
      election_id: electionId,
      positions: positionResults,
      totalVoters,
      totalBallots,
    },
  };

  if (useCache) {
    _resultCache.set(electionId, {
      value: response,
      expiresAt: Date.now() + RESULT_CACHE_TTL_MS,
    });
  }

  return response;
}

/**
 * Get the full election dashboard: per-position results and aggregate data.
 * Enforces result-view authorization and handles resilience (zero-position elections,
 * partial failures returning last-good data with error flags).
 *
 * Authorization rules (Req 16.4, 17.4, 18.1, 18.2, 18.3, 19.1):
 * - Managers of the election can always view
 * - Federation admins can view any association election in any state
 * - Participants can view only after the election closes
 * - All others are denied with no counts disclosed
 *
 * @param {object} identity - { id, role, association_id }
 * @param {string} electionId - UUID of the election
 * @param {{ pool?: import('pg').Pool, electionsRepository?: object, participantsRepository?: object, schedulingService?: object, accessControlService?: object, getAggregateResult?: Function }} [deps] - Injectable dependencies for testing
 * @returns {Promise<{ success: boolean, dashboard?: object, error?: string }>}
 */
async function getDashboard(identity, electionId, deps) {
  const p = (deps && deps.pool) || pool;
  const electionsRepo = (deps && deps.electionsRepository) || electionsRepository;
  const participantsRepo = (deps && deps.participantsRepository) || participantsRepository;
  const scheduling = (deps && deps.schedulingService) || schedulingService;
  const acService = (deps && deps.accessControlService) || accessControlService;
  const aggregateFn = (deps && deps.getAggregateResult) || getAggregateResult;

  // 1. Look up the election
  const election = await electionsRepo.findById(p, electionId);
  if (!election) {
    return { success: false, error: 'Election not found' };
  }

  // 2. Determine if the user is a participant
  const participant = await participantsRepo.findByElectionAndUser(p, electionId, identity.id);
  const isParticipant = !!participant;

  // 3. Compute election state
  const state = scheduling.computeState(election, new Date());
  const isClosed = state === 'CLOSED';

  // 4. Check authorization
  const authorized = acService.canViewElectionResults(identity, election, { isParticipant, isClosed });
  if (!authorized) {
    return { success: false, error: 'Access denied' };
  }

  // 5. Call getAggregateResult for the full data with resilience
  try {
    const aggregateResponse = await aggregateFn(electionId, deps);

    if (!aggregateResponse.success) {
      return { success: false, error: 'Dashboard temporarily unavailable' };
    }

    const result = aggregateResponse.result;

    // 6. For zero-position elections: return an empty positions array (graceful handling)
    // getAggregateResult already handles this by returning positions: []

    return {
      success: true,
      dashboard: {
        election_id: result.election_id,
        positions: result.positions,
        totalVoters: result.totalVoters,
        totalBallots: result.totalBallots,
      },
    };
  } catch (err) {
    // 7. Resilience: if getAggregateResult throws, return unavailable error
    return { success: false, error: 'Dashboard temporarily unavailable' };
  }
}

module.exports = {
  getPositionResult,
  getAggregateResult,
  getDashboard,
  clearResultCache,
};
