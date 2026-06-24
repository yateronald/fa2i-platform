'use strict';

const { pool } = require('../db/pool');

/**
 * Store or update the start and end schedule for an election.
 * Stores absolute instants (timestamptz) and rejects invalid/missing values
 * or end <= start, leaving any prior schedule unchanged on failure.
 *
 * @param {string} electionId - UUID of the election.
 * @param {string|Date} start - Start instant (ISO string or Date).
 * @param {string|Date} end - End instant (ISO string or Date).
 * @param {{ pool?: import('pg').Pool }} [opts] - Optional pool override for testing.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function storeSchedule(electionId, start, end, opts) {
  // Validate presence
  if (start == null || end == null) {
    return { success: false, error: 'A valid start time and end time are required' };
  }

  // Parse and validate start
  const startDate = new Date(start);
  if (isNaN(startDate.getTime())) {
    return { success: false, error: 'A valid start time and end time are required' };
  }

  // Parse and validate end
  const endDate = new Date(end);
  if (isNaN(endDate.getTime())) {
    return { success: false, error: 'A valid start time and end time are required' };
  }

  // Validate end > start
  if (endDate.getTime() <= startDate.getTime()) {
    return { success: false, error: 'The end time must be later than the start time' };
  }

  // Persist — use parameterized query
  const p = (opts && opts.pool) || pool;
  await p.query(
    'UPDATE elections SET start_at = $1, end_at = $2 WHERE id = $3',
    [startDate.toISOString(), endDate.toISOString(), electionId]
  );

  return { success: true };
}

/**
 * Compute the lifecycle state of an election purely from stored instants.
 * Returns 'OPEN' if start_at <= now < end_at, otherwise 'CLOSED'.
 * This is a pure function — no DB access.
 *
 * @param {{ start_at: Date|string, end_at: Date|string }} election - Election with schedule.
 * @param {Date|string} now - The current instant.
 * @returns {'OPEN'|'CLOSED'}
 */
function computeState(election, now) {
  const startMs = new Date(election.start_at).getTime();
  const endMs = new Date(election.end_at).getTime();
  const nowMs = new Date(now).getTime();

  if (nowMs >= startMs && nowMs < endMs) {
    return 'OPEN';
  }
  return 'CLOSED';
}

/**
 * Compute the lifecycle state of a position for the DRAFT -> PUBLISH workflow.
 * A position that has not been published is always 'DRAFT'. Once published it
 * follows its own voting window: 'PENDING' before start, 'OPEN' while the window
 * is active, and 'CLOSED' afterwards. This is a pure function — no DB access.
 *
 * @param {{ published?: boolean, start_at?: Date|string, end_at?: Date|string }} position
 * @param {Date|string} now - The current instant.
 * @returns {'DRAFT'|'PENDING'|'OPEN'|'CLOSED'}
 */
function computePositionState(position, now) {
  if (!position || !position.published) {
    return 'DRAFT';
  }

  const startMs = new Date(position.start_at).getTime();
  const endMs = new Date(position.end_at).getTime();
  const nowMs = new Date(now).getTime();

  if (nowMs < startMs) {
    return 'PENDING';
  }
  if (nowMs >= startMs && nowMs < endMs) {
    return 'OPEN';
  }
  return 'CLOSED';
}

/**
 * Convert an absolute instant to a display string in the given timezone.
 * Falls back to UTC if detectedZone is falsy or invalid.
 * Uses Intl.DateTimeFormat with locale 'fr-FR' to match the platform language.
 *
 * @param {Date|string} instant - The absolute instant to display.
 * @param {string|null|undefined} detectedZone - IANA timezone identifier (e.g. 'Asia/Kolkata').
 * @returns {{ text: string, zoneLabel: string }}
 */
function displayTime(instant, detectedZone) {
  const date = new Date(instant);
  let zone = 'UTC';

  if (detectedZone) {
    // Validate the timezone by attempting to use it
    try {
      Intl.DateTimeFormat('fr-FR', { timeZone: detectedZone }).format(date);
      zone = detectedZone;
    } catch {
      // Invalid timezone — fall back to UTC
      zone = 'UTC';
    }
  }

  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const text = formatter.format(date);

  return { text, zoneLabel: zone };
}

module.exports = {
  storeSchedule,
  computeState,
  computePositionState,
  displayTime,
};
