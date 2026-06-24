import { describe, it, expect, vi } from 'vitest';
import { castPositionVote } from '../../src/services/voteService.js';

// --- Helpers ---

function makeIdentity(id = 'user-1', role = 'VOTER', association_id = 'assoc-1') {
  return { id, role, association_id };
}

function makeElection(id = 'elec-1', scope = 'FEDERATION', association_id = null) {
  return { id, scope, association_id };
}

function makePosition(overrides = {}) {
  return {
    id: 'pos-1',
    election_id: 'elec-1',
    name: 'President',
    start_at: new Date('2024-01-01'),
    end_at: new Date('2099-12-31'),
    schedule_timezone: 'UTC',
    published: true,
    ...overrides,
  };
}

function makeCandidate(overrides = {}) {
  return {
    id: 'cand-1',
    position_id: 'pos-1',
    name: 'Alice',
    photo_ref: 'photo.jpg',
    motivation: 'x',
    ...overrides,
  };
}

/**
 * Build a mock withTransaction that executes the callback with a mock client.
 */
function makeMockWithTransaction(mockClient) {
  return async (fn, _opts) => {
    return fn(mockClient);
  };
}

/**
 * Build default deps that pass all pre-checks and let us focus on the vote write.
 */
function makePassingDeps(overrides = {}) {
  const election = makeElection();
  const position = makePosition();
  const candidate = makeCandidate();

  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    ...(overrides.mockClient || {}),
  };

  return {
    pool: {},
    withTransaction: overrides.withTransaction || makeMockWithTransaction(mockClient),
    schedulingService: { computeState: () => 'OPEN' },
    accessControlService: { canCastBallot: () => true },
    participantsRepository: {
      findByElectionAndUser: async () => ({ election_id: 'elec-1', user_id: 'user-1' }),
    },
    positionsRepository: { findById: async () => position },
    electionsRepository: { findById: async () => election },
    candidatesRepository: { findById: async () => candidate },
    auditRepository: { create: vi.fn().mockResolvedValue({}) },
    _mockClient: mockClient,
    ...overrides,
  };
}

// --- Atomic Vote Write Tests ---

