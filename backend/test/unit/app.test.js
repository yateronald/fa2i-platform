import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Smoke tests for the app module.
 *
 * Verifies:
 * - createApp exports a working Express app
 * - Routes are properly mounted with expected middleware
 * - Module exports the expected shape (createApp, startServer)
 */

// Mock DB and service modules so createApp doesn't hit real resources
vi.mock('../../src/db/pool.js', () => ({
  pool: {
    connect: vi.fn().mockResolvedValue({ release: vi.fn(), query: vi.fn() }),
    query: vi.fn(),
  },
  withTransaction: vi.fn(),
}));

vi.mock('../../src/db/repositories/usersRepository.js', () => ({
  default: { findById: vi.fn(), findByEmail: vi.fn() },
  findById: vi.fn(),
  findByEmail: vi.fn(),
}));

describe('app module', () => {
  let createApp;
  let startServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    const appModule = await import('../../src/app.js');
    createApp = appModule.createApp;
    startServer = appModule.startServer;
  });

  describe('module exports', () => {
    it('exports createApp as a function', () => {
      expect(typeof createApp).toBe('function');
    });

    it('exports startServer as a function', () => {
      expect(typeof startServer).toBe('function');
    });
  });

  describe('createApp()', () => {
    it('returns an Express app with listen method', () => {
      const app = createApp();
      expect(typeof app.listen).toBe('function');
    });

    it('returns an Express app with use method', () => {
      const app = createApp();
      expect(typeof app.use).toBe('function');
    });

    it('has middleware layers registered (json, cookieParser, routes)', () => {
      const app = createApp();
      const stack = app._router.stack;
      // Should have: query, expressInit, json, cookieParser, and route/router layers
      expect(stack.length).toBeGreaterThan(4);
    });

    it('has cookie-parser middleware registered', () => {
      const app = createApp();
      const stack = app._router.stack;
      const cookieLayer = stack.find((layer) => layer.name === 'cookieParser');
      expect(cookieLayer).toBeDefined();
    });

    it('has JSON body parser middleware registered', () => {
      const app = createApp();
      const stack = app._router.stack;
      const jsonLayer = stack.find((layer) => layer.name === 'jsonParser');
      expect(jsonLayer).toBeDefined();
    });

    it('has route layers mounted (more than just built-in middleware)', () => {
      const app = createApp();
      const stack = app._router.stack;
      // Built-in middleware: query, expressInit = 2
      // Our middleware: jsonParser, cookieParser = 2 (total 4)
      // Routes add more layers
      const routeLayers = stack.filter(
        (layer) => layer.name === 'router' || layer.route
      );
      expect(routeLayers.length).toBeGreaterThan(0);
    });

    it('mounts the auth router at /auth (covering /auth/login)', () => {
      const app = createApp();
      const stack = app._router.stack;
      // The auth router is mounted via app.use('/auth', ...), so it appears as a
      // 'router' layer whose mount regexp matches the /auth/login path.
      const authRouter = stack.find(
        (layer) =>
          layer.name === 'router' &&
          layer.regexp &&
          layer.regexp.test('/auth/login')
      );
      expect(authRouter).toBeDefined();
    });
  });
});
