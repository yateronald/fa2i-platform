import { describe, it, expect, vi } from 'vitest';
import { castPositionVote } from '../../src/services/voteService.js';

// --- Helpers ---

function makeIdentity(overrides = {}) {
  return {
    id: 'user-1',
    role: 'VOTER',
    association_id: 'assoc-1',
    ...overrides,
  };
}

function makeElection(overrides = {}) {
  return {
    id: 'elec-1',
    scope: 'ASSOCIATION',
    association_id: 'assoc-1',
    ...overrides,
  };
}

function makePosition(overrides = {}) {
  return {
    id: 'pos-1',
    election_id: 'elec-1',
    name: 'President',
    start_at: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
    end_at: new Date(Date.now() + 3600_000).toISOString(), // 1 hour from now
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
    photo_ref: 'photo-alice.jpg',
    motivation: 'For a better future',
    ...overrides,
  };
}

function makeAuditRepository(overrides = {}) {
  return {
    create: overrides.create || vi.fn().mockResolvedValue({}),
  };
}

function makeDeps(overrides = {}) {
  const election = overrides.election || makeElection();
  const position = overrides.position || makePosition();
  const candidate = overrides.candidate || makeCandidate();
  return {
    pool: {},
    withTransaction:
      overrides.withTransaction ||
      (async (fn) => {
        const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        return fn(mockClient);
      }),
    positionsRepository: {
      findById: overrides.findPositionById || (async () => position),
    },
    electionsRepository: {
      findById: overrides.findElectionById || (async () => election),
    },
    schedulingService: {
      computeState: overrides.computeState || (() => 'OPEN'),
    },
    participantsRepository: {
      findByElectionAndUser:
        overrides.findByElectionAndUser ||
        (async () => ({ election_id: election.id, user_id: 'user-1' })),
    },
    accessControlService: {
      canCastBallot: overrides.canCastBallot || (() => true),
    },
    candidatesRepository: {
      findById: overrides.findCandidateById || (async () => candidate),
    },
    auditRepository: overrides.auditRepository || makeAuditRepository(),
  };
}

// --- Position Lookup ---

describe('castPositionVote - position lookup', () => {
  it('returns error when the position is not found', async () => {
    const deps = makeDeps({ findPositionById: async () => null });
    const result = await castPositionVote(makeIdentity(), 'pos-unknown', 'cand-1', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Poste introuvable');
  });

  it('proceeds when the position is found', async () => {
    const deps = makeDeps();
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(result.success).toBe(true);
  });
});

// --- Voting Window Check ---

describe('castPositionVote - voting window check', () => {
  it('rejects the vote when the position window is CLOSED', async () => {
    const deps = makeDeps({ computeState: () => 'CLOSED' });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Le vote n'est pas ouvert pour ce poste");
  });

  it('allows the vote when the position window is OPEN', async () => {
    const deps = makeDeps({ computeState: () => 'OPEN' });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(result.success).toBe(true);
  });

  it('computes the window state from the position start/end instants', async () => {
    let received = null;
    const position = makePosition({ start_at: 'S', end_at: 'E' });
    const deps = makeDeps({
      position,
      computeState: (window) => {
        received = window;
        return 'OPEN';
      },
    });
    await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(received).toEqual({ start_at: 'S', end_at: 'E' });
  });
});

// --- Eligibility Check ---

describe('castPositionVote - eligibility check', () => {
  it('rejects the vote when the voter is not a participant', async () => {
    const deps = makeDeps({
      findByElectionAndUser: async () => null,
      canCastBallot: () => false,
    });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Vous n'êtes pas éligible pour voter dans cette élection");
  });

  it('rejects the vote when canCastBallot returns false (wrong association scope)', async () => {
    const deps = makeDeps({ canCastBallot: () => false });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Vous n'êtes pas éligible pour voter dans cette élection");
  });

  it('passes canCastBallot isParticipant=true when a participant record exists', async () => {
    let receivedContext = null;
    const deps = makeDeps({
      findByElectionAndUser: async () => ({ election_id: 'elec-1', user_id: 'user-1' }),
      canCastBallot: (_identity, _election, context) => {
        receivedContext = context;
        return true;
      },
    });
    await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(receivedContext).toEqual({ isParticipant: true });
  });

  it('passes canCastBallot isParticipant=false when no participant record', async () => {
    let receivedContext = null;
    const deps = makeDeps({
      findByElectionAndUser: async () => null,
      canCastBallot: (_identity, _election, context) => {
        receivedContext = context;
        return false;
      },
    });
    await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(receivedContext).toEqual({ isParticipant: false });
  });
});

// --- Candidate Validation ---

describe('castPositionVote - candidate validation', () => {
  it('rejects the vote when the candidate does not exist', async () => {
    const deps = makeDeps({ findCandidateById: async () => null });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-x', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Candidat invalide pour ce poste');
  });

  it('rejects the vote when the candidate belongs to a different position', async () => {
    const deps = makeDeps({
      findCandidateById: async () => makeCandidate({ id: 'cand-9', position_id: 'pos-other' }),
    });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-9', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Candidat invalide pour ce poste');
  });

  it('accepts the vote when the candidate belongs to the position', async () => {
    const deps = makeDeps({
      findCandidateById: async () => makeCandidate({ id: 'cand-1', position_id: 'pos-1' }),
    });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(result.success).toBe(true);
  });
});

// --- Successful Response ---

