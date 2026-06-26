import { describe, it, expect, vi } from 'vitest';
import {
  listMembers,
  addMember,
  bulkAddMembers,
  setMemberActive,
  updateMember,
  removeMember,
} from '../../src/services/membersService.js';

/**
 * Unit tests for Members_Service.
 *
 * Cover:
 * - access denied for non-managers
 * - addMember: new account (creates + emails), existing account (reused, no email)
 * - addMember: duplicate member rejected
 * - listMembers happy path
 * - bulkAddMembers summary shape
 * - removeMember success + not-found (account preserved)
 */

const ASSOC_ID = 'assoc-1';

function manager(id = 'mgr-1') {
  return { id, role: 'ASSOCIATION_MANAGER', association_id: ASSOC_ID };
}

function electionManager(canManageMembers = true, id = 'em-1') {
  return {
    id,
    role: 'ASSOCIATION_ELECTION_MANAGER',
    association_id: ASSOC_ID,
    can_manage_members: canManageMembers,
  };
}

function voter(id = 'v-1') {
  return { id, role: 'VOTER', association_id: ASSOC_ID };
}

function createMockDeps(overrides = {}) {
  return {
    usersRepository: {
      findAnyByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'new-user-1', email: 'sub@example.com', full_name: 'Sub User' }),
      setActive: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'VOTER', is_active: false }),
      findByIdAny: vi.fn().mockResolvedValue({
        id: 'u1',
        email: 'old@example.com',
        email_lower: 'old@example.com',
        full_name: 'Old Name',
        is_active: true,
      }),
      updateFullName: vi.fn().mockImplementation(async (_client, id, fullName) => ({
        id,
        email: 'old@example.com',
        full_name: fullName,
        is_active: true,
      })),
      updateEmailAndResetTempPassword: vi.fn().mockResolvedValue({ id: 'u1' }),
      clearUserReferences: vi.fn().mockResolvedValue(undefined),
      hasVotingHistory: vi.fn().mockResolvedValue(false),
      deleteById: vi.fn().mockResolvedValue(1),
      ...overrides.usersRepository,
    },
    associationsRepository: {
      findById: vi.fn().mockResolvedValue({ id: ASSOC_ID, name: 'Assoc One', logo_ref: 'logo-ref' }),
      ...overrides.associationsRepository,
    },
    membersRepository: {
      findMembership: vi.fn().mockResolvedValue(false),
      addMembership: vi.fn().mockResolvedValue({ association_id: ASSOC_ID, user_id: 'new-user-1' }),
      removeMembership: vi.fn().mockResolvedValue({ association_id: ASSOC_ID, user_id: 'new-user-1' }),
      listByAssociation: vi.fn().mockResolvedValue([]),
      listUserIds: vi.fn().mockResolvedValue([]),
      ...overrides.membersRepository,
    },
    participantsRepository: {
      removeAllForUser: vi.fn().mockResolvedValue(0),
      removeUnvotedForUser: vi.fn().mockResolvedValue(0),
      ...overrides.participantsRepository,
    },
    credentialService: {
      generateTemporaryPassword: vi.fn().mockReturnValue('Temp1234!abcXYZ'),
      hashPassword: vi.fn().mockResolvedValue('$2b$10$hash'),
      ...overrides.credentialService,
    },
    emailService: {
      sendCredentials: vi.fn().mockResolvedValue({ success: true }),
      ...overrides.emailService,
    },
    withTransaction: overrides.withTransaction || (async (fn) => fn({})),
  };
}