describe('castPositionVote - atomic vote write', () => {
  describe('success path', () => {
    it('inserts voter_voted_position marker and the vote row, then returns success', async () => {
      const identity = makeIdentity();
      const deps = makePassingDeps();

      const result = await castPositionVote(identity, 'pos-1', 'cand-1', deps);

      expect(result).toMatchObject({ success: true, recorded: true });
      expect(typeof result.confirmedAt).toBe('string');

      const calls = deps._mockClient.query.mock.calls;

      // Verify the per-position voter marker was inserted
      expect(calls[0][0]).toContain('INSERT INTO voter_voted_position');
      expect(calls[0][1]).toEqual(['elec-1', 'pos-1', 'user-1']);

      // Verify the anonymous vote was inserted (no user_id)
      expect(calls[1][0]).toContain('INSERT INTO votes');
      expect(calls[1][1]).toEqual(['elec-1', 'pos-1', 'cand-1']);
    });

    it('does not include user_id in the vote insert (anonymity)', async () => {
      const identity = makeIdentity();
      const deps = makePassingDeps();

      await castPositionVote(identity, 'pos-1', 'cand-1', deps);

      const voteCalls = deps._mockClient.query.mock.calls.filter((call) =>
        call[0].includes('INSERT INTO votes')
      );
      expect(voteCalls).toHaveLength(1);
      for (const call of voteCalls) {
        // Parameters should only be [election_id, position_id, candidate_id]
        expect(call[1]).toHaveLength(3);
        expect(call[1]).not.toContain(identity.id);
      }
    });
  });

  describe('unique violation (already voted)', () => {
    it('returns "already voted" error when the marker insert triggers a unique violation', async () => {
      const identity = makeIdentity();

      const uniqueViolation = new Error('duplicate key value violates unique constraint');
      uniqueViolation.code = '23505';

      const deps = makePassingDeps({
        withTransaction: async (fn, _opts) => {
          const mockClient = {
            query: vi.fn().mockRejectedValueOnce(uniqueViolation),
          };
          return fn(mockClient);
        },
      });

      const result = await castPositionVote(identity, 'pos-1', 'cand-1', deps);

      expect(result).toEqual({ success: false, error: 'Vous avez déjà voté pour ce poste' });
    });

    it('does not record the vote when a unique violation occurs', async () => {
      const identity = makeIdentity();

      const uniqueViolation = new Error('duplicate key value violates unique constraint');
      uniqueViolation.code = '23505';

      const queryCalls = [];
      const deps = makePassingDeps({
        withTransaction: async (fn, _opts) => {
          const mockClient = {
            query: vi.fn((sql, params) => {
              queryCalls.push({ sql, params });
              if (sql.includes('INSERT INTO voter_voted_position')) {
                throw uniqueViolation;
              }
              return { rows: [] };
            }),
          };
          return fn(mockClient);
        },
      });

      await castPositionVote(identity, 'pos-1', 'cand-1', deps);

      // Only the marker insert was attempted — the vote never executed
      const voteInserts = queryCalls.filter((c) => c.sql.includes('INSERT INTO votes'));
      expect(voteInserts).toHaveLength(0);
    });
  });

  describe('publish gating', () => {
    it('rejects a vote on an unpublished (DRAFT) position even within an OPEN window', async () => {
      const identity = makeIdentity();
      // published:false → must be treated as not open, regardless of window.
      const deps = makePassingDeps({
        positionsRepository: { findById: async () => makePosition({ published: false }) },
        // computeState would say OPEN, but it must not be consulted / must not matter.
        schedulingService: { computeState: () => 'OPEN' },
      });

      const result = await castPositionVote(identity, 'pos-1', 'cand-1', deps);

      expect(result).toEqual({ success: false, error: "Le vote n'est pas ouvert pour ce poste" });
      // A ballot audit entry is written for the rejection.
      expect(deps.auditRepository.create).toHaveBeenCalled();
    });

    it('accepts a vote on a published position whose window is OPEN', async () => {
      const identity = makeIdentity();
      const deps = makePassingDeps({
        positionsRepository: { findById: async () => makePosition({ published: true }) },
        schedulingService: { computeState: () => 'OPEN' },
      });

      const result = await castPositionVote(identity, 'pos-1', 'cand-1', deps);

      expect(result).toMatchObject({ success: true, recorded: true });
    });
  });

  describe('recording failure (other errors)', () => {
    it('returns "le vote n\'a pas été enregistré" on a non-unique-violation error', async () => {
      const identity = makeIdentity();

      const dbError = new Error('connection lost');
      dbError.code = '08006'; // connection_failure

      const deps = makePassingDeps({
        withTransaction: async (_fn, _opts) => {
          throw dbError;
        },
      });

      const result = await castPositionVote(identity, 'pos-1', 'cand-1', deps);

      expect(result).toEqual({ success: false, error: "Le vote n'a pas été enregistré" });
    });

    it('returns a recording failure when the vote insert fails mid-transaction', async () => {
      const identity = makeIdentity();

      const insertError = new Error('foreign key violation');
      insertError.code = '23503';

      const deps = makePassingDeps({
        withTransaction: async (fn, _opts) => {
          const mockClient = {
            query: vi
              .fn()
              .mockResolvedValueOnce({ rows: [] }) // marker succeeds
              .mockRejectedValueOnce(insertError), // vote insert fails
          };
          return fn(mockClient);
        },
      });

      const result = await castPositionVote(identity, 'pos-1', 'cand-1', deps);

      expect(result).toEqual({ success: false, error: "Le vote n'a pas été enregistré" });
    });
  });
});
