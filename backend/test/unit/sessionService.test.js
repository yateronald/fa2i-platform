import { describe, it, expect, vi } from 'vitest';
import { establishSession, validateSession } from '../../src/services/authenticationService.js';

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
 * Helper to create mock dependencies for session tests.
 */
function makeSessionDeps(overrides = {}) {
  const mockClient = { release: vi.fn() };
  const usersRepo = {
    findById: vi.fn().mockResolvedValue(overrides.user || makeUser()),
    updateLastActivity: vi.fn().mockResolvedValue(1),
    ...overrides.usersRepo,
  };
  const dbPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    ...overrides.dbPool,
  };
  const sessionSecret = overrides.sessionSecret || 'test-session-secret-123';
  const now = overrides.now || new Date('2024-06-15T10:00:00.000Z');

  return { usersRepo, dbPool, sessionSecret, now, mockClient };
}

describe('authenticationService.establishSession()', () => {
  it('returns a signed JWT token containing the userId', async () => {
    const deps = makeSessionDeps();
    const token = await establishSession('user-uuid-1', deps);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('signs the token with the provided session secret', async () => {
    const signJwt = vi.fn().mockReturnValue('mock-token');
    const deps = makeSessionDeps();
    deps.signJwt = signJwt;

    const token = await establishSession('user-uuid-1', deps);

    expect(signJwt).toHaveBeenCalledWith(
      { userId: 'user-uuid-1' },
      'test-session-secret-123',
      { expiresIn: '30m' }
    );
    expect(token).toBe('mock-token');
  });

  it('updates last_activity_at to now for the user', async () => {
    const now = new Date('2024-06-15T10:00:00.000Z');
    const deps = makeSessionDeps({ now });

    await establishSession('user-uuid-1', deps);

    expect(deps.usersRepo.updateLastActivity).toHaveBeenCalledWith(
      deps.mockClient,
      'user-uuid-1',
      now
    );
  });

  it('releases the database client after updating last_activity_at', async () => {
    const deps = makeSessionDeps();

    await establishSession('user-uuid-1', deps);

    expect(deps.mockClient.release).toHaveBeenCalled();
  });

  it('releases the database client even if updateLastActivity throws', async () => {
    const deps = makeSessionDeps();
    deps.usersRepo.updateLastActivity = vi.fn().mockRejectedValue(new Error('DB error'));

    await expect(establishSession('user-uuid-1', deps)).rejects.toThrow('DB error');
    expect(deps.mockClient.release).toHaveBeenCalled();
  });

  it('uses the JWT 30-minute expiry as a safety net', async () => {
    const signJwt = vi.fn().mockReturnValue('token');
    const deps = makeSessionDeps();
    deps.signJwt = signJwt;

    await establishSession('user-uuid-1', deps);

    expect(signJwt).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: '30m' }
    );
  });
});

