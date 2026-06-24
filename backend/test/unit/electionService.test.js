import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createFederationElection, createAssociationElection, validateElectionInput, addParticipatingAssociation, addCandidate } from '../../src/services/electionService.js';

/**
 * Creates a mock pool that satisfies withTransaction's contract:
 * pool.connect() -> client with query() and release()
 */
function createMockPool() {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return {
    connect: vi.fn().mockResolvedValue(mockClient),
    mockClient,
  };
}

describe('validateElectionInput()', () => {
  it('returns valid: true for complete valid input', () => {
    const result = validateElectionInput({
      name: 'Presidential Election',
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T18:00:00Z',
    });
    expect(result.valid).toBe(true);
    expect(result.startDate).toBeInstanceOf(Date);
    expect(result.endDate).toBeInstanceOf(Date);
  });

  it('reports name as required when missing', () => {
    const result = validateElectionInput({
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T18:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
  });

  it('reports name as required when empty string', () => {
    const result = validateElectionInput({
      name: '',
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T18:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
  });

  it('reports name as required when whitespace only', () => {
    const result = validateElectionInput({
      name: '   ',
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T18:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
  });

  it('reports start time as required when missing', () => {
    const result = validateElectionInput({
      name: 'Election',
      end: '2025-07-01T18:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('start time is required');
  });

  it('reports start time as required when invalid date string', () => {
    const result = validateElectionInput({
      name: 'Election',
      start: 'not-a-date',
      end: '2025-07-01T18:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('start time is required');
  });

  it('reports end time as required when missing', () => {
    const result = validateElectionInput({
      name: 'Election',
      start: '2025-07-01T10:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('end time is required');
  });

  it('reports end time as required when invalid date string', () => {
    const result = validateElectionInput({
      name: 'Election',
      start: '2025-07-01T10:00:00Z',
      end: 'garbage',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('end time is required');
  });

  it('reports all missing fields at once', () => {
    const result = validateElectionInput({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
    expect(result.errors).toContain('start time is required');
    expect(result.errors).toContain('end time is required');
    expect(result.errors).toHaveLength(3);
  });

  it('rejects when end is equal to start', () => {
    const result = validateElectionInput({
      name: 'Election',
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T10:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('The end time must be later than the start time');
  });

  it('rejects when end is earlier than start', () => {
    const result = validateElectionInput({
      name: 'Election',
      start: '2025-07-01T18:00:00Z',
      end: '2025-07-01T10:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('The end time must be later than the start time');
  });

  it('accepts start/end with timezone offsets', () => {
    const result = validateElectionInput({
      name: 'Election',
      start: '2025-07-01T10:00:00+05:30',
      end: '2025-07-01T18:00:00+05:30',
    });
    expect(result.valid).toBe(true);
  });
});

describe('createFederationElection()', () => {
  const identity = { id: 'user-1', role: 'FEDERATION_ADMINISTRATOR', association_id: null };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns errors when validation fails (missing name)', async () => {
    const result = await createFederationElection(identity, {
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T18:00:00Z',
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('name is required');
  });

  it('returns errors when validation fails (missing all fields)', async () => {
    const result = await createFederationElection(identity, {});
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it('returns errors when end <= start', async () => {
    const result = await createFederationElection(identity, {
      name: 'Election',
      start: '2025-07-01T18:00:00Z',
      end: '2025-07-01T10:00:00Z',
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('The end time must be later than the start time');
  });

  it('creates a federation election with scope FEDERATION and association_id null', async () => {
    const mockElection = {
      id: 'election-uuid',
      name: 'Presidential Election 2025',
      scope: 'FEDERATION',
      association_id: null,
      start_at: new Date('2025-07-01T10:00:00Z'),
      end_at: new Date('2025-07-01T18:00:00Z'),
    };

    const mockPool = createMockPool();
    // The real repository.create will run INSERT...RETURNING, mock client.query returns the row
    mockPool.mockClient.query.mockResolvedValue({ rows: [mockElection] });

    const result = await createFederationElection(identity, {
      name: 'Presidential Election 2025',
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T18:00:00Z',
    }, { pool: mockPool });

    expect(result.success).toBe(true);
    expect(result.election.id).toBe('election-uuid');
    expect(result.election.name).toBe('Presidential Election 2025');
    expect(result.election.scope).toBe('FEDERATION');
    expect(result.election.association_id).toBeNull();
    expect(result.election.start_at).toEqual(new Date('2025-07-01T10:00:00Z'));
    expect(result.election.end_at).toEqual(new Date('2025-07-01T18:00:00Z'));
  });

  it('calls the repository with correct scope and null association_id', async () => {
    const mockElection = {
      id: 'el-1',
      name: 'Test',
      scope: 'FEDERATION',
      association_id: null,
      start_at: new Date('2025-07-01T10:00:00Z'),
      end_at: new Date('2025-07-01T18:00:00Z'),
    };

    const mockPool = createMockPool();
    mockPool.mockClient.query.mockResolvedValue({ rows: [mockElection] });

    await createFederationElection(identity, {
      name: '  Test  ',
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T18:00:00Z',
    }, { pool: mockPool });

    // Verify the INSERT query was called (BEGIN, INSERT...RETURNING, COMMIT)
    const calls = mockPool.mockClient.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    // Second call is the INSERT
    expect(calls[1][0]).toContain('INSERT INTO elections');
    expect(calls[1][1]).toEqual([
      'Test',
      'FEDERATION',
      null,
      expect.any(String),
      expect.any(String),
      null,
      null,
      'user-1',
    ]);
    expect(calls[2][0]).toBe('COMMIT');
  });
});

describe('createAssociationElection()', () => {
  const identity = { id: 'user-2', role: 'ASSOCIATION_MANAGER', association_id: 'assoc-123' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns errors when validation fails (missing end)', async () => {
    const result = await createAssociationElection(identity, {
      name: 'Internal Election',
      start: '2025-07-01T10:00:00Z',
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('end time is required');
  });

  it('returns errors when validation fails (invalid start)', async () => {
    const result = await createAssociationElection(identity, {
      name: 'Election',
      start: 'not-valid',
      end: '2025-07-01T18:00:00Z',
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('start time is required');
  });

  it('creates an association election with scope ASSOCIATION and the managers association_id', async () => {
    const mockElection = {
      id: 'election-uuid-2',
      name: 'Board Election',
      scope: 'ASSOCIATION',
      association_id: 'assoc-123',
      start_at: new Date('2025-08-01T09:00:00Z'),
      end_at: new Date('2025-08-01T17:00:00Z'),
    };

    const mockPool = createMockPool();
    mockPool.mockClient.query.mockResolvedValue({ rows: [mockElection] });

    const result = await createAssociationElection(identity, {
      name: 'Board Election',
      start: '2025-08-01T09:00:00Z',
      end: '2025-08-01T17:00:00Z',
    }, { pool: mockPool });

    expect(result.success).toBe(true);
    expect(result.election.id).toBe('election-uuid-2');
    expect(result.election.name).toBe('Board Election');
    expect(result.election.scope).toBe('ASSOCIATION');
    expect(result.election.association_id).toBe('assoc-123');
    expect(result.election.start_at).toEqual(new Date('2025-08-01T09:00:00Z'));
    expect(result.election.end_at).toEqual(new Date('2025-08-01T17:00:00Z'));
  });

  it('calls the repository with scope ASSOCIATION and the identity association_id', async () => {
    const mockElection = {
      id: 'el-2',
      name: 'Election',
      scope: 'ASSOCIATION',
      association_id: 'assoc-123',
      start_at: new Date('2025-08-01T09:00:00Z'),
      end_at: new Date('2025-08-01T17:00:00Z'),
    };

    const mockPool = createMockPool();
    mockPool.mockClient.query.mockResolvedValue({ rows: [mockElection] });

    await createAssociationElection(identity, {
      name: 'Election',
      start: '2025-08-01T09:00:00Z',
      end: '2025-08-01T17:00:00Z',
    }, { pool: mockPool });

    // Verify the INSERT query was called (BEGIN, INSERT...RETURNING, COMMIT)
    const calls = mockPool.mockClient.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    // Second call is the INSERT
    expect(calls[1][0]).toContain('INSERT INTO elections');
    expect(calls[1][1]).toEqual([
      'Election',
      'ASSOCIATION',
      'assoc-123',
      expect.any(String),
      expect.any(String),
      null,
      null,
      'user-2',
    ]);
    expect(calls[2][0]).toBe('COMMIT');
  });

  it('returns time-ordering error when end equals start', async () => {
    const result = await createAssociationElection(identity, {
      name: 'Election',
      start: '2025-07-01T10:00:00Z',
      end: '2025-07-01T10:00:00Z',
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('The end time must be later than the start time');
  });
});

describe('addParticipatingAssociation()', () => {
  it('returns success when the association is added successfully', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    const result = await addParticipatingAssociation('election-1', 'assoc-1', { pool: mockPool });

    expect(result).toEqual({ success: true });
    expect(mockPool.query).toHaveBeenCalledWith(
      'INSERT INTO federation_election_associations (election_id, association_id) VALUES ($1, $2)',
      ['election-1', 'assoc-1']
    );
  });

  it('returns error when the association is already a participating scope (unique violation)', async () => {
    const uniqueViolationError = new Error('duplicate key value violates unique constraint');
    uniqueViolationError.code = '23505';

    const mockPool = {
      query: vi.fn().mockRejectedValue(uniqueViolationError),
    };

    const result = await addParticipatingAssociation('election-1', 'assoc-1', { pool: mockPool });

    expect(result).toEqual({
      success: false,
      error: 'The association is already a participating scope of that federation election',
    });
  });

  it('re-throws non-unique-violation database errors', async () => {
    const otherError = new Error('connection refused');
    otherError.code = '08006';

    const mockPool = {
      query: vi.fn().mockRejectedValue(otherError),
    };

    await expect(
      addParticipatingAssociation('election-1', 'assoc-1', { pool: mockPool })
    ).rejects.toThrow('connection refused');
  });

  it('uses the default pool when opts is not provided', async () => {
    // This test verifies the function signature accepts no opts.
    // We can't easily test the real pool, so we just verify it throws
    // (since there's no real DB connection in unit tests).
    await expect(
      addParticipatingAssociation('election-1', 'assoc-1')
    ).rejects.toThrow();
  });
});


import { addPosition, publishPosition, addParticipant, bulkAddParticipants, validateParticipants } from '../../src/services/electionService.js';

describe('addPosition()', () => {
  const electionId = 'election-uuid-1';

  // The election's management window is still open (end far in the future).
  const futureEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const openElection = {
    id: electionId,
    name: 'Test Election',
    scope: 'FEDERATION',
    association_id: null,
    start_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_at: futureEnd,
  };

  function validInput(overrides = {}) {
    return { name: 'President', ...overrides };
  }

  function createMockDeps(overrides = {}) {
    return {
      electionsRepository: {
        findById: vi.fn().mockResolvedValue(openElection),
        ...overrides.electionsRepository,
      },
      positionsRepository: {
        countByElection: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({
          id: 'pos-uuid-1',
          election_id: electionId,
          name: 'President',
          start_at: null,
          end_at: null,
          schedule_timezone: null,
          published: false,
        }),
        ...overrides.positionsRepository,
      },
    };
  }

  describe('name validation', () => {
    it('rejects when name is undefined', async () => {
      const result = await addPosition(electionId, validInput({ name: undefined }), createMockDeps());
      expect(result).toEqual({ success: false, error: 'Position name is required' });
    });

    it('rejects when name is empty string', async () => {
      const result = await addPosition(electionId, validInput({ name: '' }), createMockDeps());
      expect(result).toEqual({ success: false, error: 'Position name is required' });
    });

    it('rejects when name is whitespace only', async () => {
      const result = await addPosition(electionId, validInput({ name: '   ' }), createMockDeps());
      expect(result).toEqual({ success: false, error: 'Position name is required' });
    });
  });

  describe('election lookup and management window', () => {
    it('rejects when the election is not found', async () => {
      const deps = createMockDeps({ electionsRepository: { findById: vi.fn().mockResolvedValue(null) } });
      const result = await addPosition(electionId, validInput(), deps);
      expect(result).toEqual({ success: false, error: 'Election not found' });
    });

    it('rejects when the election has already ended', async () => {
      const deps = createMockDeps({
        electionsRepository: { findById: vi.fn().mockResolvedValue({ ...openElection, end_at: pastEnd }) },
      });
      const result = await addPosition(electionId, validInput(), deps);
      expect(result).toEqual({
        success: false,
        error: "L'élection est terminée; impossible d'ajouter un poste",
      });
    });
  });

  describe('position cap (50 max)', () => {
    it('rejects when the election already has 50 positions', async () => {
      const deps = createMockDeps({ positionsRepository: { countByElection: vi.fn().mockResolvedValue(50) } });
      const result = await addPosition(electionId, validInput(), deps);
      expect(result).toEqual({
        success: false,
        error: 'The maximum number of positions per election has been reached',
      });
    });
  });

  describe('successful DRAFT creation', () => {
    it('creates a DRAFT position with name only and returns published false', async () => {
      const deps = createMockDeps();
      const result = await addPosition(electionId, validInput(), deps);

      expect(result).toEqual({
        success: true,
        position: {
          id: 'pos-uuid-1',
          election_id: electionId,
          name: 'President',
          start_at: null,
          end_at: null,
          schedule_timezone: null,
          published: false,
        },
      });
    });

    it('inserts only the trimmed name (no voting window)', async () => {
      const deps = createMockDeps();
      await addPosition(electionId, validInput({ name: '  Vice President  ' }), deps);

      expect(deps.positionsRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        { election_id: electionId, name: 'Vice President' }
      );
    });

    it('allows creation at count 49 (under the cap)', async () => {
      const deps = createMockDeps({ positionsRepository: { countByElection: vi.fn().mockResolvedValue(49) } });
      deps.positionsRepository.create = vi.fn().mockResolvedValue({
        id: 'pos-uuid-3', election_id: electionId, name: 'Treasurer',
        start_at: null, end_at: null, schedule_timezone: null, published: false,
      });
      const result = await addPosition(electionId, validInput({ name: 'Treasurer' }), deps);
      expect(result.success).toBe(true);
    });
  });
});


describe('publishPosition()', () => {
  const electionId = 'election-uuid-1';
  const positionId = 'pos-uuid-1';

  // Election management window: starts in the past, ends far in the future.
  const electionStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const electionEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // A voting window inside the election window (and in the future).
  const voteStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const voteEnd = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const openElection = {
    id: electionId,
    scope: 'FEDERATION',
    association_id: null,
    start_at: electionStart,
    end_at: electionEnd,
  };

  const draftPosition = {
    id: positionId,
    election_id: electionId,
    name: 'President',
    start_at: null,
    end_at: null,
    schedule_timezone: null,
    published: false,
  };

  function createMockDeps(overrides = {}) {
    return {
      electionsRepository: {
        findById: vi.fn().mockResolvedValue(openElection),
        ...overrides.electionsRepository,
      },
      positionsRepository: {
        findById: vi.fn().mockResolvedValue(draftPosition),
        publish: vi.fn().mockResolvedValue({
          id: positionId,
          election_id: electionId,
          name: 'President',
          start_at: voteStart,
          end_at: voteEnd,
          schedule_timezone: 'Africa/Abidjan',
          published: true,
        }),
        ...overrides.positionsRepository,
      },
      candidatesRepository: {
        countByPosition: vi.fn().mockResolvedValue(1),
        ...overrides.candidatesRepository,
      },
    };
  }

  function validInput(overrides = {}) {
    return { start: voteStart, end: voteEnd, timezone: 'Africa/Abidjan', ...overrides };
  }

  it('publishes a draft within the election window and returns the published position', async () => {
    const deps = createMockDeps();
    const result = await publishPosition(positionId, validInput(), deps);

    expect(result.success).toBe(true);
    expect(result.position).toEqual({
      id: positionId,
      election_id: electionId,
      name: 'President',
      start_at: voteStart,
      end_at: voteEnd,
      schedule_timezone: 'Africa/Abidjan',
      published: true,
    });
    expect(deps.positionsRepository.publish).toHaveBeenCalledWith(
      expect.anything(),
      positionId,
      {
        start_at: new Date(voteStart).toISOString(),
        end_at: new Date(voteEnd).toISOString(),
        schedule_timezone: 'Africa/Abidjan',
      }
    );
  });

  it('rejects when the position is not found', async () => {
    const deps = createMockDeps({ positionsRepository: { findById: vi.fn().mockResolvedValue(null) } });
    const result = await publishPosition(positionId, validInput(), deps);
    expect(result).toEqual({ success: false, error: 'Position not found' });
  });

  it('rejects when the election is not found', async () => {
    const deps = createMockDeps({ electionsRepository: { findById: vi.fn().mockResolvedValue(null) } });
    const result = await publishPosition(positionId, validInput(), deps);
    expect(result).toEqual({ success: false, error: 'Election not found' });
  });

  it('rejects when the election has already ended', async () => {
    const deps = createMockDeps({
      electionsRepository: { findById: vi.fn().mockResolvedValue({ ...openElection, end_at: pastEnd }) },
    });
    const result = await publishPosition(positionId, validInput(), deps);
    expect(result).toEqual({
      success: false,
      error: "L'élection est terminée; impossible de publier ce poste",
    });
  });

  it('rejects when the position is already published and voting has started', async () => {
    const startedPosition = {
      ...draftPosition,
      published: true,
      start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      end_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const deps = createMockDeps({ positionsRepository: { findById: vi.fn().mockResolvedValue(startedPosition) } });
    const result = await publishPosition(positionId, validInput(), deps);
    expect(result).toEqual({
      success: false,
      error: 'Le vote de ce poste a déjà commencé; modification impossible',
    });
  });

  it('rejects when the position has no candidates', async () => {
    const deps = createMockDeps({
      candidatesRepository: { countByPosition: vi.fn().mockResolvedValue(0) },
    });
    const result = await publishPosition(positionId, validInput(), deps);
    expect(result).toEqual({
      success: false,
      error: 'Le poste doit avoir au moins un candidat pour être publié',
    });
  });

  describe('window validation', () => {
    const timingError =
      "Veuillez fournir une date d'ouverture et de clôture valides (la clôture doit être après l'ouverture)";

    it('rejects when start is missing', async () => {
      const result = await publishPosition(positionId, validInput({ start: undefined }), createMockDeps());
      expect(result).toEqual({ success: false, error: timingError });
    });

    it('rejects when end is missing', async () => {
      const result = await publishPosition(positionId, validInput({ end: undefined }), createMockDeps());
      expect(result).toEqual({ success: false, error: timingError });
    });

    it('rejects when start is an invalid date', async () => {
      const result = await publishPosition(positionId, validInput({ start: 'not-a-date' }), createMockDeps());
      expect(result).toEqual({ success: false, error: timingError });
    });

    it('rejects when end is not after start', async () => {
      const result = await publishPosition(positionId, validInput({ start: voteEnd, end: voteStart }), createMockDeps());
      expect(result).toEqual({ success: false, error: timingError });
    });
  });

  describe('window must be inside the election window', () => {
    const boundsError = "La fenêtre de vote du poste doit être comprise dans la période de l'élection";

    it('rejects when the window starts before the election start', async () => {
      const before = new Date(new Date(electionStart).getTime() - 60 * 60 * 1000).toISOString();
      const result = await publishPosition(
        positionId,
        validInput({ start: before, end: voteEnd }),
        createMockDeps()
      );
      expect(result).toEqual({ success: false, error: boundsError });
    });

    it('rejects when the window ends after the election end', async () => {
      const after = new Date(new Date(electionEnd).getTime() + 60 * 60 * 1000).toISOString();
      const result = await publishPosition(
        positionId,
        validInput({ start: voteStart, end: after }),
        createMockDeps()
      );
      expect(result).toEqual({ success: false, error: boundsError });
    });
  });
});


describe('addParticipant()', () => {
  const federationElection = { id: 'fed-election-1', scope: 'FEDERATION', association_id: null };
  const associationElection = { id: 'assoc-election-1', scope: 'ASSOCIATION', association_id: 'assoc-1' };
  const identity = { id: 'mgr-1', role: 'FEDERATION_ELECTION_MANAGER', association_id: null };

  function createMockDeps(overrides = {}) {
    return {
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-user-1' }),
        ...overrides.usersRepository,
      },
      participantsRepository: {
        create: vi.fn().mockResolvedValue({ election_id: 'fed-election-1', user_id: 'new-user-1' }),
        findByEmailInElection: vi.fn().mockResolvedValue(null),
        countByElectionAndAssociation: vi.fn().mockResolvedValue(0),
        ...overrides.participantsRepository,
      },
      credentialService: {
        generateTemporaryPassword: vi.fn().mockReturnValue('Temp1234!xyz'),
        hashPassword: vi.fn().mockResolvedValue('$2b$10$hash'),
        ...overrides.credentialService,
      },
      emailService: {
        sendCredentials: vi.fn().mockResolvedValue({ success: true }),
        ...overrides.emailService,
      },
      associationsRepository: {
        findById: vi.fn().mockResolvedValue({ id: 'assoc-1', name: 'Mon Association', logo_ref: 'https://cdn/assoc-logo.png' }),
        ...overrides.associationsRepository,
      },
      withTransaction: overrides.withTransaction || (async (fn) => fn({})),
    };
  }

  it('creates a new federation voter and sends a FA2I-branded credential email', async () => {
    process.env.FEDERATION_LOGO_URL = 'https://cdn/fed-logo.png';
    const deps = createMockDeps();

    const result = await addParticipant(
      federationElection,
      { email: 'Voter@Example.com', fullName: 'Voter One' },
      identity,
      deps
    );

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.existingAccount).toBe(false);
    expect(result.participant).toEqual({ election_id: 'fed-election-1', user_id: 'new-user-1' });

    // Looked up globally by email (any association / active state)
    expect(deps.usersRepository.findAnyByEmail).toHaveBeenCalledWith({}, 'voter@example.com');

    // Created VOTER with full_name and null association
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
      role: 'VOTER',
      associationId: null,
      fullName: 'Voter One',
    }));

    // Branded with the federation logo + FA2I
    expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
      'Voter One',
      'Voter@Example.com',
      'Temp1234!xyz',
      { logoUrl: 'https://cdn/fed-logo.png', brandName: 'FA2I' }
    );
  });

  it('creates an association voter branded with the association logo and name', async () => {
    const deps = createMockDeps({
      participantsRepository: {
        create: vi.fn().mockResolvedValue({ election_id: 'assoc-election-1', user_id: 'new-user-1' }),
      },
    });

    const result = await addParticipant(
      associationElection,
      { email: 'member@example.com', fullName: 'Member One' },
      identity,
      deps
    );

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.existingAccount).toBe(false);

    // Global lookup by email (association scope no longer narrows the search)
    expect(deps.usersRepository.findAnyByEmail).toHaveBeenCalledWith({}, 'member@example.com');

    // Branded with the association logo + name
    expect(deps.associationsRepository.findById).toHaveBeenCalledWith({}, 'assoc-1');
    expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
      'Member One',
      'member@example.com',
      'Temp1234!xyz',
      { logoUrl: 'https://cdn/assoc-logo.png', brandName: 'Mon Association' }
    );
  });

  it('does NOT send an email when the user already exists', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue({ id: 'existing-user' }),
        create: vi.fn(),
      },
      participantsRepository: {
        create: vi.fn().mockResolvedValue({ election_id: 'fed-election-1', user_id: 'existing-user' }),
      },
    });

    const result = await addParticipant(
      federationElection,
      { email: 'existing@example.com', fullName: 'Existing' },
      identity,
      deps
    );

    expect(result.success).toBe(true);
    expect(result.created).toBe(false);
    expect(result.existingAccount).toBe(true);
    expect(result.participant.user_id).toBe('existing-user');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
    expect(deps.emailService.sendCredentials).not.toHaveBeenCalled();
  });

  it('reports a duplicate participant on unique violation', async () => {
    const dup = new Error('duplicate'); dup.code = '23505';
    const deps = createMockDeps({
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue({ id: 'existing-user' }),
        create: vi.fn(),
      },
      participantsRepository: { create: vi.fn().mockRejectedValue(dup) },
    });

    const result = await addParticipant(
      federationElection,
      { email: 'dup@example.com', fullName: 'Dup' },
      identity,
      deps
    );

    expect(result).toEqual({
      success: false,
      error: 'The user is already a participant of this election',
    });
  });
});


describe('bulkAddParticipants()', () => {
  const federationElection = { id: 'fed-election-1', scope: 'FEDERATION', association_id: null };
  const identity = { id: 'mgr-1', role: 'FEDERATION_ELECTION_MANAGER', association_id: null };

  it('summarizes a mix of new, duplicate, and failing rows', async () => {
    const dup = new Error('duplicate'); dup.code = '23505';

    const usersRepository = {
      // row1 (new@): not found → created. row2 (dup@): found existing.
      findAnyByEmail: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing-user' }),
      create: vi.fn().mockResolvedValue({ id: 'new-user-1' }),
    };
    const participantsRepository = {
      create: vi.fn()
        .mockResolvedValueOnce({ election_id: 'fed-election-1', user_id: 'new-user-1' }) // row1 added
        .mockRejectedValueOnce(dup), // row2 duplicate
      findByEmailInElection: vi.fn().mockResolvedValue(null),
      countByElectionAndAssociation: vi.fn().mockResolvedValue(0),
    };
    const deps = {
      usersRepository,
      participantsRepository,
      credentialService: {
        generateTemporaryPassword: vi.fn().mockReturnValue('Temp1234!xyz'),
        hashPassword: vi.fn().mockResolvedValue('$2b$10$hash'),
      },
      emailService: { sendCredentials: vi.fn().mockResolvedValue({ success: true }) },
      associationsRepository: { findById: vi.fn() },
      withTransaction: async (fn) => fn({}),
    };

    const rows = [
      { fullName: 'New One', email: 'new@example.com' }, // added
      { fullName: 'Dup One', email: 'dup@example.com' }, // duplicate
      { fullName: 'Bad One', email: '' }, // failed (missing email)
    ];

    const result = await bulkAddParticipants(federationElection, rows, identity, deps);

    expect(result.success).toBe(true);
    expect(result.summary.added).toBe(1);
    expect(result.summary.reused).toBe(0);
    expect(result.summary.duplicates).toBe(1);
    expect(result.summary.failed).toHaveLength(1);
    expect(result.summary.failed[0].email).toBe('');
  });
});


describe('addCandidate()', () => {
  const positionId = 'position-uuid-1';
  const electionId = 'election-uuid-1';

  const futureEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const openElection = {
    id: electionId,
    scope: 'FEDERATION',
    association_id: null,
    start_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_at: futureEnd,
  };

  const draftPosition = {
    id: positionId,
    election_id: electionId,
    name: 'President',
    start_at: null,
    end_at: null,
    schedule_timezone: null,
    published: false,
  };

  function createMockDeps(overrides = {}) {
    return {
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
      },
      photoStorageService: {
        storeImage: vi.fn().mockResolvedValue({ reference: 'https://cloudinary.com/photo123.jpg' }),
      },
      candidatesRepository: {
        countByPosition: vi.fn().mockResolvedValue(5),
        create: vi.fn().mockResolvedValue({
          id: 'candidate-uuid-1',
          position_id: positionId,
          name: 'John Doe',
          photo_ref: 'https://cloudinary.com/photo123.jpg',
          motivation: 'I want to serve the community',
        }),
      },
      positionsRepository: {
        findById: vi.fn().mockResolvedValue(draftPosition),
        ...overrides.positionsRepository,
      },
      electionsRepository: {
        findById: vi.fn().mockResolvedValue(openElection),
        ...overrides.electionsRepository,
      },
      ...overrides,
    };
  }

  function validInput() {
    return {
      name: 'John Doe',
      photo: Buffer.from('fake-photo-data'),
      motivation: 'I want to serve the community',
      photoMimeType: 'image/jpeg',
      photoSize: 1024 * 1024, // 1 MB
    };
  }

  describe('name validation', () => {
    it('rejects when name is missing', async () => {
      const deps = createMockDeps();
      const input = validInput();
      delete input.name;

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate name is required');
    });

    it('rejects when name is empty string', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), name: '' };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate name is required');
    });

    it('rejects when name is whitespace only', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), name: '   ' };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate name is required');
    });

    it('rejects when name exceeds 100 characters', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), name: 'A'.repeat(101) };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate name must not exceed 100 characters');
    });

    it('accepts a name of exactly 100 characters', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), name: 'A'.repeat(100) };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(true);
    });
  });

  describe('motivation validation', () => {
    it('rejects when motivation is missing', async () => {
      const deps = createMockDeps();
      const input = validInput();
      delete input.motivation;

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate motivation is required');
    });

    it('rejects when motivation is empty string', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), motivation: '' };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate motivation is required');
    });

    it('rejects when motivation is whitespace only', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), motivation: '   ' };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate motivation is required');
    });

    it('rejects when motivation exceeds 1000 characters', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), motivation: 'M'.repeat(1001) };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate motivation must not exceed 1000 characters');
    });

    it('accepts a motivation of exactly 1000 characters', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), motivation: 'M'.repeat(1000) };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(true);
    });
  });

  describe('photo validation', () => {
    it('rejects when photo is missing', async () => {
      const deps = createMockDeps();
      const input = validInput();
      delete input.photo;

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate photo is required');
    });

    it('rejects when photo is null', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), photo: null };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate photo is required');
    });

    it('rejects when photoMimeType is not JPEG or PNG', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), photoMimeType: 'image/gif' };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Photo must be JPEG or PNG format');
    });

    it('rejects when photoMimeType is missing', async () => {
      const deps = createMockDeps();
      const input = validInput();
      delete input.photoMimeType;

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Photo must be JPEG or PNG format');
    });

    it('accepts image/jpeg', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), photoMimeType: 'image/jpeg' };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(true);
    });

    it('accepts image/png', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), photoMimeType: 'image/png' };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(true);
    });

    it('rejects when photoSize exceeds 5 MB', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), photoSize: 5 * 1024 * 1024 + 1 };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Photo must not exceed 5 MB');
    });

    it('accepts photo exactly at 5 MB', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), photoSize: 5 * 1024 * 1024 };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(true);
    });
  });

  describe('multiple validation errors', () => {
    it('collects all validation errors at once', async () => {
      const deps = createMockDeps();
      const input = {
        name: '',
        motivation: '',
        photo: null,
      };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate name is required');
      expect(result.errors).toContain('Candidate motivation is required');
      expect(result.errors).toContain('Candidate photo is required');
    });

    it('reports name too long and motivation too long together', async () => {
      const deps = createMockDeps();
      const input = {
        ...validInput(),
        name: 'A'.repeat(101),
        motivation: 'M'.repeat(1001),
      };

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Candidate name must not exceed 100 characters');
      expect(result.errors).toContain('Candidate motivation must not exceed 1000 characters');
    });
  });

  describe('candidate count cap', () => {
    it('rejects when position already has 100 candidates', async () => {
      const deps = createMockDeps({
        candidatesRepository: {
          countByPosition: vi.fn().mockResolvedValue(100),
          create: vi.fn(),
        },
      });

      const result = await addCandidate(positionId, validInput(), deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum number of candidates per position has been reached');
      expect(deps.candidatesRepository.create).not.toHaveBeenCalled();
    });

    it('allows creation at count 99 (under the cap)', async () => {
      const deps = createMockDeps({
        candidatesRepository: {
          countByPosition: vi.fn().mockResolvedValue(99),
          create: vi.fn().mockResolvedValue({
            id: 'candidate-uuid',
            position_id: positionId,
            name: 'John Doe',
            photo_ref: 'https://cloudinary.com/photo.jpg',
            motivation: 'I want to serve',
          }),
        },
      });

      const result = await addCandidate(positionId, validInput(), deps);

      expect(result.success).toBe(true);
    });
  });

  describe('photo storage', () => {
    it('rejects when photo storage fails (returns null reference)', async () => {
      const deps = createMockDeps({
        photoStorageService: {
          storeImage: vi.fn().mockResolvedValue({ reference: null, error: 'Upload failed' }),
        },
      });

      const result = await addCandidate(positionId, validInput(), deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Photo storage failed');
    });

    it('calls photoStorageService.storeImage with the photo and kind "candidate_photo"', async () => {
      const deps = createMockDeps();
      const input = validInput();

      await addCandidate(positionId, input, deps);

      expect(deps.photoStorageService.storeImage).toHaveBeenCalledWith(input.photo, 'candidate_photo');
    });

    it('does not create a candidate record when photo storage fails', async () => {
      const deps = createMockDeps({
        photoStorageService: {
          storeImage: vi.fn().mockResolvedValue({ reference: null }),
        },
      });

      await addCandidate(positionId, validInput(), deps);

      expect(deps.candidatesRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('successful creation', () => {
    it('creates a candidate and returns the result', async () => {
      const deps = createMockDeps();
      const input = validInput();

      const result = await addCandidate(positionId, input, deps);

      expect(result.success).toBe(true);
      expect(result.candidate).toEqual({
        id: 'candidate-uuid-1',
        position_id: positionId,
        name: 'John Doe',
        photo_ref: 'https://cloudinary.com/photo123.jpg',
        motivation: 'I want to serve the community',
      });
    });

    it('trims name and motivation before inserting', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), name: '  Jane Doe  ', motivation: '  My motivation  ' };

      await addCandidate(positionId, input, deps);

      expect(deps.candidatesRepository.create).toHaveBeenCalledWith(
        deps.pool,
        expect.objectContaining({
          name: 'Jane Doe',
          motivation: 'My motivation',
        })
      );
    });

    it('passes the photo reference from storage to the repository', async () => {
      const deps = createMockDeps({
        photoStorageService: {
          storeImage: vi.fn().mockResolvedValue({ reference: 'https://cloudinary.com/stored-ref.jpg' }),
        },
      });

      await addCandidate(positionId, validInput(), deps);

      expect(deps.candidatesRepository.create).toHaveBeenCalledWith(
        deps.pool,
        expect.objectContaining({
          photo_ref: 'https://cloudinary.com/stored-ref.jpg',
        })
      );
    });

    it('passes positionId to the repository', async () => {
      const deps = createMockDeps();

      await addCandidate(positionId, validInput(), deps);

      expect(deps.candidatesRepository.create).toHaveBeenCalledWith(
        deps.pool,
        expect.objectContaining({
          position_id: positionId,
        })
      );
    });
  });

  describe('publish / ended locks', () => {
    it('succeeds when the position is a DRAFT (published false)', async () => {
      const deps = createMockDeps();
      const result = await addCandidate(positionId, validInput(), deps);
      expect(result.success).toBe(true);
      expect(deps.candidatesRepository.create).toHaveBeenCalled();
    });

    it('rejects when the position is published', async () => {
      const deps = createMockDeps({
        positionsRepository: {
          findById: vi.fn().mockResolvedValue({ ...draftPosition, published: true }),
        },
      });
      const result = await addCandidate(positionId, validInput(), deps);
      expect(result).toEqual({
        success: false,
        error: "Ce poste est publié; impossible d'ajouter un candidat",
      });
      expect(deps.candidatesRepository.create).not.toHaveBeenCalled();
    });

    it('rejects when the election has already ended', async () => {
      const deps = createMockDeps({
        electionsRepository: {
          findById: vi.fn().mockResolvedValue({ ...openElection, end_at: pastEnd }),
        },
      });
      const result = await addCandidate(positionId, validInput(), deps);
      expect(result).toEqual({
        success: false,
        error: "L'élection est terminée; impossible d'ajouter un candidat",
      });
      expect(deps.candidatesRepository.create).not.toHaveBeenCalled();
    });

    it('rejects when the position is not found', async () => {
      const deps = createMockDeps({
        positionsRepository: { findById: vi.fn().mockResolvedValue(null) },
      });
      const result = await addCandidate(positionId, validInput(), deps);
      expect(result).toEqual({ success: false, error: 'Position not found' });
      expect(deps.candidatesRepository.create).not.toHaveBeenCalled();
    });
  });
});


describe('createFederationElection() — voters_per_association quota', () => {
  const identity = { id: 'user-1', role: 'FEDERATION_ADMINISTRATOR', association_id: null };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores votersPerAssociation and returns it on the election', async () => {
    const mockElection = {
      id: 'el-q',
      name: 'Quota Election',
      scope: 'FEDERATION',
      association_id: null,
      start_at: new Date('2030-07-01T10:00:00Z'),
      end_at: new Date('2030-07-01T18:00:00Z'),
      schedule_timezone: null,
      voters_per_association: 5,
    };
    const mockPool = createMockPool();
    mockPool.mockClient.query.mockResolvedValue({ rows: [mockElection] });

    const result = await createFederationElection(identity, {
      name: 'Quota Election',
      start: '2030-07-01T10:00:00Z',
      end: '2030-07-01T18:00:00Z',
      votersPerAssociation: 5,
    }, { pool: mockPool });

    expect(result.success).toBe(true);
    expect(result.election.voters_per_association).toBe(5);

    // The INSERT receives the quota as the 7th parameter.
    const calls = mockPool.mockClient.query.mock.calls;
    expect(calls[1][1][6]).toBe(5);
  });

  it('passes null when votersPerAssociation is not provided', async () => {
    const mockElection = {
      id: 'el-n', name: 'No Quota', scope: 'FEDERATION', association_id: null,
      start_at: new Date('2030-07-01T10:00:00Z'), end_at: new Date('2030-07-01T18:00:00Z'),
      schedule_timezone: null, voters_per_association: null,
    };
    const mockPool = createMockPool();
    mockPool.mockClient.query.mockResolvedValue({ rows: [mockElection] });

    const result = await createFederationElection(identity, {
      name: 'No Quota',
      start: '2030-07-01T10:00:00Z',
      end: '2030-07-01T18:00:00Z',
    }, { pool: mockPool });

    expect(result.success).toBe(true);
    expect(result.election.voters_per_association).toBeNull();
    const calls = mockPool.mockClient.query.mock.calls;
    expect(calls[1][1][6]).toBeNull();
  });
});


