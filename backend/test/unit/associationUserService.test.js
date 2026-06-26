import { describe, it, expect, vi } from 'vitest';
import {
  createAssociationUser,
  listAssociationUsers,
  updateAssociationUserRole,
  setAssociationUserActive,
  deleteAssociationUser,
} from '../../src/services/associationUserService.js';

/**
 * Unit tests for Association_User_Service.
 *
 * Cover:
 * - successful create (manager role + election manager role)
 * - invalid role rejected
 * - duplicate management email rejected
 * - canAddFederationVoters forced false for the full-control role
 * - cross-association update/delete rejected
 * - self-delete / self-deactivate rejected
 */

const ASSOC_ID = 'assoc-1';

function manager(id = 'mgr-1') {
  return { id, role: 'ASSOCIATION_MANAGER', association_id: ASSOC_ID };
}

function fedAdmin(id = 'fa-1') {
  return { id, role: 'FEDERATION_ADMINISTRATOR', association_id: null };
}

function createdRow(overrides = {}) {
  return {
    id: 'new-user-1',
    email: 'sub@example.com',
    full_name: 'Sub User',
    role: 'ASSOCIATION_ELECTION_MANAGER',
    association_id: ASSOC_ID,
    can_add_federation_voters: false,
    is_active: true,
    is_temporary_password: true,
    created_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockDeps(overrides = {}) {
  return {
    usersRepository: {
      findManagementUserByEmailAnywhere: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(createdRow()),
      findByIdAny: vi.fn().mockResolvedValue(null),
      listAssociationManagementUsers: vi.fn().mockResolvedValue([]),
      updateAssociationUser: vi.fn().mockResolvedValue(createdRow()),
      setActive: vi.fn().mockResolvedValue(createdRow({ is_active: false })),
      deleteById: vi.fn().mockResolvedValue(1),
      clearUserReferences: vi.fn().mockResolvedValue(undefined),
      hasVotingHistory: vi.fn().mockResolvedValue(false),
      ...overrides.usersRepository,
    },
    participantsRepository: {
      removeUnvotedForUser: vi.fn().mockResolvedValue(0),
      ...overrides.participantsRepository,
    },
    associationsRepository: {
      findById: vi.fn().mockResolvedValue({ id: ASSOC_ID, name: 'Assoc One', logo_ref: 'logo-ref' }),
      ...overrides.associationsRepository,
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

describe('createAssociationUser()', () => {
  it('rejects a non-manager caller', async () => {
    const deps = createMockDeps();
    const result = await createAssociationUser(
      { id: 'x', role: 'ASSOCIATION_ELECTION_MANAGER', association_id: ASSOC_ID },
      { email: 'a@b.com', fullName: 'A', role: 'ASSOCIATION_MANAGER' },
      deps
    );
    expect(result.success).toBe(false);
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('creates a sub-user with the ASSOCIATION_MANAGER role and brands the email with the association logo', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findManagementUserByEmailAnywhere: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(createdRow({ role: 'ASSOCIATION_MANAGER' })),
      },
    });
    const result = await createAssociationUser(
      manager(),
      { email: 'sub@example.com', fullName: 'Sub User', role: 'ASSOCIATION_MANAGER' },
      deps
    );

    expect(result.success).toBe(true);
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
      role: 'ASSOCIATION_MANAGER',
      associationId: ASSOC_ID,
      fullName: 'Sub User',
      canAddFederationVoters: false,
    }));
    expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
      'Sub User',
      'sub@example.com',
      'Temp1234!abcXYZ',
      expect.objectContaining({ logoUrl: 'logo-ref', brandName: 'Assoc One' })
    );
  });

  it('creates an election manager and honours canAddFederationVoters=true', async () => {
    const deps = createMockDeps();
    const result = await createAssociationUser(
      manager(),
      {
        email: 'sub@example.com',
        fullName: 'Sub User',
        role: 'ASSOCIATION_ELECTION_MANAGER',
        canAddFederationVoters: true,
      },
      deps
    );

    expect(result.success).toBe(true);
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
      role: 'ASSOCIATION_ELECTION_MANAGER',
      canAddFederationVoters: true,
    }));
  });

  it('forces canAddFederationVoters to false for the full-control manager role', async () => {
    const deps = createMockDeps();
    await createAssociationUser(
      manager(),
      {
        email: 'sub@example.com',
        fullName: 'Sub User',
        role: 'ASSOCIATION_MANAGER',
        canAddFederationVoters: true,
      },
      deps
    );
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
      role: 'ASSOCIATION_MANAGER',
      canAddFederationVoters: false,
    }));
  });

  it('honours canManageMembers=true for an election manager and persists it', async () => {
    const deps = createMockDeps();
    const result = await createAssociationUser(
      manager(),
      {
        email: 'sub@example.com',
        fullName: 'Sub User',
        role: 'ASSOCIATION_ELECTION_MANAGER',
        canManageMembers: true,
      },
      deps
    );
    expect(result.success).toBe(true);
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
      role: 'ASSOCIATION_ELECTION_MANAGER',
      canManageMembers: true,
    }));
  });

  it('forces canManageMembers to false for the full-control manager role', async () => {
    const deps = createMockDeps();
    await createAssociationUser(
      manager(),
      {
        email: 'sub@example.com',
        fullName: 'Sub User',
        role: 'ASSOCIATION_MANAGER',
        canManageMembers: true,
      },
      deps
    );
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
      role: 'ASSOCIATION_MANAGER',
      canManageMembers: false,
    }));
  });

  it('rejects an invalid role', async () => {
    const deps = createMockDeps();
    const result = await createAssociationUser(
      manager(),
      { email: 'sub@example.com', fullName: 'Sub User', role: 'VOTER' },
      deps
    );
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Le rôle est invalide');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid email', async () => {
    const deps = createMockDeps();
    const result = await createAssociationUser(
      manager(),
      { email: 'not-an-email', fullName: 'Sub User', role: 'ASSOCIATION_MANAGER' },
      deps
    );
    expect(result.success).toBe(false);
    expect(result.errors).toContain("L'email est invalide");
  });

  it('rejects a duplicate management email', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findManagementUserByEmailAnywhere: vi.fn().mockResolvedValue({ id: 'existing' }),
        create: vi.fn(),
      },
    });
    const result = await createAssociationUser(
      manager(),
      { email: 'sub@example.com', fullName: 'Sub User', role: 'ASSOCIATION_MANAGER' },
      deps
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cet email est déjà utilisé par un compte de gestion');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });
});

