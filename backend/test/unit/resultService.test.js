import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getPositionResult, getAggregateResult, getDashboard } from '../../src/services/resultService.js';

describe('resultService', () => {
  describe('getPositionResult()', () => {
    function createMockDeps(overrides = {}) {
      return {
        pool: {
          query: vi.fn().mockResolvedValue({ rows: [] }),
        },
        positionsRepository: {
          findById: vi.fn().mockResolvedValue({ id: 'pos-1', election_id: 'el-1', name: 'President' }),
        },
        candidatesRepository: {
          findByPosition: vi.fn().mockResolvedValue([
            { id: 'cand-1', name: 'Alice', photo_ref: 'photo-alice.jpg', position_id: 'pos-1' },
            { id: 'cand-2', name: 'Bob', photo_ref: 'photo-bob.jpg', position_id: 'pos-1' },
          ]),
        },
        votesRepository: {
          getCandidateCountsByPosition: vi.fn().mockResolvedValue([
            { candidate_id: 'cand-1', count: 10 },
            { candidate_id: 'cand-2', count: 7 },
          ]),
          countVotersByPosition: vi.fn().mockResolvedValue(17),
        },
        ...overrides,
      };
    }

    it('returns an error when the position does not exist', async () => {
      const deps = createMockDeps({
        positionsRepository: {
          findById: vi.fn().mockResolvedValue(null),
        },
      });

      const result = await getPositionResult('nonexistent-pos', deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Position not found');
    });

    it('returns per-candidate vote counts for a position', async () => {
      const deps = createMockDeps();

      const result = await getPositionResult('pos-1', deps);

      expect(result.success).toBe(true);
      expect(result.result.position_id).toBe('pos-1');
      expect(result.result.candidates).toHaveLength(2);
      expect(result.result.candidates[0]).toEqual({
        candidate_id: 'cand-1',
        name: 'Alice',
        photo_ref: 'photo-alice.jpg',
        count: 10,
      });
      expect(result.result.candidates[1]).toEqual({
        candidate_id: 'cand-2',
        name: 'Bob',
        photo_ref: 'photo-bob.jpg',
        count: 7,
      });
    });

    it('returns count = 0 for candidates with no votes', async () => {
      const deps = createMockDeps({
        votesRepository: {
          getCandidateCountsByPosition: vi.fn().mockResolvedValue([
            { candidate_id: 'cand-1', count: 5 },
            // cand-2 has no votes at all
          ]),
          countVotersByPosition: vi.fn().mockResolvedValue(5),
        },
      });

      const result = await getPositionResult('pos-1', deps);

      expect(result.success).toBe(true);
      expect(result.result.candidates[0].count).toBe(5);
      expect(result.result.candidates[1].count).toBe(0);
    });

    it('returns an empty candidates array when the position has no candidates', async () => {
      const deps = createMockDeps({
        candidatesRepository: {
          findByPosition: vi.fn().mockResolvedValue([]),
        },
        votesRepository: {
          getCandidateCountsByPosition: vi.fn().mockResolvedValue([]),
          countVotersByPosition: vi.fn().mockResolvedValue(0),
        },
      });

      const result = await getPositionResult('pos-1', deps);

      expect(result.success).toBe(true);
      expect(result.result.candidates).toEqual([]);
    });

    it('calls positionsRepository.findById with the correct positionId', async () => {
      const deps = createMockDeps();

      await getPositionResult('pos-42', deps);

      expect(deps.positionsRepository.findById).toHaveBeenCalledWith(deps.pool, 'pos-42');
    });

    it('calls candidatesRepository.findByPosition with the correct positionId', async () => {
      const deps = createMockDeps();

      await getPositionResult('pos-1', deps);

      expect(deps.candidatesRepository.findByPosition).toHaveBeenCalledWith(deps.pool, 'pos-1');
    });

    it('calls votesRepository.getCandidateCountsByPosition with the correct positionId', async () => {
      const deps = createMockDeps();

      await getPositionResult('pos-1', deps);

      expect(deps.votesRepository.getCandidateCountsByPosition).toHaveBeenCalledWith(deps.pool, 'pos-1');
    });
  });

  describe('getAggregateResult()', () => {
    function createMockDeps(overrides = {}) {
      return {
        pool: {
          query: vi.fn().mockResolvedValue({ rows: [{ count: 15 }] }),
        },
        electionsRepository: {
          findById: vi.fn().mockResolvedValue({
            id: 'el-1',
            name: 'Federation Election 2025',
            scope: 'FEDERATION',
            association_id: null,
            start_at: new Date('2025-07-01T10:00:00Z'),
            end_at: new Date('2025-07-01T18:00:00Z'),
          }),
        },
        positionsRepository: {
          findByElection: vi.fn().mockResolvedValue([
            { id: 'pos-1', election_id: 'el-1', name: 'President' },
            { id: 'pos-2', election_id: 'el-1', name: 'Secretary' },
          ]),
        },
        candidatesRepository: {
          findByPosition: vi.fn().mockImplementation((client, positionId) => {
            if (positionId === 'pos-1') {
              return Promise.resolve([
                { id: 'cand-1', name: 'Alice', photo_ref: 'photo-alice.jpg', position_id: 'pos-1' },
                { id: 'cand-2', name: 'Bob', photo_ref: 'photo-bob.jpg', position_id: 'pos-1' },
              ]);
            }
            return Promise.resolve([
              { id: 'cand-3', name: 'Charlie', photo_ref: 'photo-charlie.jpg', position_id: 'pos-2' },
            ]);
          }),
        },
        votesRepository: {
          getCandidateCountsByPosition: vi.fn().mockImplementation((client, positionId) => {
            if (positionId === 'pos-1') {
              return Promise.resolve([
                { candidate_id: 'cand-1', count: 10 },
                { candidate_id: 'cand-2', count: 7 },
              ]);
            }
            return Promise.resolve([
              { candidate_id: 'cand-3', count: 12 },
            ]);
          }),
          countVotersByPosition: vi.fn().mockImplementation((client, positionId) => {
            if (positionId === 'pos-1') {
              return Promise.resolve(17);
            }
            return Promise.resolve(12);
          }),
          countVotersByElection: vi.fn().mockResolvedValue(15),
        },
        participantsRepository: {
          findByElection: vi.fn().mockResolvedValue([
            { election_id: 'el-1', user_id: 'user-1' },
            { election_id: 'el-1', user_id: 'user-2' },
            { election_id: 'el-1', user_id: 'user-3' },
            { election_id: 'el-1', user_id: 'user-4' },
            { election_id: 'el-1', user_id: 'user-5' },
            { election_id: 'el-1', user_id: 'user-6' },
            { election_id: 'el-1', user_id: 'user-7' },
            { election_id: 'el-1', user_id: 'user-8' },
            { election_id: 'el-1', user_id: 'user-9' },
            { election_id: 'el-1', user_id: 'user-10' },
            { election_id: 'el-1', user_id: 'user-11' },
            { election_id: 'el-1', user_id: 'user-12' },
            { election_id: 'el-1', user_id: 'user-13' },
            { election_id: 'el-1', user_id: 'user-14' },
            { election_id: 'el-1', user_id: 'user-15' },
            { election_id: 'el-1', user_id: 'user-16' },
            { election_id: 'el-1', user_id: 'user-17' },
            { election_id: 'el-1', user_id: 'user-18' },
            { election_id: 'el-1', user_id: 'user-19' },
            { election_id: 'el-1', user_id: 'user-20' },
          ]),
        },
        ...overrides,
      };
    }

    it('returns an error when the election does not exist', async () => {
      const deps = createMockDeps({
        electionsRepository: {
          findById: vi.fn().mockResolvedValue(null),
        },
      });

      const result = await getAggregateResult('nonexistent-el', deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Election not found');
    });

    it('returns positions with per-candidate vote counts', async () => {
      const deps = createMockDeps();

      const result = await getAggregateResult('el-1', deps);

      expect(result.success).toBe(true);
      expect(result.result.election_id).toBe('el-1');
      expect(result.result.positions).toHaveLength(2);

      // First position: President
      const presidentPos = result.result.positions[0];
      expect(presidentPos.position_id).toBe('pos-1');
      expect(presidentPos.name).toBe('President');
      expect(presidentPos.candidates).toHaveLength(2);
      expect(presidentPos.candidates[0]).toEqual({
        candidate_id: 'cand-1',
        name: 'Alice',
        photo_ref: 'photo-alice.jpg',
        count: 10,
      });
      expect(presidentPos.candidates[1]).toEqual({
        candidate_id: 'cand-2',
        name: 'Bob',
        photo_ref: 'photo-bob.jpg',
        count: 7,
      });

      // Second position: Secretary
      const secretaryPos = result.result.positions[1];
      expect(secretaryPos.position_id).toBe('pos-2');
      expect(secretaryPos.name).toBe('Secretary');
      expect(secretaryPos.candidates).toHaveLength(1);
      expect(secretaryPos.candidates[0]).toEqual({
        candidate_id: 'cand-3',
        name: 'Charlie',
        photo_ref: 'photo-charlie.jpg',
        count: 12,
      });
    });

    it('returns the correct totalVoters count from participants', async () => {
      const deps = createMockDeps();

      const result = await getAggregateResult('el-1', deps);

      expect(result.success).toBe(true);
      expect(result.result.totalVoters).toBe(20);
    });

    it('returns the correct totalBallots from distinct voters', async () => {
      const deps = createMockDeps();

      const result = await getAggregateResult('el-1', deps);

      expect(result.success).toBe(true);
      expect(result.result.totalBallots).toBe(15);
    });

    it('counts distinct voters for the election with the correct electionId', async () => {
      const deps = createMockDeps();

      await getAggregateResult('el-1', deps);

      expect(deps.votesRepository.countVotersByElection).toHaveBeenCalledWith(deps.pool, 'el-1');
    });

    it('includes per-position votesCast counts', async () => {
      const deps = createMockDeps();

      const result = await getAggregateResult('el-1', deps);

      expect(result.success).toBe(true);
      expect(result.result.positions[0].votesCast).toBe(17);
      expect(result.result.positions[1].votesCast).toBe(12);
      expect(deps.votesRepository.countVotersByPosition).toHaveBeenCalledWith(deps.pool, 'pos-1');
      expect(deps.votesRepository.countVotersByPosition).toHaveBeenCalledWith(deps.pool, 'pos-2');
    });

    it('returns an empty positions array when the election has no positions', async () => {
      const deps = createMockDeps({
        positionsRepository: {
          findByElection: vi.fn().mockResolvedValue([]),
        },
      });

      const result = await getAggregateResult('el-1', deps);

      expect(result.success).toBe(true);
      expect(result.result.positions).toEqual([]);
    });

    it('returns count = 0 for candidates with no votes in any position', async () => {
      const deps = createMockDeps({
        votesRepository: {
          getCandidateCountsByPosition: vi.fn().mockResolvedValue([]),
          countVotersByPosition: vi.fn().mockResolvedValue(0),
          countVotersByElection: vi.fn().mockResolvedValue(0),
        },
      });

      const result = await getAggregateResult('el-1', deps);

      expect(result.success).toBe(true);
      // All candidates should have count 0
      for (const pos of result.result.positions) {
        for (const cand of pos.candidates) {
          expect(cand.count).toBe(0);
        }
      }
    });

    it('handles a federation election aggregation across participating associations', async () => {
      // For federation elections, votes are already stored at the election level,
      // so the query naturally aggregates across all participating associations.
      const deps = createMockDeps();

      const result = await getAggregateResult('el-1', deps);

      // Verify that the aggregate result is simply the sum of all votes per position,
      // which inherently combines across associations since votes are stored at election level.
      expect(result.success).toBe(true);
      expect(result.result.positions[0].candidates[0].count).toBe(10); // Alice
      expect(result.result.positions[0].candidates[1].count).toBe(7);  // Bob
      expect(result.result.positions[1].candidates[0].count).toBe(12); // Charlie
    });

    it('calls electionsRepository.findById with the correct electionId', async () => {
      const deps = createMockDeps();

      await getAggregateResult('el-99', deps);

      expect(deps.electionsRepository.findById).toHaveBeenCalledWith(deps.pool, 'el-99');
    });

    it('calls positionsRepository.findByElection with the correct electionId', async () => {
      const deps = createMockDeps();

      await getAggregateResult('el-1', deps);

      expect(deps.positionsRepository.findByElection).toHaveBeenCalledWith(deps.pool, 'el-1');
    });
  });

  describe('getDashboard()', () => {
    const closedElection = {
      id: 'el-1',
      name: 'Test Election',
      scope: 'ASSOCIATION',
      association_id: 'assoc-1',
      start_at: new Date('2025-01-01T08:00:00Z'),
      end_at: new Date('2025-01-01T18:00:00Z'),
    };

    const openElection = {
      id: 'el-2',
      name: 'Open Election',
      scope: 'ASSOCIATION',
      association_id: 'assoc-1',
      start_at: new Date('2020-01-01T08:00:00Z'),
      end_at: new Date('2099-12-31T18:00:00Z'),
    };

    const federationElection = {
      id: 'el-3',
      name: 'Federation Election',
      scope: 'FEDERATION',
      association_id: null,
      start_at: new Date('2025-01-01T08:00:00Z'),
      end_at: new Date('2025-01-01T18:00:00Z'),
    };

    const managerIdentity = { id: 'user-mgr', role: 'ASSOCIATION_MANAGER', association_id: 'assoc-1' };
    const fedAdminIdentity = { id: 'user-fed', role: 'FEDERATION_ADMINISTRATOR', association_id: null };
    const voterIdentity = { id: 'user-voter', role: 'VOTER', association_id: 'assoc-1' };
    const otherVoterIdentity = { id: 'user-other', role: 'VOTER', association_id: 'assoc-2' };

    const aggregateResult = {
      success: true,
      result: {
        election_id: 'el-1',
        positions: [
          {
            position_id: 'pos-1',
            name: 'President',
            candidates: [
              { candidate_id: 'cand-1', name: 'Alice', count: 10 },
              { candidate_id: 'cand-2', name: 'Bob', count: 7 },
            ],
          },
        ],
        totalVoters: 20,
        totalBallots: 17,
      },
    };

    function createDashboardDeps(overrides = {}) {
      return {
        pool: { query: vi.fn() },
        electionsRepository: {
          findById: vi.fn().mockResolvedValue(closedElection),
        },
        participantsRepository: {
          findByElectionAndUser: vi.fn().mockResolvedValue({ election_id: 'el-1', user_id: 'user-voter' }),
        },
        schedulingService: {
          computeState: vi.fn().mockReturnValue('CLOSED'),
        },
        accessControlService: {
          canViewElectionResults: vi.fn().mockReturnValue(true),
        },
        getAggregateResult: vi.fn().mockResolvedValue(aggregateResult),
        ...overrides,
      };
    }

    it('returns an error when the election does not exist', async () => {
      const deps = createDashboardDeps({
        electionsRepository: { findById: vi.fn().mockResolvedValue(null) },
      });

      const result = await getDashboard(managerIdentity, 'nonexistent', deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Election not found');
    });

    it('denies access and discloses no counts when user is not authorized', async () => {
      const deps = createDashboardDeps({
        accessControlService: { canViewElectionResults: vi.fn().mockReturnValue(false) },
        participantsRepository: { findByElectionAndUser: vi.fn().mockResolvedValue(null) },
      });

      const result = await getDashboard(otherVoterIdentity, 'el-1', deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
      expect(result.dashboard).toBeUndefined();
    });

    it('allows an association manager of the election to view results', async () => {
      const deps = createDashboardDeps();

      const result = await getDashboard(managerIdentity, 'el-1', deps);

      expect(result.success).toBe(true);
      expect(result.dashboard.election_id).toBe('el-1');
      expect(deps.accessControlService.canViewElectionResults).toHaveBeenCalledWith(
        managerIdentity,
        closedElection,
        { isParticipant: true, isClosed: true }
      );
    });

    it('allows a federation admin to view any association election in any state', async () => {
      const deps = createDashboardDeps({
        electionsRepository: { findById: vi.fn().mockResolvedValue(openElection) },
        schedulingService: { computeState: vi.fn().mockReturnValue('OPEN') },
        participantsRepository: { findByElectionAndUser: vi.fn().mockResolvedValue(null) },
      });

      const result = await getDashboard(fedAdminIdentity, 'el-2', deps);

      expect(result.success).toBe(true);
      expect(deps.accessControlService.canViewElectionResults).toHaveBeenCalledWith(
        fedAdminIdentity,
        openElection,
        { isParticipant: false, isClosed: false }
      );
    });

    it('allows a participant to view results after close', async () => {
      const deps = createDashboardDeps();

      const result = await getDashboard(voterIdentity, 'el-1', deps);

      expect(result.success).toBe(true);
      expect(result.dashboard).toBeDefined();
      expect(result.dashboard.positions).toHaveLength(1);
    });

    it('denies a participant from viewing results while the election is open', async () => {
      const deps = createDashboardDeps({
        electionsRepository: { findById: vi.fn().mockResolvedValue(openElection) },
        schedulingService: { computeState: vi.fn().mockReturnValue('OPEN') },
        accessControlService: { canViewElectionResults: vi.fn().mockReturnValue(false) },
      });

      const result = await getDashboard(voterIdentity, 'el-2', deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });

    it('returns the full dashboard with per-position and aggregate data', async () => {
      const deps = createDashboardDeps();

      const result = await getDashboard(managerIdentity, 'el-1', deps);

      expect(result.success).toBe(true);
      expect(result.dashboard.election_id).toBe('el-1');
      expect(result.dashboard.positions).toHaveLength(1);
      expect(result.dashboard.positions[0].position_id).toBe('pos-1');
      expect(result.dashboard.positions[0].candidates[0].count).toBe(10);
      expect(result.dashboard.totalVoters).toBe(20);
      expect(result.dashboard.totalBallots).toBe(17);
    });

    it('handles zero-position elections gracefully with an empty positions array', async () => {
      const deps = createDashboardDeps({
        getAggregateResult: vi.fn().mockResolvedValue({
          success: true,
          result: {
            election_id: 'el-1',
            positions: [],
            totalVoters: 5,
            totalBallots: 0,
          },
        }),
      });

      const result = await getDashboard(managerIdentity, 'el-1', deps);

      expect(result.success).toBe(true);
      expect(result.dashboard.positions).toEqual([]);
      expect(result.dashboard.totalVoters).toBe(5);
      expect(result.dashboard.totalBallots).toBe(0);
    });

    it('returns Dashboard temporarily unavailable when getAggregateResult throws', async () => {
      const deps = createDashboardDeps({
        getAggregateResult: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      });

      const result = await getDashboard(managerIdentity, 'el-1', deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dashboard temporarily unavailable');
    });

    it('returns Dashboard temporarily unavailable when getAggregateResult returns failure', async () => {
      const deps = createDashboardDeps({
        getAggregateResult: vi.fn().mockResolvedValue({ success: false, error: 'Election not found' }),
      });

      const result = await getDashboard(managerIdentity, 'el-1', deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dashboard temporarily unavailable');
    });

    it('passes the identity participant status correctly when not a participant', async () => {
      const deps = createDashboardDeps({
        participantsRepository: { findByElectionAndUser: vi.fn().mockResolvedValue(null) },
      });

      await getDashboard(managerIdentity, 'el-1', deps);

      expect(deps.accessControlService.canViewElectionResults).toHaveBeenCalledWith(
        managerIdentity,
        closedElection,
        { isParticipant: false, isClosed: true }
      );
    });

    it('computes election state using the scheduling service', async () => {
      const deps = createDashboardDeps();

      await getDashboard(managerIdentity, 'el-1', deps);

      expect(deps.schedulingService.computeState).toHaveBeenCalledWith(
        closedElection,
        expect.any(Date)
      );
    });

    it('looks up participant record for the requesting user', async () => {
      const deps = createDashboardDeps();

      await getDashboard(voterIdentity, 'el-1', deps);

      expect(deps.participantsRepository.findByElectionAndUser).toHaveBeenCalledWith(
        deps.pool,
        'el-1',
        'user-voter'
      );
    });
  });
});