describe('addParticipant() — duplicate email and quota', () => {
  const identity = { id: 'mgr-1', role: 'FEDERATION_ELECTION_MANAGER', association_id: null };

  function baseDeps(overrides = {}) {
    return {
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-user-1' }),
        ...overrides.usersRepository,
      },
      participantsRepository: {
        create: vi.fn().mockResolvedValue({ election_id: 'fed-election-1', user_id: 'new-user-1' }),
        findByEmailInElection: vi.fn().mockResolvedValue(null),
        countByElectionAndAssociation: vi.fn().mockResolvedValue(0),
        ...overrides.participantsRepository,
      },
      credentialService: {
        generateTemporaryPassword: vi.fn().mockReturnValue('Temp1234!xyz'),
        hashPassword: vi.fn().mockResolvedValue('$2b$10$hash'),
      },
      emailService: { sendCredentials: vi.fn().mockResolvedValue({ success: true }) },
      associationsRepository: {
        findById: vi.fn().mockResolvedValue({ id: 'assoc-1', name: 'Assoc', logo_ref: 'x' }),
      },
      withTransaction: async (fn) => fn({}),
    };
  }

  it('rejects when the email is already inscribed in the election', async () => {
    const election = { id: 'fed-election-1', scope: 'FEDERATION', association_id: null, voters_per_association: null };
    const deps = baseDeps({
      participantsRepository: { findByEmailInElection: vi.fn().mockResolvedValue({ user_id: 'u-existing' }) },
    });

    const result = await addParticipant(
      election,
      { email: 'dup@example.com', fullName: 'Dup', associationId: 'assoc-1' },
      identity,
      deps
    );

    expect(result).toEqual({ success: false, error: 'Cet email est déjà inscrit pour cette élection' });
    expect(deps.participantsRepository.create).not.toHaveBeenCalled();
  });

  it('rejects when the per-association quota is reached on a federation election', async () => {
    const election = { id: 'fed-election-1', scope: 'FEDERATION', association_id: null, voters_per_association: 2 };
    const deps = baseDeps({
      participantsRepository: { countByElectionAndAssociation: vi.fn().mockResolvedValue(2) },
    });

    const result = await addParticipant(
      election,
      { email: 'new@example.com', fullName: 'New', associationId: 'assoc-1' },
      identity,
      deps
    );

    expect(result).toEqual({ success: false, error: 'Quota de votants atteint pour cette association' });
    expect(deps.participantsRepository.create).not.toHaveBeenCalled();
  });

  it('allows the add when the quota is not yet reached', async () => {
    const election = { id: 'fed-election-1', scope: 'FEDERATION', association_id: null, voters_per_association: 5 };
    const deps = baseDeps({
      participantsRepository: { countByElectionAndAssociation: vi.fn().mockResolvedValue(1) },
    });

    const result = await addParticipant(
      election,
      { email: 'new@example.com', fullName: 'New', associationId: 'assoc-1' },
      identity,
      deps
    );

    expect(result.success).toBe(true);
    expect(deps.participantsRepository.create).toHaveBeenCalled();
  });
});