describe('listAssociationUsers()', () => {
  it('lists management users for the caller association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        listAssociationManagementUsers: vi.fn().mockResolvedValue([createdRow()]),
      },
    });
    const result = await listAssociationUsers(manager(), undefined, deps);
    expect(result.success).toBe(true);
    expect(result.users).toHaveLength(1);
    expect(deps.usersRepository.listAssociationManagementUsers).toHaveBeenCalledWith({}, ASSOC_ID);
  });

  it('ignores a requested associationId for a manager (forced to own)', async () => {
    const deps = createMockDeps({
      usersRepository: {
        listAssociationManagementUsers: vi.fn().mockResolvedValue([]),
      },
    });
    const result = await listAssociationUsers(manager(), 'assoc-other', deps);
    expect(result.success).toBe(true);
    expect(deps.usersRepository.listAssociationManagementUsers).toHaveBeenCalledWith({}, ASSOC_ID);
  });
});

describe('updateAssociationUserRole()', () => {
  it('updates a sub-user in the same association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'target-1' })),
        updateAssociationUser: vi.fn().mockResolvedValue(createdRow({ id: 'target-1', role: 'ASSOCIATION_MANAGER' })),
      },
    });
    const result = await updateAssociationUserRole(manager(), 'target-1', { role: 'ASSOCIATION_MANAGER' }, deps);
    expect(result.success).toBe(true);
    expect(deps.usersRepository.updateAssociationUser).toHaveBeenCalledWith({}, 'target-1', {
      role: 'ASSOCIATION_MANAGER',
      canAddFederationVoters: false,
      canManageMembers: false,
    });
  });

  it('persists canManageMembers when updating to the election manager role', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'target-1' })),
        updateAssociationUser: vi
          .fn()
          .mockResolvedValue(createdRow({ id: 'target-1', can_manage_members: true })),
      },
    });
    const result = await updateAssociationUserRole(
      manager(),
      'target-1',
      { role: 'ASSOCIATION_ELECTION_MANAGER', canManageMembers: true },
      deps
    );
    expect(result.success).toBe(true);
    expect(deps.usersRepository.updateAssociationUser).toHaveBeenCalledWith({}, 'target-1', {
      role: 'ASSOCIATION_ELECTION_MANAGER',
      canAddFederationVoters: false,
      canManageMembers: true,
    });
  });

  it('rejects updating a user from another association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'target-1', association_id: 'assoc-2' })),
        updateAssociationUser: vi.fn(),
      },
    });
    const result = await updateAssociationUserRole(manager(), 'target-1', { role: 'ASSOCIATION_MANAGER' }, deps);
    expect(result.success).toBe(false);
    expect(deps.usersRepository.updateAssociationUser).not.toHaveBeenCalled();
  });
});