describe('castPositionVote - successful response', () => {
  it('returns success with the recorded flag when all checks pass', async () => {
    const deps = makeDeps();
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(result.success).toBe(true);
    expect(result.recorded).toBe(true);
  });

  it('returns a confirmedAt ISO timestamp in the success response', async () => {
    const before = new Date().toISOString();
    const deps = makeDeps();
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    const after = new Date().toISOString();

    expect(result.success).toBe(true);
    expect(result.recorded).toBe(true);
    expect(result.confirmedAt).toBeDefined();
    // Verify it's a valid ISO 8601 timestamp
    expect(new Date(result.confirmedAt).toISOString()).toBe(result.confirmedAt);
    // Verify the timestamp is within the test execution window
    expect(result.confirmedAt >= before).toBe(true);
    expect(result.confirmedAt <= after).toBe(true);
  });

  it('does not include confirmedAt on failure responses', async () => {
    const deps = makeDeps({ computeState: () => 'CLOSED' });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(result.success).toBe(false);
    expect(result.confirmedAt).toBeUndefined();
  });
});

// --- Pre-Check Order ---

describe('castPositionVote - pre-check order', () => {
  it('checks position existence before the window state', async () => {
    const deps = makeDeps({
      findPositionById: async () => null,
      computeState: () => 'CLOSED',
    });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    // Should get "not found" rather than "not open"
    expect(result.error).toBe('Poste introuvable');
  });

  it('checks the window state before eligibility', async () => {
    const deps = makeDeps({
      computeState: () => 'CLOSED',
      canCastBallot: () => false,
    });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    // Should get "not open" rather than "not eligible"
    expect(result.error).toBe("Le vote n'est pas ouvert pour ce poste");
  });

  it('checks eligibility before candidate validation', async () => {
    const deps = makeDeps({
      canCastBallot: () => false,
      findCandidateById: async () => null,
    });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    // Should get "not eligible" rather than "invalid candidate"
    expect(result.error).toBe("Vous n'êtes pas éligible pour voter dans cette élection");
  });
});

// --- Audit Logging ---

describe('castPositionVote - audit logging', () => {
  it('logs REJECTED audit when the position window is CLOSED', async () => {
    const auditRepo = makeAuditRepository();
    const deps = makeDeps({ computeState: () => 'CLOSED', auditRepository: auditRepo });
    await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(auditRepo.create).toHaveBeenCalledWith(
      deps.pool,
      expect.objectContaining({
        user_id: 'user-1',
        election_id: 'elec-1',
        outcome: 'REJECTED',
      })
    );
  });

  it('logs REJECTED audit when the voter is not eligible', async () => {
    const auditRepo = makeAuditRepository();
    const deps = makeDeps({
      findByElectionAndUser: async () => null,
      canCastBallot: () => false,
      auditRepository: auditRepo,
    });
    await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(auditRepo.create).toHaveBeenCalledWith(
      deps.pool,
      expect.objectContaining({
        user_id: 'user-1',
        election_id: 'elec-1',
        outcome: 'REJECTED',
      })
    );
  });

  it('logs REJECTED audit when the voter has already voted (unique violation)', async () => {
    const auditRepo = makeAuditRepository();
    const uniqueError = new Error('unique_violation');
    uniqueError.code = '23505';
    const deps = makeDeps({
      withTransaction: async () => {
        throw uniqueError;
      },
      auditRepository: auditRepo,
    });
    await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(auditRepo.create).toHaveBeenCalledWith(
      deps.pool,
      expect.objectContaining({
        user_id: 'user-1',
        election_id: 'elec-1',
        outcome: 'REJECTED',
      })
    );
  });

  it('logs REJECTED audit on a recording failure', async () => {
    const auditRepo = makeAuditRepository();
    const dbError = new Error('connection lost');
    dbError.code = '08006';
    const deps = makeDeps({
      withTransaction: async () => {
        throw dbError;
      },
      auditRepository: auditRepo,
    });
    await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(auditRepo.create).toHaveBeenCalledWith(
      deps.pool,
      expect.objectContaining({
        user_id: 'user-1',
        election_id: 'elec-1',
        outcome: 'REJECTED',
      })
    );
  });

  it('logs ACCEPTED audit when the vote is successfully recorded', async () => {
    const auditRepo = makeAuditRepository();
    const deps = makeDeps({ auditRepository: auditRepo });
    await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    expect(auditRepo.create).toHaveBeenCalledWith(
      deps.pool,
      expect.objectContaining({
        user_id: 'user-1',
        election_id: 'elec-1',
        outcome: 'ACCEPTED',
      })
    );
  });

  it('does not change the vote outcome when audit logging fails', async () => {
    const auditRepo = makeAuditRepository({
      create: vi.fn().mockRejectedValue(new Error('audit DB down')),
    });
    const deps = makeDeps({ auditRepository: auditRepo });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    // Vote should still succeed even though audit failed
    expect(result.success).toBe(true);
    expect(result.recorded).toBe(true);
  });

  it('does not change the rejection outcome when audit logging fails', async () => {
    const auditRepo = makeAuditRepository({
      create: vi.fn().mockRejectedValue(new Error('audit DB down')),
    });
    const deps = makeDeps({ computeState: () => 'CLOSED', auditRepository: auditRepo });
    const result = await castPositionVote(makeIdentity(), 'pos-1', 'cand-1', deps);
    // Vote should still be rejected with the right error
    expect(result.success).toBe(false);
    expect(result.error).toBe("Le vote n'est pas ouvert pour ce poste");
  });
});