describe('listMembers()', () => {
  it('denies a voter', async () => {
    const deps = createMockDeps();
    const result = await listMembers(voter(), deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Accès refusé');
    expect(deps.membersRepository.listByAssociation).not.toHaveBeenCalled();
  });

  it('denies an election manager without the flag', async () => {
    const deps = createMockDeps();
    const result = await listMembers(electionManager(false), deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Accès refusé');
  });

  it('lists members for an association manager', async () => {
    const deps = createMockDeps({
      membersRepository: {
        listByAssociation: vi.fn().mockResolvedValue([
          { user_id: 'u1', email: 'a@b.com', full_name: 'A', is_active: true, added_at: 'now' },
        ]),
      },
    });
    const result = await listMembers(manager(), deps);
    expect(result.success).toBe(true);
    expect(result.members).toHaveLength(1);
    expect(deps.membersRepository.listByAssociation).toHaveBeenCalledWith({}, ASSOC_ID);
  });

  it('lists members for an election manager with the flag', async () => {
    const deps = createMockDeps();
    const result = await listMembers(electionManager(true), deps);
    expect(result.success).toBe(true);
    expect(deps.membersRepository.listByAssociation).toHaveBeenCalledWith({}, ASSOC_ID);
  });
});

describe('addMember()', () => {
  it('denies a non-manager', async () => {
    const deps = createMockDeps();
    const result = await addMember(voter(), { email: 'a@b.com', fullName: 'A' }, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Accès refusé');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid email', async () => {
    const deps = createMockDeps();
    const result = await addMember(manager(), { email: 'not-an-email', fullName: 'A' }, deps);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("L'email est invalide");
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a missing full name', async () => {
    const deps = createMockDeps();
    const result = await addMember(manager(), { email: 'a@b.com', fullName: '' }, deps);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Le nom complet est requis');
  });

  it('creates a new VOTER account, emails branded credentials, and links membership', async () => {
    const deps = createMockDeps();
    const result = await addMember(
      manager(),
      { email: 'sub@example.com', fullName: 'Sub User' },
      deps
    );

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.existingAccount).toBe(false);
    expect(result.member).toEqual({
      user_id: 'new-user-1',
      email: 'sub@example.com',
      full_name: 'Sub User',
      phone: null,
    });
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
      role: 'VOTER',
      associationId: ASSOC_ID,
      fullName: 'Sub User',
    }));
    expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
      'Sub User',
      'sub@example.com',
      'Temp1234!abcXYZ',
      expect.objectContaining({ logoUrl: 'logo-ref', brandName: 'Assoc One' })
    );
    expect(deps.membersRepository.addMembership).toHaveBeenCalledWith({}, ASSOC_ID, 'new-user-1');
  });

  it('reuses an existing account without creating or emailing', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue({ id: 'existing-1', email: 'sub@example.com' }),
        create: vi.fn(),
      },
    });
    const result = await addMember(
      manager(),
      { email: 'sub@example.com', fullName: 'Sub User' },
      deps
    );

    expect(result.success).toBe(true);
    expect(result.created).toBe(false);
    expect(result.existingAccount).toBe(true);
    expect(result.member.user_id).toBe('existing-1');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
    expect(deps.emailService.sendCredentials).not.toHaveBeenCalled();
    expect(deps.membersRepository.addMembership).toHaveBeenCalledWith({}, ASSOC_ID, 'existing-1');
  });

  it('rejects a person who is already a member', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue({ id: 'existing-1' }),
        create: vi.fn(),
      },
      membersRepository: {
        findMembership: vi.fn().mockResolvedValue(true),
        addMembership: vi.fn(),
      },
    });
    const result = await addMember(
      manager(),
      { email: 'sub@example.com', fullName: 'Sub User' },
      deps
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cette personne est déjà membre');
    expect(deps.membersRepository.addMembership).not.toHaveBeenCalled();
  });
});