describe('setAssociationUserActive()', () => {
  it('rejects deactivating own account', async () => {
    const deps = createMockDeps();
    const result = await setAssociationUserActive(manager('mgr-1'), 'mgr-1', false, deps);
    expect(result.success).toBe(false);
    expect(deps.usersRepository.setActive).not.toHaveBeenCalled();
  });
});

describe('deleteAssociationUser()', () => {
  it('rejects self-delete', async () => {
    const deps = createMockDeps();
    const result = await deleteAssociationUser(manager('mgr-1'), 'mgr-1', deps);
    expect(result.success).toBe(false);
    expect(deps.usersRepository.deleteById).not.toHaveBeenCalled();
  });

  it('rejects deleting a user from another association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'target-2', association_id: 'assoc-2' })),
        deleteById: vi.fn(),
      },
    });
    const result = await deleteAssociationUser(manager(), 'target-2', deps);
    expect(result.success).toBe(false);
    expect(deps.usersRepository.deleteById).not.toHaveBeenCalled();
  });

  it('deletes a sub-user in the same association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'target-3' })),
        deleteById: vi.fn().mockResolvedValue(1),
      },
    });
    const result = await deleteAssociationUser(manager(), 'target-3', deps);
    expect(result.success).toBe(true);
    expect(deps.usersRepository.deleteById).toHaveBeenCalledWith({}, 'target-3');
  });
});

// --- FEDERATION_ADMINISTRATOR cases ---

