import { describe, it, expect, vi } from 'vitest';
import { computeState, computePositionState, displayTime, storeSchedule } from '../../src/services/schedulingService.js';

describe('computeState()', () => {
  it('returns OPEN when now is exactly at start_at', () => {
    const election = {
      start_at: '2025-06-01T10:00:00Z',
      end_at: '2025-06-01T18:00:00Z',
    };
    const now = '2025-06-01T10:00:00Z';
    expect(computeState(election, now)).toBe('OPEN');
  });

  it('returns OPEN when now is between start_at and end_at', () => {
    const election = {
      start_at: '2025-06-01T10:00:00Z',
      end_at: '2025-06-01T18:00:00Z',
    };
    const now = '2025-06-01T14:00:00Z';
    expect(computeState(election, now)).toBe('OPEN');
  });

  it('returns CLOSED when now is before start_at', () => {
    const election = {
      start_at: '2025-06-01T10:00:00Z',
      end_at: '2025-06-01T18:00:00Z',
    };
    const now = '2025-06-01T09:59:59Z';
    expect(computeState(election, now)).toBe('CLOSED');
  });

  it('returns CLOSED when now is exactly at end_at', () => {
    const election = {
      start_at: '2025-06-01T10:00:00Z',
      end_at: '2025-06-01T18:00:00Z',
    };
    const now = '2025-06-01T18:00:00Z';
    expect(computeState(election, now)).toBe('CLOSED');
  });

  it('returns CLOSED when now is after end_at', () => {
    const election = {
      start_at: '2025-06-01T10:00:00Z',
      end_at: '2025-06-01T18:00:00Z',
    };
    const now = '2025-06-02T00:00:00Z';
    expect(computeState(election, now)).toBe('CLOSED');
  });

  it('works with Date objects', () => {
    const election = {
      start_at: new Date('2025-06-01T10:00:00Z'),
      end_at: new Date('2025-06-01T18:00:00Z'),
    };
    const now = new Date('2025-06-01T12:00:00Z');
    expect(computeState(election, now)).toBe('OPEN');
  });

  it('is independent of timezone offset in ISO strings', () => {
    // These represent the same instants
    const election = {
      start_at: '2025-06-01T10:00:00+05:30', // 04:30 UTC
      end_at: '2025-06-01T18:00:00+05:30',   // 12:30 UTC
    };
    const now = '2025-06-01T06:00:00Z'; // between 04:30 and 12:30 UTC
    expect(computeState(election, now)).toBe('OPEN');
  });
});

describe('computePositionState()', () => {
  const start = '2025-06-01T10:00:00Z';
  const end = '2025-06-01T18:00:00Z';

  it('returns DRAFT when the position is not published (published false)', () => {
    const position = { published: false, start_at: null, end_at: null };
    expect(computePositionState(position, '2025-06-01T14:00:00Z')).toBe('DRAFT');
  });

  it('returns DRAFT when published is undefined', () => {
    const position = { start_at: start, end_at: end };
    expect(computePositionState(position, '2025-06-01T14:00:00Z')).toBe('DRAFT');
  });

  it('returns PENDING when published and now is before start_at', () => {
    const position = { published: true, start_at: start, end_at: end };
    expect(computePositionState(position, '2025-06-01T09:00:00Z')).toBe('PENDING');
  });

  it('returns OPEN when published and now is at start_at', () => {
    const position = { published: true, start_at: start, end_at: end };
    expect(computePositionState(position, start)).toBe('OPEN');
  });

  it('returns OPEN when published and now is between start_at and end_at', () => {
    const position = { published: true, start_at: start, end_at: end };
    expect(computePositionState(position, '2025-06-01T14:00:00Z')).toBe('OPEN');
  });

  it('returns CLOSED when published and now is at end_at', () => {
    const position = { published: true, start_at: start, end_at: end };
    expect(computePositionState(position, end)).toBe('CLOSED');
  });

  it('returns CLOSED when published and now is after end_at', () => {
    const position = { published: true, start_at: start, end_at: end };
    expect(computePositionState(position, '2025-06-02T00:00:00Z')).toBe('CLOSED');
  });
});