describe('validateParticipants()', () => {
  const identity = { id: 'mgr-1', role: 'FEDERATION_ELECTION_MANAGER', association_id: null };
  const fedElection = { id: 'fed-1', scope: 'FEDERATION', association_id: null, voters_per_association: 2 };

  function deps(overrides = {}) {
    return {
      pool: {},
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue(null),
        ...overrides.usersRepository,
      },
      participantsRepository: {
        findByEmailInElection: vi.fn().mockResolvedValue(null),
        countByElectionAndAssociation: vi.fn().mockResolvedValue(0),
        ...overrides.participantsRepository,
      },
      associationsRepository: {
        findById: vi.fn().mockResolvedValue({ id: 'assoc-1', name: 'Assoc' }),
        ...overrides.associationsRepository,
      },
    };
  }

  it('marks a valid federation row as valid', async () => {
    const result = await validateParticipants(
      fedElection,
      [{ fullName: 'Alice', email: 'alice@example.com', associationId: 'assoc-1' }],
      identity,
      deps()
    );
    expect(result.success).toBe(true);
    expect(result.rows[0].valid).toBe(true);
    expect(result.rows[0].error).toBeNull();
    expect(result.rows[0].existing).toBe(false);
    expect(result.summary).toEqual({ valid: 1, invalid: 0 });
  });

  it('labels a row whose email already has an account as existing but still valid', async () => {
    const d = deps({
      usersRepository: { findAnyByEmail: vi.fn().mockResolvedValue({ id: 'u-existing' }) },
    });
    const result = await validateParticipants(
      fedElection,
      [{ fullName: 'Zoe', email: 'zoe@example.com', associationId: 'assoc-1' }],
      identity,
      d
    );
    expect(result.rows[0].valid).toBe(true);
    expect(result.rows[0].existing).toBe(true);
    expect(result.summary).toEqual({ valid: 1, invalid: 0 });
  });

  it('flags missing full name and invalid email', async () => {
    const result = await validateParticipants(
      fedElection,
      [
        { fullName: '', email: 'a@example.com', associationId: 'assoc-1' },
        { fullName: 'Bob', email: 'not-an-email', associationId: 'assoc-1' },
      ],
      identity,
      deps()
    );
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[1].valid).toBe(false);
    expect(result.rows[1].error).toBe("L'email est invalide");
    expect(result.summary.invalid).toBe(2);
  });

  it('flags an unknown association for federation elections', async () => {
    const d = deps({ associationsRepository: { findById: vi.fn().mockResolvedValue(null) } });
    const result = await validateParticipants(
      fedElection,
      [{ fullName: 'Carl', email: 'carl@example.com', associationId: 'ghost' }],
      identity,
      d
    );
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].error).toBe('Association inconnue');
  });

  it('flags missing association id for federation elections', async () => {
    const result = await validateParticipants(
      fedElection,
      [{ fullName: 'Dan', email: 'dan@example.com' }],
      identity,
      deps()
    );
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].error).toBe('Association inconnue');
  });

  it('flags an in-file duplicate email', async () => {
    const result = await validateParticipants(
      fedElection,
      [
        { fullName: 'Eve', email: 'eve@example.com', associationId: 'assoc-1' },
        { fullName: 'Eve Again', email: 'EVE@example.com', associationId: 'assoc-1' },
      ],
      identity,
      deps()
    );
    expect(result.rows[0].valid).toBe(true);
    expect(result.rows[1].valid).toBe(false);
    expect(result.rows[1].error).toBe('Doublon dans le fichier');
  });

  it('flags an email already registered as a participant', async () => {
    const d = deps({
      participantsRepository: {
        findByEmailInElection: vi.fn().mockResolvedValue({ user_id: 'u1' }),
        countByElectionAndAssociation: vi.fn().mockResolvedValue(0),
      },
    });
    const result = await validateParticipants(
      fedElection,
      [{ fullName: 'Fred', email: 'fred@example.com', associationId: 'assoc-1' }],
      identity,
      d
    );
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].error).toBe('Cet email est déjà inscrit pour cette élection');
  });

  it('flags quota exceeded cumulatively across rows for the same association', async () => {
    // Quota 2, DB already has 1 → only one more allowed; the 2nd new row exceeds.
    const d = deps({
      participantsRepository: {
        findByEmailInElection: vi.fn().mockResolvedValue(null),
        countByElectionAndAssociation: vi.fn().mockResolvedValue(1),
      },
    });
    const result = await validateParticipants(
      fedElection,
      [
        { fullName: 'G One', email: 'g1@example.com', associationId: 'assoc-1' },
        { fullName: 'G Two', email: 'g2@example.com', associationId: 'assoc-1' },
      ],
      identity,
      d
    );
    expect(result.rows[0].valid).toBe(true);
    expect(result.rows[1].valid).toBe(false);
    expect(result.rows[1].error).toBe('Quota dépassé pour cette association');
  });
});


