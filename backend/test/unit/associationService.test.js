import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAssociation,
  createRegistryAssociation,
  assignManager,
  updateAssociation,
  deleteRegistryAssociation,
  validateInput,
  isValidEmail,
} from '../../src/services/associationService.js';

/**
 * Unit tests for Association_Service - createAssociation
 *
 * Tests cover:
 * - Field presence validation (Req 2.2)
 * - Field length validation (Req 2.3)
 * - Email format validation (Req 2.4)
 * - Case-insensitive email uniqueness (Req 2.5)
 * - Atomic creation with logo storage, manager account, credentials (Req 2.1, 2.6, 2.7)
 * - Rollback on logo storage failure (Req 2.8)
 * - Rollback on manager account creation failure (Req 2.8)
 */

// --- Helpers ---

function validInput() {
  return {
    name: 'Association Ivoirienne de Mumbai',
    logo: Buffer.from('fake-image-data'),
    presidentName: 'Kouamé Yao',
    presidentEmail: 'kouame@example.com',
  };
}

function createMockDeps(overrides = {}) {
  const createdAssociation = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Association Ivoirienne de Mumbai',
    logo_ref: 'https://res.cloudinary.com/test/logo/image.png',
    president_name: 'Kouamé Yao',
    president_email: 'kouame@example.com',
    president_email_lower: 'kouame@example.com',
  };

  const createdUser = {
    id: '660e8400-e29b-41d4-a716-446655440001',
    email: 'kouame@example.com',
    email_lower: 'kouame@example.com',
    role: 'ASSOCIATION_MANAGER',
    association_id: createdAssociation.id,
  };

  return {
    associationsRepository: {
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(createdAssociation),
      ...overrides.associationsRepository,
    },
    usersRepository: {
      create: vi.fn().mockResolvedValue(createdUser),
      ...overrides.usersRepository,
    },
    credentialService: {
      generateTemporaryPassword: vi.fn().mockReturnValue('Temp1234!abcXYZ'),
      hashPassword: vi.fn().mockResolvedValue('$2b$10$hashedpassword'),
      ...overrides.credentialService,
    },
    emailService: {
      sendCredentials: vi.fn().mockResolvedValue({ success: true }),
      ...overrides.emailService,
    },
    photoStorageService: {
      storeImage: vi.fn().mockResolvedValue({ reference: 'https://res.cloudinary.com/test/logo/image.png' }),
      ...overrides.photoStorageService,
    },
    withTransaction: overrides.withTransaction || (async (fn) => fn({})),
  };
}

// --- isValidEmail tests ---