describe('displayTime()', () => {
  it('converts an instant to the given timezone and returns the zone label', () => {
    const instant = '2025-06-01T10:00:00Z';
    const result = displayTime(instant, 'Asia/Kolkata');
    expect(result.zoneLabel).toBe('Asia/Kolkata');
    // Asia/Kolkata is UTC+5:30, so 10:00 UTC = 15:30 IST
    expect(result.text).toContain('15');
    expect(result.text).toContain('30');
  });

  it('falls back to UTC when detectedZone is null', () => {
    const instant = '2025-06-01T10:00:00Z';
    const result = displayTime(instant, null);
    expect(result.zoneLabel).toBe('UTC');
    expect(result.text).toContain('10');
    expect(result.text).toContain('00');
  });

  it('falls back to UTC when detectedZone is undefined', () => {
    const instant = '2025-06-01T10:00:00Z';
    const result = displayTime(instant, undefined);
    expect(result.zoneLabel).toBe('UTC');
  });

  it('falls back to UTC when detectedZone is empty string', () => {
    const instant = '2025-06-01T10:00:00Z';
    const result = displayTime(instant, '');
    expect(result.zoneLabel).toBe('UTC');
  });

  it('falls back to UTC when detectedZone is invalid', () => {
    const instant = '2025-06-01T10:00:00Z';
    const result = displayTime(instant, 'Not/A_Real_Zone');
    expect(result.zoneLabel).toBe('UTC');
  });

  it('returns a formatted string (fr-FR locale)', () => {
    const instant = '2025-12-25T14:30:00Z';
    const result = displayTime(instant, 'Europe/Paris');
    expect(result.zoneLabel).toBe('Europe/Paris');
    // Europe/Paris is UTC+1 in winter, so 14:30 UTC = 15:30 CET
    expect(result.text).toContain('15');
    expect(result.text).toContain('30');
    expect(result.text).toContain('25');
  });

  it('works with Date objects as instant', () => {
    const instant = new Date('2025-06-01T08:00:00Z');
    const result = displayTime(instant, 'America/New_York');
    expect(result.zoneLabel).toBe('America/New_York');
    // America/New_York is UTC-4 in summer (EDT), so 08:00 UTC = 04:00 EDT
    expect(result.text).toContain('04');
  });
});

describe('storeSchedule()', () => {
  it('rejects when start is null', async () => {
    const result = await storeSchedule('election-1', null, '2025-06-01T18:00:00Z');
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid start time and end time are required');
  });

  it('rejects when end is null', async () => {
    const result = await storeSchedule('election-1', '2025-06-01T10:00:00Z', null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid start time and end time are required');
  });

  it('rejects when start is undefined', async () => {
    const result = await storeSchedule('election-1', undefined, '2025-06-01T18:00:00Z');
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid start time and end time are required');
  });

  it('rejects when start is not a valid date-time', async () => {
    const result = await storeSchedule('election-1', 'not-a-date', '2025-06-01T18:00:00Z');
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid start time and end time are required');
  });

  it('rejects when end is not a valid date-time', async () => {
    const result = await storeSchedule('election-1', '2025-06-01T10:00:00Z', 'garbage');
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid start time and end time are required');
  });

  it('rejects when end equals start', async () => {
    const result = await storeSchedule('election-1', '2025-06-01T10:00:00Z', '2025-06-01T10:00:00Z');
    expect(result.success).toBe(false);
    expect(result.error).toContain('end time must be later than the start time');
  });

  it('rejects when end is earlier than start', async () => {
    const result = await storeSchedule('election-1', '2025-06-01T18:00:00Z', '2025-06-01T10:00:00Z');
    expect(result.success).toBe(false);
    expect(result.error).toContain('end time must be later than the start time');
  });

  it('succeeds and updates the database when values are valid', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const mockPool = { query: mockQuery };

    const result = await storeSchedule(
      'election-123',
      '2025-06-01T10:00:00Z',
      '2025-06-01T18:00:00Z',
      { pool: mockPool }
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE elections SET start_at = $1, end_at = $2 WHERE id = $3',
      [expect.any(String), expect.any(String), 'election-123']
    );
  });

  it('passes parsed ISO strings to the database query', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const mockPool = { query: mockQuery };

    await storeSchedule(
      'el-1',
      '2025-06-01T10:00:00+05:30',
      '2025-06-01T18:00:00+05:30',
      { pool: mockPool }
    );

    const [, params] = mockQuery.mock.calls[0];
    // The stored values should be valid ISO strings representing the same instant
    const storedStart = new Date(params[0]);
    const storedEnd = new Date(params[1]);
    expect(storedStart.toISOString()).toBe(new Date('2025-06-01T10:00:00+05:30').toISOString());
    expect(storedEnd.toISOString()).toBe(new Date('2025-06-01T18:00:00+05:30').toISOString());
  });
});
