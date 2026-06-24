import { describe, it, expect, vi } from 'vitest';
import { generateTemporaryPassword, hashPassword, verifyPassword, isTemporaryExpired, meetsCompositionRule, rotatePassword } from '../../src/services/credentialService.js';

describe('generateTemporaryPassword()', () => {
  it('returns a string of exactly 16 characters', () => {
    const password = generateTemporaryPassword();
    expect(typeof password).toBe('string');
    expect(password.length).toBe(16);
  });

  it('has length within the 12–128 character range', () => {
    const password = generateTemporaryPassword();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(password.length).toBeLessThanOrEqual(128);
  });

  it('contains at least one uppercase letter', () => {
    const password = generateTemporaryPassword();
    expect(/[A-Z]/.test(password)).toBe(true);
  });

  it('contains at least one lowercase letter', () => {
    const password = generateTemporaryPassword();
    expect(/[a-z]/.test(password)).toBe(true);
  });

  it('contains at least one digit', () => {
    const password = generateTemporaryPassword();
    expect(/[0-9]/.test(password)).toBe(true);
  });

  it('contains at least one symbol', () => {
    const password = generateTemporaryPassword();
    expect(/[^A-Za-z0-9]/.test(password)).toBe(true);
  });

  it('produces different passwords on consecutive calls', () => {
    const passwords = new Set();
    for (let i = 0; i < 20; i++) {
      passwords.add(generateTemporaryPassword());
    }
    // With 16-char random passwords, collisions are effectively impossible
    expect(passwords.size).toBe(20);
  });

  it('satisfies composition rule across 100 generated passwords', () => {
    for (let i = 0; i < 100; i++) {
      const password = generateTemporaryPassword();
      expect(password.length).toBeGreaterThanOrEqual(12);
      expect(password.length).toBeLessThanOrEqual(128);
      expect(/[A-Z]/.test(password)).toBe(true);
      expect(/[a-z]/.test(password)).toBe(true);
      expect(/[0-9]/.test(password)).toBe(true);
      expect(/[^A-Za-z0-9]/.test(password)).toBe(true);
    }
  });
});

describe('hashPassword()', () => {
  it('returns a bcrypt hash string (starts with $2b$)', async () => {
    const hash = await hashPassword('MyP@ss1234');
    expect(typeof hash).toBe('string');
    expect(hash.startsWith('$2b$') || hash.startsWith('$2a$')).toBe(true);
  });

  it('does not return the plaintext or contain it in the hash', async () => {
    const plaintext = 'Secret!Pass99';
    const hash = await hashPassword(plaintext);
    expect(hash).not.toBe(plaintext);
    expect(hash).not.toContain(plaintext);
  });

  it('produces different hashes for the same password (per-account salt)', async () => {
    const plaintext = 'SamePassword1!';
    const hash1 = await hashPassword(plaintext);
    const hash2 = await hashPassword(plaintext);
    expect(hash1).not.toBe(hash2);
  });

  it('produces a hash that can be verified with the original plaintext', async () => {
    const plaintext = 'Verifiable#7xyz';
    const hash = await hashPassword(plaintext);
    const result = await verifyPassword(plaintext, hash);
    expect(result).toBe(true);
  });
});

