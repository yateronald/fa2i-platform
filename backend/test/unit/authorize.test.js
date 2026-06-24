import { describe, it, expect, vi } from 'vitest';
import authorize from '../../src/middleware/authorize.js';

// --- Helpers ---

function mockReq(user = null, params = {}, body = {}) {
  return { user, params, body };
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockNext() {
  return vi.fn();
}

// --- Tests ---

describe('authorize middleware', () => {
  describe('when no user is attached (req.user is null/undefined)', () => {
    it('responds with 403 and generic error', () => {
      const middleware = authorize('FEDERATION_ADMINISTRATOR');
      const req = mockReq(null);
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(next).not.toHaveBeenCalled();
    });

    it('does not disclose any protected data', () => {
      const middleware = authorize('FEDERATION_ADMINISTRATOR');
      const req = mockReq(undefined);
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(Object.keys(body)).toEqual(['error']);
      expect(body.error).toBe('Access denied');
    });
  });

  describe('string-based role check', () => {
    it('calls next() when user role matches the required role', () => {
      const middleware = authorize('FEDERATION_ADMINISTRATOR');
      const req = mockReq({ id: 'u1', role: 'FEDERATION_ADMINISTRATOR', association_id: null });
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('responds with 403 when user role does not match', () => {
      const middleware = authorize('FEDERATION_ADMINISTRATOR');
      const req = mockReq({ id: 'u1', role: 'VOTER', association_id: 'assoc-1' });
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(next).not.toHaveBeenCalled();
    });

    it('responds with 403 for ASSOCIATION_MANAGER trying a federation route', () => {
      const middleware = authorize('FEDERATION_ADMINISTRATOR');
      const req = mockReq({ id: 'u2', role: 'ASSOCIATION_MANAGER', association_id: 'assoc-1' });
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('object config with role', () => {
    it('calls next() when role matches', () => {
      const middleware = authorize({ role: 'ASSOCIATION_MANAGER' });
      const req = mockReq({ id: 'u3', role: 'ASSOCIATION_MANAGER', association_id: 'assoc-1' });
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('responds 403 when role does not match', () => {
      const middleware = authorize({ role: 'ASSOCIATION_MANAGER' });
      const req = mockReq({ id: 'u3', role: 'VOTER', association_id: 'assoc-1' });
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
    });
  });

  describe('object config with scope: ASSOCIATION', () => {
    it('calls next() when association_id matches the route param', () => {
      const middleware = authorize({ role: 'ASSOCIATION_MANAGER', scope: 'ASSOCIATION' });
      const req = mockReq(
        { id: 'u4', role: 'ASSOCIATION_MANAGER', association_id: 'assoc-1' },
        { associationId: 'assoc-1' }
      );
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('responds 403 when association_id does not match the route param (Req 6.6)', () => {
      const middleware = authorize({ role: 'ASSOCIATION_MANAGER', scope: 'ASSOCIATION' });
      const req = mockReq(
        { id: 'u4', role: 'ASSOCIATION_MANAGER', association_id: 'assoc-1' },
        { associationId: 'assoc-2' }
      );
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 403 when association_id from body does not match', () => {
      const middleware = authorize({ role: 'ASSOCIATION_MANAGER', scope: 'ASSOCIATION' });
      const req = mockReq(
        { id: 'u4', role: 'ASSOCIATION_MANAGER', association_id: 'assoc-1' },
        {},
        { association_id: 'assoc-2' }
      );
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
    });

    it('calls next() when no target association is extractable (no scope mismatch detectable)', () => {
      const middleware = authorize({ role: 'ASSOCIATION_MANAGER', scope: 'ASSOCIATION' });
      const req = mockReq(
        { id: 'u4', role: 'ASSOCIATION_MANAGER', association_id: 'assoc-1' },
        {},
        {}
      );
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('object config with checkFn (custom authorization)', () => {
    it('calls next() when checkFn returns true', () => {
      const checkFn = (identity) => identity.role === 'VOTER';
      const middleware = authorize({ checkFn });
      const req = mockReq({ id: 'u5', role: 'VOTER', association_id: 'assoc-1' });
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('responds 403 when checkFn returns false', () => {
      const checkFn = (identity) => identity.role === 'FEDERATION_ADMINISTRATOR';
      const middleware = authorize({ checkFn });
      const req = mockReq({ id: 'u5', role: 'VOTER', association_id: 'assoc-1' });
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes both identity and req to checkFn', () => {
      const checkFn = vi.fn().mockReturnValue(true);
      const middleware = authorize({ checkFn });
      const user = { id: 'u6', role: 'VOTER', association_id: 'assoc-1' };
      const req = mockReq(user);
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(checkFn).toHaveBeenCalledWith(user, req);
    });
  });

  describe('uniform 403 response (Req 19.2, 19.3)', () => {
    it('never reveals the reason for denial', () => {
      const scenarios = [
        // Wrong role
        { config: 'FEDERATION_ADMINISTRATOR', user: { id: 'u', role: 'VOTER', association_id: null } },
        // Cross-association
        {
          config: { role: 'ASSOCIATION_MANAGER', scope: 'ASSOCIATION' },
          user: { id: 'u', role: 'ASSOCIATION_MANAGER', association_id: 'a1' },
          params: { associationId: 'a2' },
        },
        // Custom denial
        { config: { checkFn: () => false }, user: { id: 'u', role: 'VOTER', association_id: null } },
      ];

      for (const { config, user, params } of scenarios) {
        const middleware = authorize(config);
        const req = mockReq(user, params || {});
        const res = mockRes();
        const next = mockNext();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        const body = res.json.mock.calls[0][0];
        expect(body).toEqual({ error: 'Access denied' });
        // Ensure no extra fields that could leak info
        expect(Object.keys(body)).toHaveLength(1);
      }
    });
  });

  describe('federation admin cannot manage association elections (Req 1.5, 19.2, 19.3)', () => {
    it('federation admin is denied by a checkFn that wraps canManageAssociationElection', () => {
      const { canManageAssociationElection } = require('../../src/services/accessControlService.js');
      const election = { id: 'elec-1', scope: 'ASSOCIATION', association_id: 'assoc-1' };

      const middleware = authorize({
        checkFn: (identity) => canManageAssociationElection(identity, election),
      });

      const req = mockReq({ id: 'fa-1', role: 'FEDERATION_ADMINISTRATOR', association_id: null });
      const res = mockRes();
      const next = mockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
