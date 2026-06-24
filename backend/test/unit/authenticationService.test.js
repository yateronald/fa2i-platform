import { describe, it, expect, vi } from 'vitest';
import { authenticate } from '../../src/services/authenticationService.js';

/**
 * Helper to build a fake user record.
 */
function makeUser(overrides = {}) {
  return {
    id: 'user-uuid-1',
    email: 'test@example.com',
    email_lower: 'test@example.com',
    password_hash: '$2b$10$hashedvalue',
    role: 'VOTER',
    association_id: 'assoc-uuid-1',
    is_temporary_password: false,
    temp_password_set_at: null,
    failed_login_count: 0,
    locked_until: null,
    last_activity_at: null,
    is_active: true,
    ...overrides,
  };
}

/**
 * Helper to create dependency overrides for testing.
 */
function makeDeps({ user = null, verifyResult = false, isExpired = false, shouldThrow = false } = {}) {
  const mockClient = {
    release: vi.fn(),
  };

  const usersRepo = {
    findByEmail: shouldThrow
      ? vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
      : vi.fn().mockResolvedValue(user),
    updateFailedAttempts: vi.fn().mockResolvedValue(1),
    updateLockedUntil: vi.fn().mockResolvedValue(1),
  };

  const credential = {
    verifyPassword: vi.fn().mockResolvedValue(verifyResult),
    isTemporaryExpired: vi.fn().mockReturnValue(isExpired),
  };

  const dbPool = {
    connect: shouldThrow
      ? vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
      : vi.fn().mockResolvedValue(mockClient),
  };

  return { usersRepo, credential, dbPool, mockClient };
}