describe('createAssociationUser() — federation administrator', () => {
  const OTHER_ASSOC = 'assoc-9';

  it('creates a sub-user in the supplied association and brands with that association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        create: vi.fn().mockResolvedValue(createdRow({ association_id: OTHER_ASSOC })),
      },
      associationsRepository: {
        findById: vi.fn().mockResolvedValue({ id: OTHER_ASSOC, name: 'Assoc Nine', logo_ref: 'logo-9' }),
      },
    });
    const result = await createAssociationUser(
      fedAdmin(),
      {
        email: 'sub@example.com',
        fullName: 'Sub User',
        role: 'ASSOCIATION_MANAGER',
        associationId: OTHER_ASSOC,
      },
      deps
    );

    expect(result.success).toBe(true);
    expect(deps.associationsRepository.findById).toHaveBeenCalledWith({}, OTHER_ASSOC);
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
      associationId: OTHER_ASSOC,
      role: 'ASSOCIATION_MANAGER',
    }));
    expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
      'Sub User',
      'sub@example.com',
      'Temp1234!abcXYZ',
      expect.objectContaining({ logoUrl: 'logo-9', brandName: 'Assoc Nine' })
    );
  });

  it('rejects when no associationId is supplied', async () => {
    const deps = createMockDeps();
    const result = await createAssociationUser(
      fedAdmin(),
      { email: 'sub@example.com', fullName: 'Sub User', role: 'ASSOCIATION_MANAGER' },
      deps
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Association requise');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('rejects when the supplied association does not exist', async () => {
    const deps = createMockDeps({
      associationsRepository: {
        findById: vi.fn().mockResolvedValue(null),
      },
    });
    const result = await createAssociationUser(
      fedAdmin(),
      {
        email: 'sub@example.com',
        fullName: 'Sub User',
        role: 'ASSOCIATION_MANAGER',
        associationId: 'missing-assoc',
      },
      deps
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Association introuvable');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });
});

describe('listAssociationUsers() — federation administrator', () => {
  it('lists the supplied association management users', async () => {
    const deps = createMockDeps({
      usersRepository: {
        listAssociationManagementUsers: vi.fn().mockResolvedValue([createdRow({ association_id: 'assoc-9' })]),
      },
    });
    const result = await listAssociationUsers(fedAdmin(), 'assoc-9', deps);
    expect(result.success).toBe(true);
    expect(result.users).toHaveLength(1);
    expect(deps.usersRepository.listAssociationManagementUsers).toHaveBeenCalledWith({}, 'assoc-9');
  });

  it('rejects when no associationId is supplied', async () => {
    const deps = createMockDeps();
    const result = await listAssociationUsers(fedAdmin(), undefined, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Association requise');
    expect(deps.usersRepository.listAssociationManagementUsers).not.toHaveBeenCalled();
  });
});

describe('updateAssociationUserRole() — federation administrator', () => {
  it('updates a target in another association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'target-x', association_id: 'assoc-9' })),
        updateAssociationUser: vi.fn().mockResolvedValue(createdRow({ id: 'target-x', role: 'ASSOCIATION_MANAGER' })),
      },
    });
    const result = await updateAssociationUserRole(fedAdmin(), 'target-x', { role: 'ASSOCIATION_MANAGER' }, deps);
    expect(result.success).toBe(true);
    expect(deps.usersRepository.updateAssociationUser).toHaveBeenCalledWith({}, 'target-x', {
      role: 'ASSOCIATION_MANAGER',
      canAddFederationVoters: false,
      canManageMembers: false,
    });
  });

  it('refuses a target whose role is not an association role', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'fed-1', role: 'FEDERATION_ELECTION_MANAGER', association_id: null })),
        updateAssociationUser: vi.fn(),
      },
    });
    const result = await updateAssociationUserRole(fedAdmin(), 'fed-1', { role: 'ASSOCIATION_MANAGER' }, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Utilisateur introuvable');
    expect(deps.usersRepository.updateAssociationUser).not.toHaveBeenCalled();
  });
});

describe('deleteAssociationUser() — federation administrator', () => {
  it('deletes a target in another association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'target-x', association_id: 'assoc-9' })),
        deleteById: vi.fn().mockResolvedValue(1),
      },
    });
    const result = await deleteAssociationUser(fedAdmin(), 'target-x', deps);
    expect(result.success).toBe(true);
    expect(deps.usersRepository.deleteById).toHaveBeenCalledWith({}, 'target-x');
  });

  it('refuses a target whose role is not an association role', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'fed-1', role: 'FEDERATION_ADMINISTRATOR', association_id: null })),
        deleteById: vi.fn(),
      },
    });
    const result = await deleteAssociationUser(fedAdmin(), 'fed-1', deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Utilisateur introuvable');
    expect(deps.usersRepository.deleteById).not.toHaveBeenCalled();
  });
});

describe('setAssociationUserActive() — federation administrator', () => {
  it('disables a target in another association', async () => {
    const deps = createMockDeps({
      usersRepository: {
        findByIdAny: vi.fn().mockResolvedValue(createdRow({ id: 'target-x', association_id: 'assoc-9' })),
        setActive: vi.fn().mockResolvedValue(createdRow({ id: 'target-x', is_active: false })),
      },
    });
    const result = await setAssociationUserActive(fedAdmin(), 'target-x', false, deps);
    expect(result.success).toBe(true);
    expect(deps.usersRepository.setActive).toHaveBeenCalledWith({}, 'target-x', false);
  });
});