describe('verifyPassword()', () => {
  it('returns true for the correct plaintext', async () => {
    const plaintext = 'Correct!Horse2';
    const hash = await hashPassword(plaintext);
    expect(await verifyPassword(plaintext, hash)).toBe(true);
  });

  it('returns false for an incorrect plaintext', async () => {
    const hash = await hashPassword('Original$1pw');
    expect(await verifyPassword('Wrong$1pw', hash)).toBe(false);
  });

  it('returns false for an empty string when the hash is from a real password', async () => {
    const hash = await hashPassword('RealPassword!9');
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('correctly distinguishes similar passwords', async () => {
    const hash = await hashPassword('Password1!');
    expect(await verifyPassword('Password1!', hash)).toBe(true);
    expect(await verifyPassword('password1!', hash)).toBe(false);
    expect(await verifyPassword('Password1', hash)).toBe(false);
    expect(await verifyPassword('Password1! ', hash)).toBe(false);
  });
});


describe('isTemporaryExpired()', () => {
  const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000; // 259200000 ms

  it('returns false when exactly 72 hours have elapsed', () => {
    const generatedAt = new Date('2024-01-01T00:00:00.000Z');
    const now = new Date(generatedAt.getTime() + SEVENTY_TWO_HOURS_MS);
    expect(isTemporaryExpired(generatedAt, now)).toBe(false);
  });

  it('returns true when more than 72 hours have elapsed (72h + 1ms)', () => {
    const generatedAt = new Date('2024-01-01T00:00:00.000Z');
    const now = new Date(generatedAt.getTime() + SEVENTY_TWO_HOURS_MS + 1);
    expect(isTemporaryExpired(generatedAt, now)).toBe(true);
  });

  it('returns false when less than 72 hours have elapsed', () => {
    const generatedAt = new Date('2024-01-01T00:00:00.000Z');
    const now = new Date(generatedAt.getTime() + SEVENTY_TWO_HOURS_MS - 1);
    expect(isTemporaryExpired(generatedAt, now)).toBe(false);
  });

  it('returns false when no time has elapsed (same instant)', () => {
    const generatedAt = new Date('2024-06-15T12:00:00.000Z');
    expect(isTemporaryExpired(generatedAt, generatedAt)).toBe(false);
  });

  it('returns true when several days have elapsed', () => {
    const generatedAt = new Date('2024-01-01T00:00:00.000Z');
    const now = new Date('2024-01-10T00:00:00.000Z'); // 9 days later
    expect(isTemporaryExpired(generatedAt, now)).toBe(true);
  });

  it('accepts ISO string inputs', () => {
    const generatedAt = '2024-03-01T10:00:00.000Z';
    // 72h + 1ms later
    const now = new Date(new Date(generatedAt).getTime() + SEVENTY_TWO_HOURS_MS + 1).toISOString();
    expect(isTemporaryExpired(generatedAt, now)).toBe(true);
  });

  it('accepts mixed Date and ISO string inputs', () => {
    const generatedAt = new Date('2024-03-01T10:00:00.000Z');
    const now = '2024-03-01T12:00:00.000Z'; // only 2 hours later
    expect(isTemporaryExpired(generatedAt, now)).toBe(false);
  });

  it('returns false when 71 hours and 59 minutes have elapsed', () => {
    const generatedAt = new Date('2024-01-01T00:00:00.000Z');
    const almostExpired = new Date(generatedAt.getTime() + (71 * 60 + 59) * 60 * 1000);
    expect(isTemporaryExpired(generatedAt, almostExpired)).toBe(false);
  });
});


describe('meetsCompositionRule()', () => {
  it('returns valid for a compliant password', () => {
    const result = meetsCompositionRule('ValidPass1234!');
    expect(result).toEqual({ valid: true });
  });

  it('rejects passwords shorter than 12 characters', () => {
    const result = meetsCompositionRule('Short1!aB');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least 12 characters');
  });

  it('rejects passwords longer than 128 characters', () => {
    const longPassword = 'Aa1!' + 'x'.repeat(125); // 129 chars
    const result = meetsCompositionRule(longPassword);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at most 128 characters');
  });

  it('rejects passwords without an uppercase letter', () => {
    const result = meetsCompositionRule('nouppercase1!x');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('uppercase letter');
  });

  it('rejects passwords without a lowercase letter', () => {
    const result = meetsCompositionRule('NOLOWERCASE1!X');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('lowercase letter');
  });

  it('rejects passwords without a digit', () => {
    const result = meetsCompositionRule('NoDigitsHere!!');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('digit');
  });

  it('rejects passwords without a symbol', () => {
    const result = meetsCompositionRule('NoSymbols1234A');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('symbol');
  });

  it('accepts a password that is exactly 12 characters', () => {
    const result = meetsCompositionRule('Abcdefgh1!23');
    expect(result.valid).toBe(true);
  });

  it('accepts a password that is exactly 128 characters', () => {
    const pw = 'Aa1!' + 'x'.repeat(124); // 128 chars
    const result = meetsCompositionRule(pw);
    expect(result.valid).toBe(true);
  });

  it('rejects non-string input', () => {
    const result = meetsCompositionRule(12345);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('string');
  });
});

describe('rotatePassword()', () => {
  function createMockPool(user) {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    return { mockPool, mockClient };
  }

  function createMockUsersRepository(user) {
    return {
      findById: vi.fn().mockResolvedValue(user),
      updatePassword: vi.fn().mockResolvedValue(1),
    };
  }

  it('succeeds when the new password is valid and different from the temporary password', async () => {
    const tempPassword = 'TempPass123!xx';
    const tempHash = await hashPassword(tempPassword);
    const user = { id: 'user-1', password_hash: tempHash, is_temporary_password: true };

    const { mockPool } = createMockPool();
    const mockUsersRepo = createMockUsersRepository(user);

    const result = await rotatePassword('user-1', 'NewSecure99!ab', {
      usersRepository: mockUsersRepo,
      pool: mockPool,
    });

    expect(result).toEqual({ success: true });
    expect(mockUsersRepo.updatePassword).toHaveBeenCalledOnce();
    const [client, id, newHash] = mockUsersRepo.updatePassword.mock.calls[0];
    expect(id).toBe('user-1');
    expect(typeof newHash).toBe('string');
    // The stored hash should verify against the new password
    const matches = await verifyPassword('NewSecure99!ab', newHash);
    expect(matches).toBe(true);
  });

  it('fails when the new password does not meet the composition rule (too short)', async () => {
    const { mockPool } = createMockPool();
    const mockUsersRepo = createMockUsersRepository(null);

    const result = await rotatePassword('user-1', 'Short1!', {
      usersRepository: mockUsersRepo,
      pool: mockPool,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('at least 12 characters');
    // Should not even call the pool or repository
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockUsersRepo.updatePassword).not.toHaveBeenCalled();
  });

  it('fails when the new password has no uppercase letter', async () => {
    const { mockPool } = createMockPool();
    const mockUsersRepo = createMockUsersRepository(null);

    const result = await rotatePassword('user-1', 'nouppercase1!x', {
      usersRepository: mockUsersRepo,
      pool: mockPool,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('uppercase letter');
    expect(mockUsersRepo.updatePassword).not.toHaveBeenCalled();
  });

  it('fails when the new password is identical to the temporary password', async () => {
    const tempPassword = 'SameOldPass1!x';
    const tempHash = await hashPassword(tempPassword);
    const user = { id: 'user-1', password_hash: tempHash, is_temporary_password: true };

    const { mockPool } = createMockPool();
    const mockUsersRepo = createMockUsersRepository(user);

    const result = await rotatePassword('user-1', 'SameOldPass1!x', {
      usersRepository: mockUsersRepo,
      pool: mockPool,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('New password must be different from the temporary password');
    expect(mockUsersRepo.updatePassword).not.toHaveBeenCalled();
  });

  it('fails when the user is not found', async () => {
    const { mockPool } = createMockPool();
    const mockUsersRepo = createMockUsersRepository(null);

    const result = await rotatePassword('nonexistent-id', 'ValidNewPass1!', {
      usersRepository: mockUsersRepo,
      pool: mockPool,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('User not found');
    expect(mockUsersRepo.updatePassword).not.toHaveBeenCalled();
  });

  it('releases the database client even when an error occurs', async () => {
    const tempHash = await hashPassword('TempPass123!xx');
    const user = { id: 'user-1', password_hash: tempHash, is_temporary_password: true };

    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    const mockUsersRepo = {
      findById: vi.fn().mockRejectedValue(new Error('DB error')),
      updatePassword: vi.fn(),
    };

    await expect(
      rotatePassword('user-1', 'ValidNewPass1!', {
        usersRepository: mockUsersRepo,
        pool: mockPool,
      })
    ).rejects.toThrow('DB error');

    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('retains temporary status when composition rule is not met (no digit)', async () => {
    const { mockPool } = createMockPool();
    const mockUsersRepo = createMockUsersRepository(null);

    const result = await rotatePassword('user-1', 'NoDigitsHere!!', {
      usersRepository: mockUsersRepo,
      pool: mockPool,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('digit');
    expect(mockUsersRepo.updatePassword).not.toHaveBeenCalled();
  });
});
