/**
 * Unit tests for src/db/pool.js
 *
 * Tests the withTransaction helper logic using a fake pool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('pool.js - withTransaction', () => {
  let withTransaction;
  let mockClient;
  let fakePool;

  beforeEach(async () => {
    vi.resetModules();

    // Set env vars so pool.js doesn't error on require (it still creates a real Pool
    // that won't be used — we pass our own fakePool to withTransaction).
    process.env.PGHOST = 'localhost';
    process.env.PGPORT = '5432';
    process.env.PGDATABASE = 'testdb';
    process.env.PGUSER = 'user';
    process.env.PGPASSWORD = 'pass';
    process.env.PGSSLMODE = 'disable';

    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    fakePool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const mod = await import('../../src/db/pool.js');
    withTransaction = mod.withTransaction;
  });

  it('runs BEGIN, calls fn with client, then COMMIT on success', async () => {
    const fn = vi.fn(async (client) => {
      await client.query('SELECT 1');
      return 'result';
    });

    const result = await withTransaction(fn, { pool: fakePool });

    expect(result).toBe('result');
    const queryCalls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(queryCalls[0]).toBe('BEGIN');
    expect(queryCalls).toContain('SELECT 1');
    expect(queryCalls).toContain('COMMIT');
    expect(queryCalls).not.toContain('ROLLBACK');
    expect(fn).toHaveBeenCalledWith(mockClient);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('runs ROLLBACK and re-throws on fn error', async () => {
    const error = new Error('Something went wrong');
    const fn = vi.fn(async () => {
      throw error;
    });

    await expect(withTransaction(fn, { pool: fakePool })).rejects.toThrow('Something went wrong');
    const queryCalls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(queryCalls[0]).toBe('BEGIN');
    expect(queryCalls).toContain('ROLLBACK');
    expect(queryCalls).not.toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('always releases the client even if ROLLBACK fails', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fn failed');
    });
    mockClient.query.mockImplementation(async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('ROLLBACK failed');
      return { rows: [] };
    });

    await expect(withTransaction(fn, { pool: fakePool })).rejects.toThrow();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('returns the value from fn on success', async () => {
    const fn = vi.fn(async () => ({ id: 'abc', name: 'test' }));
    const result = await withTransaction(fn, { pool: fakePool });
    expect(result).toEqual({ id: 'abc', name: 'test' });
  });

  it('does not commit when fn throws', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fail');
    });

    await expect(withTransaction(fn, { pool: fakePool })).rejects.toThrow('fail');
    const queryCalls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(queryCalls).not.toContain('COMMIT');
  });
});

describe('pool.js - SSL configuration', () => {
  it('exports pool and withTransaction', async () => {
    vi.resetModules();
    process.env.PGHOST = 'localhost';
    process.env.PGPORT = '5432';
    process.env.PGDATABASE = 'testdb';
    process.env.PGUSER = 'user';
    process.env.PGPASSWORD = 'pass';
    process.env.PGSSLMODE = 'require';

    const mod = await import('../../src/db/pool.js');
    expect(mod.pool).toBeDefined();
    expect(mod.withTransaction).toBeDefined();
    expect(typeof mod.withTransaction).toBe('function');
  });
});