describe('authenticationService.authenticate()', () => {
  describe('unknown identifier', () => {
    it('returns { success: false, error: "Invalid credentials" } when user is not found', async () => {
      const deps = makeDeps({ user: null, verifyResult: false });
      const result = await authenticate('unknown@example.com', 'somePass1!', deps);

      expect(result).toEqual({ success: false, error: 'Invalid credentials' });
    });

    it('looks up the user by lowercased identifier', async () => {
      const deps = makeDeps({ user: null });
      await authenticate('Test@Example.COM', 'somePass1!', deps);

      expect(deps.usersRepo.findByEmail).toHaveBeenCalledWith(
        expect.anything(),
        'test@example.com'
      );
    });

    it('trims whitespace from the identifier', async () => {
      const deps = makeDeps({ user: null });
      await authenticate('  test@example.com  ', 'somePass1!', deps);

      expect(deps.usersRepo.findByEmail).toHaveBeenCalledWith(
        expect.anything(),
        'test@example.com'
      );
    });
  });

  describe('wrong password', () => {
    it('returns the same "Invalid credentials" error as unknown identifier', async () => {
      const user = makeUser();
      const deps = makeDeps({ user, verifyResult: false });
      const result = await authenticate('test@example.com', 'wrongPass!', deps);

      expect(result).toEqual({ success: false, error: 'Invalid credentials' });
    });

    it('uses the same error message for unknown identifier and wrong password (non-revealing)', async () => {
      const unknownDeps = makeDeps({ user: null });
      const unknownResult = await authenticate('nobody@x.com', 'pass', unknownDeps);

      const wrongPwDeps = makeDeps({ user: makeUser(), verifyResult: false });
      const wrongPwResult = await authenticate('test@example.com', 'wrong', wrongPwDeps);

      expect(unknownResult.error).toBe(wrongPwResult.error);
      expect(unknownResult.error).toBe('Invalid credentials');
    });
  });

  describe('account store unavailable (fail-closed)', () => {
    it('returns "Authentication is temporarily unavailable" when pool.connect throws', async () => {
      const deps = makeDeps({ shouldThrow: true });
      const result = await authenticate('test@example.com', 'pass', deps);

      expect(result).toEqual({
        success: false,
        error: 'Authentication is temporarily unavailable',
      });
    });

    it('returns "Authentication is temporarily unavailable" when findByEmail throws', async () => {
      const mockClient = { release: vi.fn() };
      const dbPool = { connect: vi.fn().mockResolvedValue(mockClient) };
      const usersRepo = {
        findByEmail: vi.fn().mockRejectedValue(new Error('connection reset')),
      };
      const credential = {
        verifyPassword: vi.fn(),
        isTemporaryExpired: vi.fn(),
      };

      const result = await authenticate('test@example.com', 'pass', {
        usersRepo,
        credential,
        dbPool,
      });

      expect(result).toEqual({
        success: false,
        error: 'Authentication is temporarily unavailable',
      });
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('correct password, non-temporary', () => {
    it('returns { success: true, user, mustRotatePassword: false }', async () => {
      const user = makeUser({ is_temporary_password: false });
      const deps = makeDeps({ user, verifyResult: true });
      const result = await authenticate('test@example.com', 'CorrectPass1!', deps);

      expect(result.success).toBe(true);
      expect(result.user).toEqual(user);
      expect(result.mustRotatePassword).toBe(false);
    });
  });

  describe('correct temporary password, not expired', () => {
    it('returns { success: true, user, mustRotatePassword: true }', async () => {
      const user = makeUser({
        is_temporary_password: true,
        temp_password_set_at: new Date().toISOString(),
      });
      const deps = makeDeps({ user, verifyResult: true, isExpired: false });
      const result = await authenticate('test@example.com', 'TempPass1!', deps);

      expect(result.success).toBe(true);
      expect(result.user).toEqual(user);
      expect(result.mustRotatePassword).toBe(true);
    });

    it('calls isTemporaryExpired with the user temp_password_set_at', async () => {
      const setAt = '2024-06-01T12:00:00.000Z';
      const user = makeUser({
        is_temporary_password: true,
        temp_password_set_at: setAt,
      });
      const deps = makeDeps({ user, verifyResult: true, isExpired: false });
      await authenticate('test@example.com', 'TempPass1!', deps);

      expect(deps.credential.isTemporaryExpired).toHaveBeenCalledWith(
        setAt,
        expect.any(Date)
      );
    });
  });

  describe('correct temporary password, expired (>72h)', () => {
    it('returns { success: false, error: "Invalid credentials" } (non-revealing)', async () => {
      const user = makeUser({
        is_temporary_password: true,
        temp_password_set_at: '2024-01-01T00:00:00.000Z',
      });
      const deps = makeDeps({ user, verifyResult: true, isExpired: true });
      const result = await authenticate('test@example.com', 'TempPass1!', deps);

      expect(result).toEqual({ success: false, error: 'Invalid credentials' });
    });

    it('uses the same error message as unknown identifier (non-revealing)', async () => {
      const unknownDeps = makeDeps({ user: null });
      const unknownResult = await authenticate('nobody@x.com', 'pass', unknownDeps);

      const expiredUser = makeUser({
        is_temporary_password: true,
        temp_password_set_at: '2024-01-01T00:00:00.000Z',
      });
      const expiredDeps = makeDeps({ user: expiredUser, verifyResult: true, isExpired: true });
      const expiredResult = await authenticate('test@example.com', 'TempPass1!', expiredDeps);

      expect(expiredResult.error).toBe(unknownResult.error);
    });
  });

  describe('client lifecycle', () => {
    it('releases the database client after a successful lookup', async () => {
      const deps = makeDeps({ user: makeUser(), verifyResult: true });
      await authenticate('test@example.com', 'pass', deps);

      expect(deps.mockClient.release).toHaveBeenCalled();
    });

    it('releases the database client even when user is not found', async () => {
      const deps = makeDeps({ user: null });
      await authenticate('nobody@x.com', 'pass', deps);

      expect(deps.mockClient.release).toHaveBeenCalled();
    });
  });

  describe('lockout policy (Req 5.3, 5.4)', () => {
    it('denies authentication while the account is locked and shows minutes remaining', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      // locked_until is 10 minutes from now
      const lockedUntil = new Date('2024-06-15T10:10:00.000Z');
      const user = makeUser({ locked_until: lockedUntil.toISOString() });
      const deps = makeDeps({ user, verifyResult: true });

      const result = await authenticate('test@example.com', 'CorrectPass1!', { ...deps, now });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Account is temporarily locked. Try again in 10 minutes.');
    });

    it('uses Math.ceil for partial minutes (e.g. 1 second left shows 1 minute)', async () => {
      const now = new Date('2024-06-15T10:14:01.000Z');
      // locked_until is 59 seconds ahead
      const lockedUntil = new Date('2024-06-15T10:15:00.000Z');
      const user = makeUser({ locked_until: lockedUntil.toISOString() });
      const deps = makeDeps({ user, verifyResult: true });

      const result = await authenticate('test@example.com', 'pass', { ...deps, now });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Account is temporarily locked. Try again in 1 minutes.');
    });

    it('allows authentication when locked_until has passed', async () => {
      const now = new Date('2024-06-15T10:16:00.000Z');
      // locked_until was in the past
      const lockedUntil = new Date('2024-06-15T10:15:00.000Z');
      const user = makeUser({
        locked_until: lockedUntil.toISOString(),
        failed_login_count: 5,
      });
      const deps = makeDeps({ user, verifyResult: true });

      const result = await authenticate('test@example.com', 'CorrectPass1!', { ...deps, now });

      expect(result.success).toBe(true);
    });

    it('does not check lockout for unknown users', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const deps = makeDeps({ user: null });

      const result = await authenticate('unknown@x.com', 'pass', { ...deps, now });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });

    it('increments failed_login_count on wrong password', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const user = makeUser({ failed_login_count: 2 });
      const deps = makeDeps({ user, verifyResult: false });

      await authenticate('test@example.com', 'wrongPass', { ...deps, now });

      expect(deps.usersRepo.updateFailedAttempts).toHaveBeenCalledWith(
        expect.anything(),
        user.id,
        3
      );
    });

    it('sets locked_until when failed_login_count reaches 5', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const user = makeUser({ failed_login_count: 4 }); // next failure = 5
      const deps = makeDeps({ user, verifyResult: false });

      await authenticate('test@example.com', 'wrongPass', { ...deps, now });

      expect(deps.usersRepo.updateFailedAttempts).toHaveBeenCalledWith(
        expect.anything(),
        user.id,
        5
      );
      expect(deps.usersRepo.updateLockedUntil).toHaveBeenCalledWith(
        expect.anything(),
        user.id,
        new Date(now.getTime() + 15 * 60 * 1000)
      );
    });

    it('does not set locked_until when failed_login_count is below 5', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const user = makeUser({ failed_login_count: 2 }); // next failure = 3
      const deps = makeDeps({ user, verifyResult: false });

      await authenticate('test@example.com', 'wrongPass', { ...deps, now });

      expect(deps.usersRepo.updateLockedUntil).not.toHaveBeenCalled();
    });

    it('resets failed_login_count to 0 on successful login', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const user = makeUser({ failed_login_count: 3 });
      const deps = makeDeps({ user, verifyResult: true });

      await authenticate('test@example.com', 'CorrectPass1!', { ...deps, now });

      expect(deps.usersRepo.updateFailedAttempts).toHaveBeenCalledWith(
        expect.anything(),
        user.id,
        0
      );
    });

    it('resets failed_login_count to 0 on successful login with temporary password', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const user = makeUser({
        failed_login_count: 3,
        is_temporary_password: true,
        temp_password_set_at: now.toISOString(),
      });
      const deps = makeDeps({ user, verifyResult: true, isExpired: false });

      const result = await authenticate('test@example.com', 'TempPass1!', { ...deps, now });

      expect(result.success).toBe(true);
      expect(result.mustRotatePassword).toBe(true);
      expect(deps.usersRepo.updateFailedAttempts).toHaveBeenCalledWith(
        expect.anything(),
        user.id,
        0
      );
    });

    it('lockout check happens before password verification', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const lockedUntil = new Date('2024-06-15T10:15:00.000Z');
      const user = makeUser({ locked_until: lockedUntil.toISOString() });
      const deps = makeDeps({ user, verifyResult: true });

      const result = await authenticate('test@example.com', 'CorrectPass1!', { ...deps, now });

      // Should be denied even though password is correct
      expect(result.success).toBe(false);
      expect(result.error).toContain('Account is temporarily locked');
      // verifyPassword should NOT have been called
      expect(deps.credential.verifyPassword).not.toHaveBeenCalled();
    });

    it('gracefully handles updateFailedAttempts failure (still returns Invalid credentials)', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const user = makeUser({ failed_login_count: 2 });
      const mockClient = { release: vi.fn() };
      const dbPool = {
        connect: vi.fn()
          .mockResolvedValueOnce(mockClient) // first call for findByEmail
          .mockRejectedValueOnce(new Error('pool exhausted')), // second call for update
      };
      const usersRepo = {
        findByEmail: vi.fn().mockResolvedValue(user),
        updateFailedAttempts: vi.fn().mockResolvedValue(1),
        updateLockedUntil: vi.fn().mockResolvedValue(1),
      };
      const credential = {
        verifyPassword: vi.fn().mockResolvedValue(false),
        isTemporaryExpired: vi.fn().mockReturnValue(false),
      };

      const result = await authenticate('test@example.com', 'wrongPass', {
        usersRepo,
        credential,
        dbPool,
        now,
      });

      expect(result).toEqual({ success: false, error: 'Invalid credentials' });
    });
  });
});