describe('bulkAddMembers()', () => {
  it('denies a non-manager', async () => {
    const deps = createMockDeps();
    const result = await bulkAddMembers(voter(), [{ email: 'a@b.com', fullName: 'A' }], deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Accès refusé');
  });

  it('produces a summary distinguishing added, reused, duplicates and failed', async () => {
    let call = 0;
    const deps = createMockDeps({
      usersRepository: {
        // new1 -> not found (created); existing -> found (reused); dupe -> found
        findAnyByEmail: vi.fn().mockImplementation(async (_client, emailLower) => {
          if (emailLower === 'new@example.com') return null;
          if (emailLower === 'existing@example.com') return { id: 'existing-1' };
          if (emailLower === 'dupe@example.com') return { id: 'dupe-1' };
          return null;
        }),
        create: vi.fn().mockResolvedValue({ id: 'new-1' }),
      },
      membersRepository: {
        addMembership: vi.fn().mockResolvedValue({}),
        findMembership: vi.fn().mockImplementation(async (_client, _assoc, userId) => {
          return userId === 'dupe-1';
        }),
      },
    });

    const rows = [
      { email: 'new@example.com', fullName: 'New One' },
      { email: 'existing@example.com', fullName: 'Existing One' },
      { email: 'dupe@example.com', fullName: 'Dupe One' },
      { email: 'bad-email', fullName: 'Bad One' },
    ];

    const result = await bulkAddMembers(manager(), rows, deps);
    expect(result.success).toBe(true);
    expect(result.summary.added).toBe(1);
    expect(result.summary.reused).toBe(1);
    expect(result.summary.duplicates).toBe(1);
    expect(result.summary.failed).toHaveLength(1);
    expect(result.summary.failed[0].email).toBe('bad-email');
  });

  it('counts in-file duplicate emails as duplicates', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findAnyByEmail: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-1' }),
      },
    });
    const rows = [
      { email: 'same@example.com', fullName: 'First' },
      { email: 'same@example.com', fullName: 'Second' },
    ];
    const result = await bulkAddMembers(manager(), rows, deps);
    expect(result.summary.added).toBe(1);
    expect(result.summary.duplicates).toBe(1);
  });
});

describe('setMemberActive()', () => {
  it('denies a non-manager', async () => {
    const deps = createMockDeps();
    const result = await setMemberActive(voter(), 'u1', false, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Accès refusé');
    expect(deps.usersRepository.setActive).not.toHaveBeenCalled();
  });

  it('returns not-found when the membership does not exist', async () => {
    const deps = createMockDeps({
      membersRepository: {
        findMembership: vi.fn().mockResolvedValue(false),
      },
    });
    const result = await setMemberActive(manager(), 'u-missing', false, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Membre introuvable');
    expect(deps.usersRepository.setActive).not.toHaveBeenCalled();
  });

  it('disables an existing member', async () => {
    const deps = createMockDeps({
      membersRepository: {
        findMembership: vi.fn().mockResolvedValue(true),
      },
      usersRepository: {
        setActive: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'VOTER', is_active: false }),
      },
    });
    const result = await setMemberActive(manager(), 'u1', false, deps);
    expect(result.success).toBe(true);
    expect(result.member.is_active).toBe(false);
    expect(deps.usersRepository.setActive).toHaveBeenCalledWith({}, 'u1', false);
  });

  it('re-enables an existing member', async () => {
    const deps = createMockDeps({
      membersRepository: {
        findMembership: vi.fn().mockResolvedValue(true),
      },
      usersRepository: {
        setActive: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'VOTER', is_active: true }),
      },
    });
    const result = await setMemberActive(manager(), 'u1', true, deps);
    expect(result.success).toBe(true);
    expect(result.member.is_active).toBe(true);
    expect(deps.usersRepository.setActive).toHaveBeenCalledWith({}, 'u1', true);
  });
});