describe('isValidEmail()', () => {
  it('accepts a valid email', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('accepts an email with subdomain', () => {
    expect(isValidEmail('user@mail.example.co.uk')).toBe(true);
  });

  it('rejects email without @', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects email with multiple @', () => {
    expect(isValidEmail('user@@example.com')).toBe(false);
    expect(isValidEmail('us@er@example.com')).toBe(false);
  });

  it('rejects email with empty local part', () => {
    expect(isValidEmail('@example.com')).toBe(false);
  });

  it('rejects email with empty domain', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('rejects email with domain without dot', () => {
    expect(isValidEmail('user@localhost')).toBe(false);
  });

  it('rejects email with empty domain segment', () => {
    expect(isValidEmail('user@.example.com')).toBe(false);
    expect(isValidEmail('user@example..com')).toBe(false);
    expect(isValidEmail('user@example.com.')).toBe(false);
  });
});

// --- validateInput tests ---

describe('validateInput()', () => {
  it('returns no errors for valid input', () => {
    expect(validateInput(validInput())).toEqual([]);
  });

  it('reports missing name', () => {
    const input = { ...validInput(), name: '' };
    const errors = validateInput(input);
    expect(errors).toContain('Le nom est requis');
  });

  it('reports name exceeding 200 characters', () => {
    const input = { ...validInput(), name: 'A'.repeat(201) };
    const errors = validateInput(input);
    expect(errors).toContain('Le nom ne doit pas dépasser 200 caractères');
  });

  it('reports missing logo', () => {
    const input = { ...validInput(), logo: null };
    const errors = validateInput(input);
    expect(errors).toContain('Le logo est requis');
  });

  it('reports missing president name', () => {
    const input = { ...validInput(), presidentName: '' };
    const errors = validateInput(input);
    expect(errors).toContain('Le nom du président est requis');
  });

  it('reports president name exceeding 200 characters', () => {
    const input = { ...validInput(), presidentName: 'N'.repeat(201) };
    const errors = validateInput(input);
    expect(errors).toContain('Le nom du président ne doit pas dépasser 200 caractères');
  });

  it('reports missing president email', () => {
    const input = { ...validInput(), presidentEmail: '' };
    const errors = validateInput(input);
    expect(errors).toContain("L'email du président est requis");
  });

  it('reports president email exceeding 254 characters', () => {
    const input = { ...validInput(), presidentEmail: 'a'.repeat(246) + '@test.com' };
    const errors = validateInput(input);
    expect(errors).toContain("L'email du président ne doit pas dépasser 254 caractères");
  });

  it('reports invalid president email format', () => {
    const input = { ...validInput(), presidentEmail: 'invalid-email' };
    const errors = validateInput(input);
    expect(errors).toContain("L'email du président est invalide");
  });

  it('collects multiple errors at once', () => {
    const input = { name: '', logo: null, presidentName: '', presidentEmail: '' };
    const errors = validateInput(input);
    expect(errors.length).toBe(4);
    expect(errors).toContain('Le nom est requis');
    expect(errors).toContain('Le logo est requis');
    expect(errors).toContain('Le nom du président est requis');
    expect(errors).toContain("L'email du président est requis");
  });
});

// --- createAssociation tests ---

describe('createAssociation()', () => {
  describe('validation failures', () => {
    it('returns errors when input fields are missing', async () => {
      const deps = createMockDeps();
      const result = await createAssociation({}, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns errors for invalid email format without touching the database', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), presidentEmail: 'not-an-email' };
      const result = await createAssociation(input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("L'email du président est invalide");
      expect(deps.associationsRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('returns errors for multiple invalid fields at once', async () => {
      const deps = createMockDeps();
      const input = { name: '', logo: null, presidentName: '', presidentEmail: '' };
      const result = await createAssociation(input, deps);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(4);
    });
  });

  describe('email uniqueness', () => {
    it('rejects when email is already in use (case-insensitive)', async () => {
      const deps = createMockDeps({
        associationsRepository: {
          findByEmail: vi.fn().mockResolvedValue({ id: 'existing-id' }),
          create: vi.fn(),
        },
      });

      const input = { ...validInput(), presidentEmail: 'KOUAME@Example.COM' };
      const result = await createAssociation(input, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("L'email est déjà utilisé");
      expect(deps.associationsRepository.findByEmail).toHaveBeenCalledWith({}, 'kouame@example.com');
    });
  });

  describe('successful creation', () => {
    it('creates association, manager account, stores logo, and sends credentials', async () => {
      const deps = createMockDeps();
      const input = validInput();
      const result = await createAssociation(input, deps);

      expect(result.success).toBe(true);
      expect(result.association).toBeDefined();
      expect(result.association.id).toBeDefined();

      // Logo was stored
      expect(deps.photoStorageService.storeImage).toHaveBeenCalledWith(input.logo, 'logo');

      // Credential was generated and hashed
      expect(deps.credentialService.generateTemporaryPassword).toHaveBeenCalled();
      expect(deps.credentialService.hashPassword).toHaveBeenCalledWith('Temp1234!abcXYZ');

      // Association was created with the logo reference
      expect(deps.associationsRepository.create).toHaveBeenCalledWith({}, {
        name: input.name,
        logoRef: 'https://res.cloudinary.com/test/logo/image.png',
        presidentName: input.presidentName,
        presidentEmail: input.presidentEmail,
        presidentEmailLower: 'kouame@example.com',
      });

      // Manager account was created
      expect(deps.usersRepository.create).toHaveBeenCalledWith({}, {
        email: input.presidentEmail,
        emailLower: 'kouame@example.com',
        passwordHash: '$2b$10$hashedpassword',
        role: 'ASSOCIATION_MANAGER',
        associationId: '550e8400-e29b-41d4-a716-446655440000',
      });

      // Credentials email was sent
      expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
        input.presidentName,
        input.presidentEmail,
        'Temp1234!abcXYZ',
        undefined,
      );
    });

    it('normalizes email to lowercase for uniqueness check', async () => {
      const deps = createMockDeps();
      const input = { ...validInput(), presidentEmail: 'Kouame@EXAMPLE.com' };
      await createAssociation(input, deps);

      expect(deps.associationsRepository.findByEmail).toHaveBeenCalledWith({}, 'kouame@example.com');
    });
  });

  describe('atomic rollback on failures', () => {
    it('returns error when logo storage fails (no reference)', async () => {
      const deps = createMockDeps({
        photoStorageService: {
          storeImage: vi.fn().mockResolvedValue({ reference: null, error: 'Upload failed' }),
        },
      });

      // We need withTransaction to actually throw so we can test the rollback path
      deps.withTransaction = async (fn) => {
        try {
          return await fn({});
        } catch (err) {
          throw err;
        }
      };

      const result = await createAssociation(validInput(), deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe("L'association n'a pas pu être créée");
      // Association was never created
      expect(deps.associationsRepository.create).not.toHaveBeenCalled();
    });

    it('returns error when manager account creation fails', async () => {
      const deps = createMockDeps({
        usersRepository: {
          create: vi.fn().mockRejectedValue(new Error('DB constraint violation')),
        },
      });

      deps.withTransaction = async (fn) => {
        try {
          return await fn({});
        } catch (err) {
          throw err;
        }
      };

      const result = await createAssociation(validInput(), deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe("L'association n'a pas pu être créée");
    });

    it('persists nothing when logo reference is null (transaction rolls back)', async () => {
      let committed = false;
      const mockClient = {};

      const deps = createMockDeps({
        photoStorageService: {
          storeImage: vi.fn().mockResolvedValue({ reference: null }),
        },
        associationsRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
      });

      deps.withTransaction = async (fn) => {
        try {
          const result = await fn(mockClient);
          committed = true;
          return result;
        } catch (err) {
          // Transaction rolled back
          throw err;
        }
      };

      const result = await createAssociation(validInput(), deps);

      expect(result.success).toBe(false);
      expect(committed).toBe(false);
      expect(deps.associationsRepository.create).not.toHaveBeenCalled();
    });
  });
});

// --- updateAssociation tests ---

describe('updateAssociation()', () => {
  const ASSOC_ID = '550e8400-e29b-41d4-a716-446655440000';

  function existingAssociation(overrides = {}) {
    return {
      id: ASSOC_ID,
      name: 'Association Ivoirienne de Mumbai',
      logo_ref: 'https://res.cloudinary.com/test/logo/image.png',
      president_name: 'Kouamé Yao',
      president_email: 'kouame@example.com',
      president_email_lower: 'kouame@example.com',
      ...overrides,
    };
  }

  function updateInput(overrides = {}) {
    return {
      name: 'Association Ivoirienne de Mumbai',
      presidentName: 'Kouamé Yao',
      presidentEmail: 'kouame@example.com',
      ...overrides,
    };
  }

  function createUpdateDeps(overrides = {}) {
    const existing = overrides.existing || existingAssociation();
    const manager = overrides.manager !== undefined ? overrides.manager : {
      id: '660e8400-e29b-41d4-a716-446655440001',
      email: existing.president_email,
      email_lower: existing.president_email_lower,
      role: 'ASSOCIATION_MANAGER',
      association_id: ASSOC_ID,
    };

    return {
      associationsRepository: {
        findById: vi.fn().mockResolvedValue(existing),
        findByEmail: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ ...existing, name: 'updated' }),
        ...overrides.associationsRepository,
      },
      usersRepository: {
        // First lookup: by old email → returns manager. Second lookup: by new email → clash.
        findByEmailAndAssociation: vi.fn().mockResolvedValue(manager),
        updateEmailAndResetTempPassword: vi.fn().mockResolvedValue({ id: manager && manager.id }),
        ...overrides.usersRepository,
      },
      credentialService: {
        generateTemporaryPassword: vi.fn().mockReturnValue('NewTemp1234!xyz'),
        hashPassword: vi.fn().mockResolvedValue('$2b$10$newhashedpassword'),
        ...overrides.credentialService,
      },
      emailService: {
        sendCredentials: vi.fn().mockResolvedValue({ success: true }),
        ...overrides.emailService,
      },
      photoStorageService: {
        storeImage: vi.fn().mockResolvedValue({ reference: 'https://res.cloudinary.com/test/logo/new.png' }),
        ...overrides.photoStorageService,
      },
      withTransaction: overrides.withTransaction || (async (fn) => fn({})),
    };
  }

  it('does NOT modify the manager account when the email is unchanged', async () => {
    const deps = createUpdateDeps();
    const result = await updateAssociation(ASSOC_ID, updateInput({ name: 'New Name' }), deps);

    expect(result.success).toBe(true);
    expect(deps.usersRepository.findByEmailAndAssociation).not.toHaveBeenCalled();
    expect(deps.usersRepository.updateEmailAndResetTempPassword).not.toHaveBeenCalled();
    expect(deps.credentialService.generateTemporaryPassword).not.toHaveBeenCalled();
    expect(deps.emailService.sendCredentials).not.toHaveBeenCalled();
    expect(deps.associationsRepository.update).toHaveBeenCalled();
  });

  it('syncs the manager account when the email changes', async () => {
    const deps = createUpdateDeps({
      usersRepository: {
        // old-email lookup returns manager; new-email lookup returns null (no clash)
        findByEmailAndAssociation: vi.fn()
          .mockResolvedValueOnce({
            id: '660e8400-e29b-41d4-a716-446655440001',
            email: 'kouame@example.com',
            email_lower: 'kouame@example.com',
          })
          .mockResolvedValueOnce(null),
        updateEmailAndResetTempPassword: vi.fn().mockResolvedValue({ id: '660e8400-e29b-41d4-a716-446655440001' }),
      },
    });

    const input = updateInput({ presidentEmail: 'NewPrez@Example.com' });
    const result = await updateAssociation(ASSOC_ID, input, deps);

    expect(result.success).toBe(true);

    // Manager looked up by OLD email
    expect(deps.usersRepository.findByEmailAndAssociation).toHaveBeenNthCalledWith(
      1, {}, 'kouame@example.com', ASSOC_ID
    );
    // Clash check by NEW (lowercased) email
    expect(deps.usersRepository.findByEmailAndAssociation).toHaveBeenNthCalledWith(
      2, {}, 'newprez@example.com', ASSOC_ID
    );

    // New temp password generated and hashed
    expect(deps.credentialService.generateTemporaryPassword).toHaveBeenCalled();
    expect(deps.credentialService.hashPassword).toHaveBeenCalledWith('NewTemp1234!xyz');

    // Manager updated with new email + hashed password
    expect(deps.usersRepository.updateEmailAndResetTempPassword).toHaveBeenCalledWith(
      {},
      '660e8400-e29b-41d4-a716-446655440001',
      {
        email: 'NewPrez@Example.com',
        emailLower: 'newprez@example.com',
        passwordHash: '$2b$10$newhashedpassword',
      }
    );

    // Credentials emailed to the NEW address
    expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
      input.presidentName,
      'NewPrez@Example.com',
      'NewTemp1234!xyz',
      undefined
    );
  });

  it('returns an error and does NOT reset the password when the new email clashes with another user', async () => {
    const deps = createUpdateDeps({
      usersRepository: {
        findByEmailAndAssociation: vi.fn()
          // old-email lookup → the manager
          .mockResolvedValueOnce({ id: 'manager-id', email_lower: 'kouame@example.com' })
          // new-email lookup → a DIFFERENT existing user
          .mockResolvedValueOnce({ id: 'other-user-id', email_lower: 'newprez@example.com' }),
        updateEmailAndResetTempPassword: vi.fn(),
      },
    });

    const result = await updateAssociation(ASSOC_ID, updateInput({ presidentEmail: 'newprez@example.com' }), deps);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("L'email est déjà utilisé par un autre compte de cette association");
    expect(deps.usersRepository.updateEmailAndResetTempPassword).not.toHaveBeenCalled();
    expect(deps.emailService.sendCredentials).not.toHaveBeenCalled();
  });
});

// --- createRegistryAssociation tests ---

describe('createRegistryAssociation()', () => {
  function registryInput(overrides = {}) {
    return {
      name: 'Association des Ivoiriens de Bombay',
      emblem: 'Unité et Progrès',
      logo: Buffer.from('fake-image-data'),
      ...overrides,
    };
  }

  function createRegistryDeps(overrides = {}) {
    const created = {
      id: '770e8400-e29b-41d4-a716-446655440002',
      name: 'Association des Ivoiriens de Bombay',
      emblem: 'Unité et Progrès',
      logo_ref: 'https://res.cloudinary.com/test/logo/reg.png',
      president_name: null,
      president_email: null,
      president_email_lower: null,
    };
    return {
      associationsRepository: {
        findByName: vi.fn().mockResolvedValue(null),
        createRegistry: vi.fn().mockResolvedValue(created),
        ...overrides.associationsRepository,
      },
      photoStorageService: {
        storeImage: vi.fn().mockResolvedValue({ reference: 'https://res.cloudinary.com/test/logo/reg.png' }),
        ...overrides.photoStorageService,
      },
      withTransaction: overrides.withTransaction || (async (fn) => fn({})),
    };
  }

  it('returns errors when name is missing', async () => {
    const deps = createRegistryDeps();
    const result = await createRegistryAssociation(registryInput({ name: '' }), deps);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Le nom est requis');
    expect(deps.associationsRepository.findByName).not.toHaveBeenCalled();
  });

  it('returns errors when name exceeds 200 characters', async () => {
    const deps = createRegistryDeps();
    const result = await createRegistryAssociation(registryInput({ name: 'A'.repeat(201) }), deps);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Le nom ne doit pas dépasser 200 caractères');
  });

  it('returns errors when emblem exceeds 500 characters', async () => {
    const deps = createRegistryDeps();
    const result = await createRegistryAssociation(registryInput({ emblem: 'E'.repeat(501) }), deps);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("L'emblème ne doit pas dépasser 500 caractères");
  });

  it('returns errors when logo is missing', async () => {
    const deps = createRegistryDeps();
    const result = await createRegistryAssociation(registryInput({ logo: null }), deps);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Le logo est requis');
  });

  it('rejects a duplicate name (case-insensitive)', async () => {
    const deps = createRegistryDeps({
      associationsRepository: {
        findByName: vi.fn().mockResolvedValue({ id: 'existing' }),
        createRegistry: vi.fn(),
      },
    });
    const result = await createRegistryAssociation(registryInput({ name: 'ASSOCIATION des IVOIRIENS de BOMBAY' }), deps);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Une association portant ce nom existe déjà');
    expect(deps.associationsRepository.findByName).toHaveBeenCalledWith({}, 'association des ivoiriens de bombay');
    expect(deps.associationsRepository.createRegistry).not.toHaveBeenCalled();
  });

  it('rolls back when logo storage returns no reference', async () => {
    const deps = createRegistryDeps({
      photoStorageService: { storeImage: vi.fn().mockResolvedValue({ reference: null, error: 'fail' }) },
      associationsRepository: { findByName: vi.fn().mockResolvedValue(null), createRegistry: vi.fn() },
    });
    deps.withTransaction = async (fn) => fn({});
    const result = await createRegistryAssociation(registryInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe("L'association n'a pas pu être créée");
    expect(deps.associationsRepository.createRegistry).not.toHaveBeenCalled();
  });

  it('creates a registry association (emblem optional, no president)', async () => {
    const deps = createRegistryDeps();
    const input = registryInput();
    const result = await createRegistryAssociation(input, deps);

    expect(result.success).toBe(true);
    expect(result.association.id).toBeDefined();
    expect(deps.photoStorageService.storeImage).toHaveBeenCalledWith(input.logo, 'logo');
    expect(deps.associationsRepository.createRegistry).toHaveBeenCalledWith({}, {
      name: input.name,
      emblem: 'Unité et Progrès',
      logoRef: 'https://res.cloudinary.com/test/logo/reg.png',
    });
  });

  it('normalizes a missing emblem to null', async () => {
    const deps = createRegistryDeps();
    await createRegistryAssociation(registryInput({ emblem: '' }), deps);
    expect(deps.associationsRepository.createRegistry).toHaveBeenCalledWith({}, expect.objectContaining({ emblem: null }));
  });
});

// --- assignManager tests ---

describe('assignManager()', () => {
  const ASSOC_ID = '770e8400-e29b-41d4-a716-446655440002';

  function assoc(overrides = {}) {
    return {
      id: ASSOC_ID,
      name: 'Association des Ivoiriens de Bombay',
      emblem: 'Unité et Progrès',
      logo_ref: 'https://res.cloudinary.com/test/logo/reg.png',
      president_name: null,
      president_email: null,
      president_email_lower: null,
      ...overrides,
    };
  }

  function managerInput(overrides = {}) {
    return { presidentName: 'Aya Traoré', presidentEmail: 'aya@example.com', ...overrides };
  }

  function createAssignDeps(overrides = {}) {
    const existing = overrides.existing !== undefined ? overrides.existing : assoc();
    return {
      associationsRepository: {
        findById: vi.fn().mockResolvedValue(existing),
        hasManager: vi.fn().mockResolvedValue(false),
        setPresident: vi.fn().mockImplementation(async (_c, id, data) => ({
          ...assoc(),
          president_name: data.presidentName,
          president_email: data.presidentEmail,
          president_email_lower: data.presidentEmailLower,
        })),
        ...overrides.associationsRepository,
      },
      usersRepository: {
        findByEmailAndAssociation: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'user-1', role: 'ASSOCIATION_MANAGER' }),
        ...overrides.usersRepository,
      },
      credentialService: {
        generateTemporaryPassword: vi.fn().mockReturnValue('Temp1234!abcXYZ'),
        hashPassword: vi.fn().mockResolvedValue('$2b$10$hashedpassword'),
        ...overrides.credentialService,
      },
      emailService: {
        sendCredentials: vi.fn().mockResolvedValue({ success: true }),
        ...overrides.emailService,
      },
      withTransaction: overrides.withTransaction || (async (fn) => fn({})),
    };
  }

  it('returns an error when the association does not exist', async () => {
    const deps = createAssignDeps({ existing: null });
    const result = await assignManager(ASSOC_ID, managerInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Association introuvable');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('returns an error when the association already has a manager', async () => {
    const deps = createAssignDeps({
      associationsRepository: {
        findById: vi.fn().mockResolvedValue(assoc()),
        hasManager: vi.fn().mockResolvedValue(true),
        setPresident: vi.fn(),
      },
    });
    const result = await assignManager(ASSOC_ID, managerInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cette association a déjà un gestionnaire');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('validates president fields', async () => {
    const deps = createAssignDeps();
    const result = await assignManager(ASSOC_ID, managerInput({ presidentEmail: 'not-an-email' }), deps);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("L'email du président est invalide");
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('returns an error when the email is already used in the association', async () => {
    const deps = createAssignDeps({
      usersRepository: {
        findByEmailAndAssociation: vi.fn().mockResolvedValue({ id: 'someone-else' }),
        create: vi.fn(),
      },
    });
    const result = await assignManager(ASSOC_ID, managerInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cet email est déjà utilisé');
    expect(deps.usersRepository.create).not.toHaveBeenCalled();
  });

  it('creates the manager, sets the president, and sends a branded email', async () => {
    const deps = createAssignDeps();
    const input = managerInput({ presidentEmail: 'Aya@Example.com' });
    const result = await assignManager(ASSOC_ID, input, deps);

    expect(result.success).toBe(true);
    expect(result.association.president_email_lower).toBe('aya@example.com');

    // Manager user created with the association scope and full name
    expect(deps.usersRepository.create).toHaveBeenCalledWith({}, {
      email: 'Aya@Example.com',
      emailLower: 'aya@example.com',
      passwordHash: '$2b$10$hashedpassword',
      role: 'ASSOCIATION_MANAGER',
      associationId: ASSOC_ID,
      fullName: 'Aya Traoré',
    });

    // President fields set on the association
    expect(deps.associationsRepository.setPresident).toHaveBeenCalledWith({}, ASSOC_ID, {
      presidentName: 'Aya Traoré',
      presidentEmail: 'Aya@Example.com',
      presidentEmailLower: 'aya@example.com',
    });

    // Branded credentials email uses the association's logo + name
    expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
      'Aya Traoré',
      'Aya@Example.com',
      'Temp1234!abcXYZ',
      { logoUrl: 'https://res.cloudinary.com/test/logo/reg.png', brandName: 'Association des Ivoiriens de Bombay' }
    );
  });
});

// --- deleteRegistryAssociation tests ---

describe('deleteRegistryAssociation()', () => {
  const ASSOC_ID = '770e8400-e29b-41d4-a716-446655440002';

  function createDeleteDeps(overrides = {}) {
    return {
      associationsRepository: {
        findById: vi.fn().mockResolvedValue({ id: ASSOC_ID, name: 'X' }),
        countElections: vi.fn().mockResolvedValue(0),
        countUsers: vi.fn().mockResolvedValue(0),
        deleteById: vi.fn().mockResolvedValue(1),
        ...overrides.associationsRepository,
      },
      withTransaction: overrides.withTransaction || (async (fn) => fn({})),
    };
  }

  it('returns an error when the association does not exist', async () => {
    const deps = createDeleteDeps({ associationsRepository: { findById: vi.fn().mockResolvedValue(null) } });
    const result = await deleteRegistryAssociation(ASSOC_ID, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Association introuvable');
  });

  it('refuses deletion when elections are linked', async () => {
    const deps = createDeleteDeps({
      associationsRepository: {
        findById: vi.fn().mockResolvedValue({ id: ASSOC_ID }),
        countElections: vi.fn().mockResolvedValue(2),
        countUsers: vi.fn().mockResolvedValue(0),
        deleteById: vi.fn(),
      },
    });
    const result = await deleteRegistryAssociation(ASSOC_ID, deps);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Impossible de supprimer: des élections ou des comptes sont liés à cette association');
    expect(deps.associationsRepository.deleteById).not.toHaveBeenCalled();
  });

  it('refuses deletion when users are linked', async () => {
    const deps = createDeleteDeps({
      associationsRepository: {
        findById: vi.fn().mockResolvedValue({ id: ASSOC_ID }),
        countElections: vi.fn().mockResolvedValue(0),
        countUsers: vi.fn().mockResolvedValue(1),
        deleteById: vi.fn(),
      },
    });
    const result = await deleteRegistryAssociation(ASSOC_ID, deps);
    expect(result.success).toBe(false);
    expect(deps.associationsRepository.deleteById).not.toHaveBeenCalled();
  });

  it('deletes when no elections or users are linked', async () => {
    const deps = createDeleteDeps();
    const result = await deleteRegistryAssociation(ASSOC_ID, deps);
    expect(result.success).toBe(true);
    expect(deps.associationsRepository.deleteById).toHaveBeenCalledWith({}, ASSOC_ID);
  });
});
