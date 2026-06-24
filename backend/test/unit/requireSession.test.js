import { describe, it, expect, vi } from 'vitest';
import createRequireSession, { extractToken } from '../../src/middleware/requireSession.js';

/**
 * Helper: build a fake user record.
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
    last_activity_at: new Date().toISOString(),
    is_active: true,
    ...overrides,
  };
}

/**
 * Helper: build a fake Express req object.
 */
function makeReq({ cookies = {}, headers = {}, path = '/some/route', originalUrl } = {}) {
  return {
    cookies,
    headers,
    path,
    originalUrl: originalUrl || path,
  };
}

/**
 * Helper: build a fake Express res object with spy methods.
 */
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
  };
  return res;
}

/**
 * Helper: build dependency overrides for the middleware.
 */
function makeDeps({
  sessionValid = true,
  sessionUserId = 'user-uuid-1',
  user = makeUser(),
  findByIdThrows = false,
  poolConnectThrows = false,
} = {}) {
  const mockClient = { release: vi.fn() };

  const authService = {
    validateSession: vi.fn().mockResolvedValue(
      sessionValid
        ? { valid: true, userId: sessionUserId }
        : { valid: false, expired: true }
    ),
  };

  const usersRepo = {
    findById: findByIdThrows
      ? vi.fn().mockRejectedValue(new Error('DB error'))
      : vi.fn().mockResolvedValue(user),
  };

  const dbPool = {
    connect: poolConnectThrows
      ? vi.fn().mockRejectedValue(new Error('pool exhausted'))
      : vi.fn().mockResolvedValue(mockClient),
  };

  const getNow = () => new Date('2024-06-15T10:00:00.000Z');

  return { authService, usersRepo, dbPool, getNow, mockClient };
}

describe('extractToken()', () => {
  it('extracts token from req.cookies.session', () => {
    const req = makeReq({ cookies: { session: 'abc123' } });
    expect(extractToken(req)).toBe('abc123');
  });

  it('extracts token from Authorization: Bearer header', () => {
    const req = makeReq({ headers: { authorization: 'Bearer xyz789' } });
    expect(extractToken(req)).toBe('xyz789');
  });

  it('trims whitespace from Bearer token', () => {
    const req = makeReq({ headers: { authorization: 'Bearer   tok  ' } });
    expect(extractToken(req)).toBe('tok');
  });

  it('prefers cookie over Authorization header', () => {
    const req = makeReq({
      cookies: { session: 'from-cookie' },
      headers: { authorization: 'Bearer from-header' },
    });
    expect(extractToken(req)).toBe('from-cookie');
  });

  it('returns null when no token is present', () => {
    const req = makeReq({});
    expect(extractToken(req)).toBeNull();
  });

  it('returns null for non-Bearer auth header', () => {
    const req = makeReq({ headers: { authorization: 'Basic abc123' } });
    expect(extractToken(req)).toBeNull();
  });
});

