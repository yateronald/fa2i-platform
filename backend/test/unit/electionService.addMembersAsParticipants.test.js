import { describe, it, expect, vi } from 'vitest';
import { addMembersAsParticipants } from '../../src/services/electionService.js';

/**
 * Unit tests for electionService.addMembersAsParticipants.
 *
 * Cover:
 * - rejects federation elections (members are association-only)
 * - adds all ACTIVE association members as participants
 * - adds a provided subset, ignoring non-members and inactive members
 * - skips/counts existing participants as duplicates
 */

const ASSOC_ID = 'assoc-1';

function associationElection(id = 'elec-1') {
  return { id, scope: 'ASSOCIATION', association_id: ASSOC_ID };
}

function federationElection(id = 'elec-fed-1') {
  return { id, scope: 'FEDERATION', association_id: null };
}

function manager(id = 'mgr-1') {
  return { id, role: 'ASSOCIATION_MANAGER', association_id: ASSOC_ID };
}

function createMockDeps(overrides = {}) {
  return {
    participantsRepository: {
      findByElectionAndUser: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ election_id: 'elec-1', user_id: 'u' }),
      ...overrides.participantsRepository,
    },
    membersRepository: {
      listActiveUserIds: vi.fn().mockResolvedValue([]),
      ...overrides.membersRepository,
    },
    withTransaction: overrides.withTransaction || (async (fn) => fn({})),
  };
}

describe('addMembersAsParticipants()', () => {
  it('rejects a federation election', async () => {
    const deps = createMockDeps();
    const result = await addMembersAsParticipants(
      federationElection(),
      { all: true },
      manager(),
      deps
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Réservé aux élections d'association");
    expect(deps.membersRepository.listActiveUserIds).not.toHaveBeenCalled();
  });

  it('adds all active association members as participants', async () => {
    const deps = createMockDeps({
      membersRepository: {
        listActiveUserIds: vi.fn().mockResolvedValue(['u1', 'u2', 'u3']),
      },
    });
    const result = await addMembersAsParticipants(
      associationElection(),
      { all: true },
      manager(),
      deps
    );
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({ added: 3, duplicates: 0 });
    expect(deps.participantsRepository.create).toHaveBeenCalledTimes(3);
  });

  it('adds only the provided members, ignoring non-members and inactive members', async () => {
    const deps = createMockDeps({
      membersRepository: {
        // only u1 and u2 are ACTIVE members; 'inactive-member' is not returned
        listActiveUserIds: vi.fn().mockResolvedValue(['u1', 'u2']),
      },
    });
    const result = await addMembersAsParticipants(
      associationElection(),
      { userIds: ['u1', 'inactive-member', 'not-a-member'] },
      manager(),
      deps
    );
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({ added: 1, duplicates: 0 });
    expect(deps.participantsRepository.create).toHaveBeenCalledTimes(1);
    expect(deps.participantsRepository.create).toHaveBeenCalledWith({}, {
      election_id: 'elec-1',
      user_id: 'u1',
    });
  });

  it('counts already-participating members as duplicates', async () => {
    const deps = createMockDeps({
      membersRepository: {
        listActiveUserIds: vi.fn().mockResolvedValue(['u1', 'u2']),
      },
      participantsRepository: {
        // u1 already participates, u2 does not
        findByElectionAndUser: vi.fn().mockImplementation(async (_client, _elecId, userId) => {
          return userId === 'u1' ? { user_id: 'u1' } : null;
        }),
        create: vi.fn().mockResolvedValue({ election_id: 'elec-1', user_id: 'u2' }),
      },
    });
    const result = await addMembersAsParticipants(
      associationElection(),
      { all: true },
      manager(),
      deps
    );
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({ added: 1, duplicates: 1 });
    expect(deps.participantsRepository.create).toHaveBeenCalledTimes(1);
  });

  it('counts a 23505 conflict on insert as a duplicate', async () => {
    const conflict = new Error('duplicate');
    conflict.code = '23505';
    const deps = createMockDeps({
      membersRepository: {
        listActiveUserIds: vi.fn().mockResolvedValue(['u1']),
      },
      participantsRepository: {
        findByElectionAndUser: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(conflict),
      },
    });
    const result = await addMembersAsParticipants(
      associationElection(),
      { all: true },
      manager(),
      deps
    );
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({ added: 0, duplicates: 1 });
  });
});