describe('bulkAddParticipants() — quota and in-file duplicates', () => {
  const identity = { id: 'mgr-1', role: 'FEDERATION_ELECTION_MANAGER', association_id: null };

  function bulkDeps(overrides = {}) {
    return {
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-user' }),
        ...overrides.usersRepository,
      },
      participantsRepository: {
        create: vi.fn().mockResolvedValue({ election_id: 'fed-1', user_id: 'new-user' }),
        findByEmailInElection: vi.fn().mockResolvedValue(null),
        countByElectionAndAssociation: vi.fn().mockResolvedValue(0),
        ...overrides.participantsRepository,
      },
      credentialService: {
        generateTemporaryPassword: vi.fn().mockReturnValue('Temp1234!xyz'),
        hashPassword: vi.fn().mockResolvedValue('$2b$10$hash'),
      },
      emailService: { sendCredentials: vi.fn().mockResolvedValue({ success: true }) },
      associationsRepository: { findById: vi.fn().mockResolvedValue({ id: 'assoc-1', name: 'A' }) },
      withTransaction: async (fn) => fn({}),
    };
  }

  it('counts in-file duplicate emails as duplicates without re-adding', async () => {
    const election = { id: 'fed-1', scope: 'FEDERATION', association_id: null, voters_per_association: null };
    const deps = bulkDeps();

    const rows = [
      { fullName: 'One', email: 'same@example.com', associationId: 'assoc-1' },
      { fullName: 'Two', email: 'SAME@example.com', associationId: 'assoc-1' },
    ];

    const result = await bulkAddParticipants(election, rows, identity, deps);

    expect(result.summary.added).toBe(1);
    expect(result.summary.duplicates).toBe(1);
    expect(deps.participantsRepository.create).toHaveBeenCalledTimes(1);
  });

  it('classifies new vs existing accounts as added vs reused', async () => {
    const election = { id: 'fed-1', scope: 'FEDERATION', association_id: null, voters_per_association: null };
    const deps = bulkDeps({
      usersRepository: {
        // row1 (new): no account → created/emailed. row2 (existing): reused.
        findAnyByEmail: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'existing-user' }),
        create: vi.fn().mockResolvedValue({ id: 'new-user' }),
      },
    });

    const rows = [
      { fullName: 'New', email: 'new@example.com', associationId: 'assoc-1' },
      { fullName: 'Existing', email: 'existing@example.com', associationId: 'assoc-1' },
    ];

    const result = await bulkAddParticipants(election, rows, identity, deps);

    expect(result.summary.added).toBe(1);
    expect(result.summary.reused).toBe(1);
    expect(result.summary.duplicates).toBe(0);
    expect(result.summary.failed).toHaveLength(0);
    // Only the new account triggers a credential email.
    expect(deps.emailService.sendCredentials).toHaveBeenCalledTimes(1);
    expect(deps.usersRepository.create).toHaveBeenCalledTimes(1);
  });

  it('respects the quota and reports over-quota rows as failures', async () => {
    const election = { id: 'fed-1', scope: 'FEDERATION', association_id: null, voters_per_association: 1 };
    // DB starts at 0; addParticipant re-checks count each time. Simulate the
    // count growing after the first insert by returning 0 then 1.
    const deps = bulkDeps({
      participantsRepository: {
        create: vi.fn().mockResolvedValue({ election_id: 'fed-1', user_id: 'new-user' }),
        findByEmailInElection: vi.fn().mockResolvedValue(null),
        countByElectionAndAssociation: vi.fn()
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(1),
      },
    });

    const rows = [
      { fullName: 'One', email: 'one@example.com', associationId: 'assoc-1' },
      { fullName: 'Two', email: 'two@example.com', associationId: 'assoc-1' },
    ];

    const result = await bulkAddParticipants(election, rows, identity, deps);

    expect(result.summary.added).toBe(1);
    expect(result.summary.failed).toHaveLength(1);
    expect(result.summary.failed[0].error).toBe('Quota de votants atteint pour cette association');
  });
});
