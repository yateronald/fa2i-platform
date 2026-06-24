import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the pool module before importing the worker
vi.mock('../../src/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { checkTransitions, startLifecycleWorker, stopLifecycleWorker, INTERVAL_MS } from '../../src/workers/lifecycleWorker.js';
import { pool } from '../../src/db/pool.js';

describe('lifecycleWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopLifecycleWorker();
  });

  describe('checkTransitions', () => {
    it('returns empty transitions when no elections match', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await checkTransitions({ pool });

      expect(result.checked).toBe(0);
      expect(result.transitions).toEqual([]);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('computes state for elections whose schedule overlaps now', async () => {
      const now = new Date();
      const startAt = new Date(now.getTime() - 60_000); // started 1 min ago
      const endAt = new Date(now.getTime() + 3600_000); // ends in 1 hour

      pool.query.mockResolvedValue({
        rows: [
          {
            id: 'elec-1',
            name: 'Test Election',
            scope: 'FEDERATION',
            association_id: null,
            start_at: startAt.toISOString(),
            end_at: endAt.toISOString(),
          },
        ],
      });

      const result = await checkTransitions({ pool });

      expect(result.checked).toBe(1);
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0].electionId).toBe('elec-1');
      expect(result.transitions[0].state).toBe('OPEN');
    });

    it('returns CLOSED state for an election that has ended', async () => {
      const now = new Date();
      const startAt = new Date(now.getTime() - 7200_000); // started 2h ago
      const endAt = new Date(now.getTime() - 60_000); // ended 1 min ago

      pool.query.mockResolvedValue({
        rows: [
          {
            id: 'elec-2',
            name: 'Ended Election',
            scope: 'ASSOCIATION',
            association_id: 'assoc-1',
            start_at: startAt.toISOString(),
            end_at: endAt.toISOString(),
          },
        ],
      });

      const result = await checkTransitions({ pool });

      expect(result.checked).toBe(1);
      expect(result.transitions[0].state).toBe('CLOSED');
    });

    it('handles multiple elections in a single check', async () => {
      const now = new Date();

      pool.query.mockResolvedValue({
        rows: [
          {
            id: 'elec-a',
            name: 'Open Election',
            scope: 'FEDERATION',
            association_id: null,
            start_at: new Date(now.getTime() - 60_000).toISOString(),
            end_at: new Date(now.getTime() + 3600_000).toISOString(),
          },
          {
            id: 'elec-b',
            name: 'Closed Election',
            scope: 'ASSOCIATION',
            association_id: 'assoc-1',
            start_at: new Date(now.getTime() - 7200_000).toISOString(),
            end_at: new Date(now.getTime() - 60_000).toISOString(),
          },
        ],
      });

      const result = await checkTransitions({ pool });

      expect(result.checked).toBe(2);
      expect(result.transitions).toHaveLength(2);
      expect(result.transitions[0].state).toBe('OPEN');
      expect(result.transitions[1].state).toBe('CLOSED');
    });

    it('propagates database errors', async () => {
      pool.query.mockRejectedValue(new Error('connection failed'));

      await expect(checkTransitions({ pool })).rejects.toThrow('connection failed');
    });
  });

  describe('INTERVAL_MS', () => {
    it('is set to 60 seconds', () => {
      expect(INTERVAL_MS).toBe(60_000);
    });
  });

  describe('startLifecycleWorker / stopLifecycleWorker', () => {
    it('stopLifecycleWorker clears the interval without error', () => {
      pool.query.mockResolvedValue({ rows: [] });

      startLifecycleWorker();
      stopLifecycleWorker();

      // Calling stop again is a no-op
      expect(() => stopLifecycleWorker()).not.toThrow();
    });

    it('calling startLifecycleWorker when already running is a no-op', () => {
      pool.query.mockResolvedValue({ rows: [] });

      startLifecycleWorker();
      // Second call should not throw and should not create a second interval
      startLifecycleWorker();
      stopLifecycleWorker();
    });

    it('can be stopped and restarted', () => {
      pool.query.mockResolvedValue({ rows: [] });

      startLifecycleWorker();
      stopLifecycleWorker();
      // After stopping, starting again should work without error
      startLifecycleWorker();
      stopLifecycleWorker();
    });
  });
});