describe('requireSession middleware', () => {
  describe('no token present', () => {
    it('responds 401 with mustReauthenticate when no cookie or header', async () => {
      const deps = makeDeps();
      const middleware = createRequireSession(deps);
      const req = makeReq({});
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: 'Session expired or invalid',
        mustReauthenticate: true,
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('invalid session', () => {
    it('responds 401 when validateSession returns { valid: false }', async () => {
      const deps = makeDeps({ sessionValid: false });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'expired-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: 'Session expired or invalid',
        mustReauthenticate: true,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes the token and current time to validateSession', async () => {
      const deps = makeDeps({ sessionValid: false });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'my-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(deps.authService.validateSession).toHaveBeenCalledWith(
        'my-token',
        new Date('2024-06-15T10:00:00.000Z')
      );
    });
  });

  describe('user lookup failure', () => {
    it('responds 401 when pool.connect throws', async () => {
      const deps = makeDeps({ sessionValid: true, poolConnectThrows: true });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'valid-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body.mustReauthenticate).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 401 when findById throws', async () => {
      const deps = makeDeps({ sessionValid: true, findByIdThrows: true });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'valid-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body.mustReauthenticate).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 401 when user is not found (null)', async () => {
      const deps = makeDeps({ sessionValid: true, user: null });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'valid-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body.mustReauthenticate).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('releases the database client even on failure', async () => {
      const deps = makeDeps({ sessionValid: true, user: null });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'valid-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(deps.mockClient.release).toHaveBeenCalled();
    });
  });

  describe('valid session, user found, non-temporary password', () => {
    it('attaches user to req.user and calls next()', async () => {
      const user = makeUser({ is_temporary_password: false });
      const deps = makeDeps({ sessionValid: true, user });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'valid-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(req.user).toEqual(user);
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it('looks up user by the userId from validateSession', async () => {
      const user = makeUser();
      const deps = makeDeps({ sessionValid: true, sessionUserId: 'custom-id', user });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'valid-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(deps.usersRepo.findById).toHaveBeenCalledWith(expect.anything(), 'custom-id');
    });
  });

  describe('forced password rotation gating (Req 4.1, 3.7)', () => {
    it('responds 403 with mustRotatePassword when password is temporary and route is not password-change', async () => {
      const user = makeUser({ is_temporary_password: true });
      const deps = makeDeps({ sessionValid: true, user });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'valid-token' }, path: '/elections' });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: 'Password change required',
        mustRotatePassword: true,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('allows the password-change route through when password is temporary', async () => {
      const user = makeUser({ is_temporary_password: true });
      const deps = makeDeps({ sessionValid: true, user });
      const middleware = createRequireSession(deps);
      const req = makeReq({
        cookies: { session: 'valid-token' },
        path: '/auth/change-password',
        originalUrl: '/auth/change-password',
      });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(user);
      expect(res.statusCode).toBeNull();
    });

    it('allows the password-change route with query params', async () => {
      const user = makeUser({ is_temporary_password: true });
      const deps = makeDeps({ sessionValid: true, user });
      const middleware = createRequireSession(deps);
      const req = makeReq({
        cookies: { session: 'valid-token' },
        path: '/auth/change-password',
        originalUrl: '/auth/change-password?redirect=/home',
      });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it('blocks other routes even if they contain "change-password" as a substring', async () => {
      const user = makeUser({ is_temporary_password: true });
      const deps = makeDeps({ sessionValid: true, user });
      const middleware = createRequireSession(deps);
      const req = makeReq({
        cookies: { session: 'valid-token' },
        path: '/not/auth/change-password',
        originalUrl: '/not/auth/change-password',
      });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.mustRotatePassword).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('does not block non-temporary-password users on any route', async () => {
      const user = makeUser({ is_temporary_password: false });
      const deps = makeDeps({ sessionValid: true, user });
      const middleware = createRequireSession(deps);
      const req = makeReq({ cookies: { session: 'valid-token' }, path: '/elections' });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });
  });

  describe('token extraction via Authorization header', () => {
    it('works with Bearer token in header when no cookie present', async () => {
      const user = makeUser({ is_temporary_password: false });
      const deps = makeDeps({ sessionValid: true, user });
      const middleware = createRequireSession(deps);
      const req = makeReq({ headers: { authorization: 'Bearer my-jwt-token' } });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(deps.authService.validateSession).toHaveBeenCalledWith(
        'my-jwt-token',
        expect.any(Date)
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe('custom dependency overrides', () => {
    it('accepts custom passwordChangePaths', async () => {
      const user = makeUser({ is_temporary_password: true });
      const deps = makeDeps({ sessionValid: true, user });
      const middleware = createRequireSession({
        ...deps,
        passwordChangePaths: ['/custom/rotate'],
      });
      const req = makeReq({
        cookies: { session: 'valid-token' },
        path: '/custom/rotate',
        originalUrl: '/custom/rotate',
      });
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