describe('authenticationService.validateSession()', () => {
  describe('valid session (activity within 30 minutes)', () => {
    it('returns { valid: true, userId } when session is active', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const lastActivity = new Date('2024-06-15T09:45:00.000Z'); // 15 minutes ago
      const user = makeUser({ last_activity_at: lastActivity.toISOString() });
      const deps = makeSessionDeps({ user, now });
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      const result = await validateSession('valid-token', now, deps);

      expect(result).toEqual({ valid: true, userId: 'user-uuid-1' });
    });

    it('refreshes last_activity_at to the current time', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const lastActivity = new Date('2024-06-15T09:45:00.000Z');
      const user = makeUser({ last_activity_at: lastActivity.toISOString() });
      const deps = makeSessionDeps({ user, now });
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      await validateSession('valid-token', now, deps);

      expect(deps.usersRepo.updateLastActivity).toHaveBeenCalledWith(
        deps.mockClient,
        'user-uuid-1',
        now
      );
    });

    it('returns valid when last_activity_at is exactly 29 minutes and 59 seconds ago', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      // 29 min 59 sec = 1799000 ms ago
      const lastActivity = new Date(now.getTime() - 29 * 60 * 1000 - 59 * 1000);
      const user = makeUser({ last_activity_at: lastActivity.toISOString() });
      const deps = makeSessionDeps({ user, now });
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      const result = await validateSession('valid-token', now, deps);

      expect(result.valid).toBe(true);
    });

    it('returns valid when last_activity_at is null (first use after session establishment)', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const user = makeUser({ last_activity_at: null });
      const deps = makeSessionDeps({ user, now });
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      const result = await validateSession('valid-token', now, deps);

      expect(result.valid).toBe(true);
    });
  });

  describe('expired session (idle >= 30 minutes)', () => {
    it('returns { valid: false, expired: true } when idle for exactly 30 minutes', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const lastActivity = new Date('2024-06-15T09:30:00.000Z'); // exactly 30 min ago
      const user = makeUser({ last_activity_at: lastActivity.toISOString() });
      const deps = makeSessionDeps({ user, now });
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      const result = await validateSession('valid-token', now, deps);

      expect(result).toEqual({ valid: false, expired: true });
    });

    it('returns { valid: false, expired: true } when idle for more than 30 minutes', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const lastActivity = new Date('2024-06-15T09:00:00.000Z'); // 60 min ago
      const user = makeUser({ last_activity_at: lastActivity.toISOString() });
      const deps = makeSessionDeps({ user, now });
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      const result = await validateSession('valid-token', now, deps);

      expect(result).toEqual({ valid: false, expired: true });
    });

    it('does NOT update last_activity_at when session is expired', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const lastActivity = new Date('2024-06-15T09:25:00.000Z'); // 35 min ago
      const user = makeUser({ last_activity_at: lastActivity.toISOString() });
      const deps = makeSessionDeps({ user, now });
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      await validateSession('valid-token', now, deps);

      expect(deps.usersRepo.updateLastActivity).not.toHaveBeenCalled();
    });
  });

  describe('invalid JWT token', () => {
    it('returns { valid: false, expired: true } when JWT verification fails', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const deps = makeSessionDeps({ now });
      deps.verifyJwt = vi.fn().mockImplementation(() => {
        throw new Error('jwt expired');
      });

      const result = await validateSession('expired-token', now, deps);

      expect(result).toEqual({ valid: false, expired: true });
    });

    it('returns { valid: false, expired: true } when token has invalid signature', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const deps = makeSessionDeps({ now });
      deps.verifyJwt = vi.fn().mockImplementation(() => {
        throw new Error('invalid signature');
      });

      const result = await validateSession('tampered-token', now, deps);

      expect(result).toEqual({ valid: false, expired: true });
    });

    it('returns { valid: false, expired: true } when payload has no userId', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const deps = makeSessionDeps({ now });
      deps.verifyJwt = vi.fn().mockReturnValue({}); // no userId in payload

      const result = await validateSession('bad-payload-token', now, deps);

      expect(result).toEqual({ valid: false, expired: true });
    });
  });

  describe('user not found', () => {
    it('returns { valid: false, expired: true } when user does not exist', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const deps = makeSessionDeps({ now });
      deps.usersRepo.findById = vi.fn().mockResolvedValue(null);
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'deleted-user-id' });

      const result = await validateSession('valid-token', now, deps);

      expect(result).toEqual({ valid: false, expired: true });
    });
  });

  describe('database errors', () => {
    it('returns { valid: false, expired: true } when database is unavailable', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const deps = makeSessionDeps({ now });
      deps.dbPool = { connect: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      const result = await validateSession('valid-token', now, deps);

      expect(result).toEqual({ valid: false, expired: true });
    });

    it('releases the database client even on error', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const deps = makeSessionDeps({ now });
      deps.usersRepo.findById = vi.fn().mockRejectedValue(new Error('query error'));
      deps.verifyJwt = vi.fn().mockReturnValue({ userId: 'user-uuid-1' });

      await validateSession('valid-token', now, deps);

      expect(deps.mockClient.release).toHaveBeenCalled();
    });
  });
});
