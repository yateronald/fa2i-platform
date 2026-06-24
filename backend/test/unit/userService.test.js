import { describe, it, expect, vi } from 'vitest';
import { createFederationUser } from '../../src/services/userService.js';

/**
 * Unit tests for User_Service - createFederationUser
 *
 * Tests cover:
 * - Email format validation
 * - Federation role validation
 * - Duplicate federation email rejection
 * - Atomic creation with temp password generation and credentials email
 */

// --- Helpers ---

function validInput() {
  return {
    email: 'manager@example.com',
    role: 'FEDERATION_ELECTION_MANAGER',
  };
}

function createMockDeps(overrides = {}) {
  const createdUser = {
    id: '770e8400-e29b-41d4-a716-446655440002',
    email: 'manager@example.com',
    email_lower: 'manager@example.com',
    role: 'FEDERATION_ELECTION_MANAGER',
    association_id: null,
    is_active: true,
  };

  return {
    usersRepository: {
      findFederationUserByEmail: vi.fn().mockResolvedValue(null),
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
    withTransaction: overrides.withTransaction || (async (fn) => fn({})),
  };
}

describe('createFederationUser()', () => {
  describe('validation failures', () => {
    it('returns errors for an invalid email', async () => {
      const deps = createMockDeps();
      const result = await createFederationUser({ email: 'not-an-email', role: 'FEDERATION_ELECTION_MANAGER' }, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("L'email est invalide");
      expect(deps.usersRepository.findFederationUserByEmail).not.toHaveBeenCalled();
    });

    it('returns errors for a missing email', async () => {
      const deps = createMockDeps();
      const result = await createFederationUser({ email: '', role: 'FEDERATION_ELECTION_MANAGER' }, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("L'email est requis");
    });

    it('returns errors for an invalid role', async () => {
      const deps = createMockDeps();
      const result = await createFederationUser({ email: 'manager@example.com', role: 'VOTER' }, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Le rôle est invalide');
    });

    it('returns errors for a missing role', async () => {
      const deps = createMockDeps();
      const result = await createFederationUser({ email: 'manager@example.com' }, deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Le rôle est invalide');
    });
  });

  describe('email uniqueness', () => {
    it('rejects when a federation user with the email already exists', async () => {
      const deps = createMockDeps({
        usersRepository: {
          findFederationUserByEmail: vi.fn().mockResolvedValue({ id: 'existing-id' }),
          create: vi.fn(),
        },
      });

      const result = await createFederationUser(validInput(), deps);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Un utilisateur avec cet email existe déjà');
      expect(deps.usersRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('successful creation', () => {
    it('creates a federation user with association_id null, generates a temp password, and emails credentials', async () => {
      const deps = createMockDeps();
      const input = validInput();
      const result = await createFederationUser(input, deps);

      expect(result.success).toBe(true);
      expect(result.user).toMatchObject({
        email: 'manager@example.com',
        role: 'FEDERATION_ELECTION_MANAGER',
      });

      // Temp password generated and hashed
      expect(deps.credentialService.generateTemporaryPassword).toHaveBeenCalled();
      expect(deps.credentialService.hashPassword).toHaveBeenCalledWith('Temp1234!abcXYZ');

      // User created as a federation-scope account (association_id null)
      expect(deps.usersRepository.create).toHaveBeenCalledWith({}, {
        email: input.email,
        emailLower: 'manager@example.com',
        passwordHash: '$2b$10$hashedpassword',
        role: 'FEDERATION_ELECTION_MANAGER',
        associationId: null,
      });

      // Credentials email sent
      expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
        input.email,
        input.email,
        'Temp1234!abcXYZ',
        undefined,
      );
    });

    it('accepts the FEDERATION_ADMINISTRATOR role', async () => {
      const deps = createMockDeps();
      const result = await createFederationUser({ email: 'admin@example.com', role: 'FEDERATION_ADMINISTRATOR' }, deps);

      expect(result.success).toBe(true);
      expect(deps.usersRepository.create).toHaveBeenCalledWith({}, expect.objectContaining({
        role: 'FEDERATION_ADMINISTRATOR',
        associationId: null,
      }));
    });
  });
});