describe('updateMember()', () => {
  it('denies a non-manager', async () => {
    const deps = createMockDeps();
    const result = await updateMember(voter(), 'u1', { fullName: 'New Name' }, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Accès refusé');
    expect(deps.usersRepository.updateFullName).not.toHaveBeenCalled();
  });

  it('returns not-found when the membership does not exist', async () => {
    const deps = createMockDeps({
      membersRepository: {
        findMembership: vi.fn().mockResolvedValue(false),
      },
    });
    const result = await updateMember(manager(), 'u-missing', { fullName: 'New Name' }, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Membre introuvable');
  });

  it('rejects a no-op (no name and no changed email)', async () => {
    const deps = createMockDeps({
      membersRepository: { findMembership: vi.fn().mockResolvedValue(true) },
    });
    const result = await updateMember(manager(), 'u1', {}, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Aucune modification fournie');
    expect(deps.usersRepository.updateFullName).not.toHaveBeenCalled();
    expect(deps.usersRepository.updateEmailAndResetTempPassword).not.toHaveBeenCalled();
  });

  it('updates the full name without touching the email', async () => {
    const deps = createMockDeps({
      membersRepository: { findMembership: vi.fn().mockResolvedValue(true) },
    });
    const result = await updateMember(manager(), 'u1', { fullName: 'New Name' }, deps);
    expect(result.success).toBe(true);
    expect(result.emailReset).toBe(false);
    expect(result.member.full_name).toBe('New Name');
    expect(deps.usersRepository.updateFullName).toHaveBeenCalledWith({}, 'u1', 'New Name');
    expect(deps.usersRepository.updateEmailAndResetTempPassword).not.toHaveBeenCalled();
    expect(deps.emailService.sendCredentials).not.toHaveBeenCalled();
  });

  it('changes the email, resets the password, and re-sends branded credentials', async () => {
    const deps = createMockDeps({
      membersRepository: { findMembership: vi.fn().mockResolvedValue(true) },
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue({
          id: 'u1',
          email: 'old@example.com',
          email_lower: 'old@example.com',
          full_name: 'Old Name',
          is_active: true,
        }),
        findAnyByEmail: vi.fn().mockResolvedValue(null),
        updateEmailAndResetTempPassword: vi.fn().mockResolvedValue({ id: 'u1' }),
      },
    });
    const result = await updateMember(manager(), 'u1', { email: 'new@example.com' }, deps);
    expect(result.success).toBe(true);
    expect(result.emailReset).toBe(true);
    expect(result.member.email).toBe('new@example.com');
    expect(deps.usersRepository.updateEmailAndResetTempPassword).toHaveBeenCalledWith({}, 'u1', expect.objectContaining({
      email: 'new@example.com',
      emailLower: 'new@example.com',
    }));
    expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
      'Old Name',
      'new@example.com',
      'Temp1234!abcXYZ',
      expect.objectContaining({ logoUrl: 'logo-ref', brandName: 'Assoc One' })
    );
  });

  it('rejects an email already used by another account', async () => {
    const deps = createMockDeps({
      membersRepository: { findMembership: vi.fn().mockResolvedValue(true) },
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue({
          id: 'u1',
          email: 'old@example.com',
          email_lower: 'old@example.com',
          full_name: 'Old Name',
          is_active: true,
        }),
        findAnyByEmail: vi.fn().mockResolvedValue({ id: 'other-user', email: 'taken@example.com' }),
        updateEmailAndResetTempPassword: vi.fn(),
      },
    });
    const result = await updateMember(manager(), 'u1', { email: 'taken@example.com' }, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cet email est déjà utilisé');
    expect(deps.usersRepository.updateEmailAndResetTempPassword).not.toHaveBeenCalled();
    expect(deps.emailService.sendCredentials).not.toHaveBeenCalled();
  });

  it('treats an unchanged email as a no-op when no name is provided', async () => {
    const deps = createMockDeps({
      membersRepository: { findMembership: vi.fn().mockResolvedValue(true) },
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue({
          id: 'u1',
          email: 'Old@Example.com',
          email_lower: 'old@example.com',
          full_name: 'Old Name',
          is_active: true,
        }),
        updateEmailAndResetTempPassword: vi.fn(),
      },
    });
    const result = await updateMember(manager(), 'u1', { email: 'old@example.com' }, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Aucune modification fournie');
    expect(deps.usersRepository.updateEmailAndResetTempPassword).not.toHaveBeenCalled();
  });
});

describe('removeMember()', () => {
  it('denies a non-manager', async () => {
    const deps = createMockDeps();
    const result = await removeMember(voter(), 'u1', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Accès refusé');
    expect(deps.membersRepository.removeMembership).not.toHaveBeenCalled();
  });

  it('removes an existing membership (account preserved)', async () => {
    const deps = createMockDeps({
      membersRepository: {
        findMembership: vi.fn().mockResolvedValue(true),
        removeMembership: vi.fn().mockResolvedValue({ user_id: 'u1' }),
      },
    });
    const result = await removeMember(manager(), 'u1', deps);
    expect(result.success).toBe(true);
    expect(deps.membersRepository.removeMembership).toHaveBeenCalledWith({}, ASSOC_ID, 'u1');
  });

  it('returns not-found when the membership does not exist', async () => {
    const deps = createMockDeps({
      membersRepository: {
        findMembership: vi.fn().mockResolvedValue(false),
        removeMembership: vi.fn(),
      },
    });
    const result = await removeMember(manager(), 'u-missing', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Membre introuvable');
    expect(deps.membersRepository.removeMembership).not.toHaveBeenCalled();
  });
});
