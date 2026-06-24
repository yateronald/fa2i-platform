'use strict';

const { pool } = require('../db/pool');
const { computeState } = require('../services/schedulingService');

/**
 * Lifecycle worker that runs periodically to detect election state transitions.
 *
 * The system derives election state on-the-fly from stored instants (start_at, end_at).
 * This worker exists to trigger time-bound side effects:
 * - Log transitions for observability
 * - Future: send notifications when elections open/close
 *
 * Requirements: 12.2, 12.3 — transitions materialize within 60 seconds.
 */

const INTERVAL_MS = 60_000; // 60 seconds

let intervalId = null;

/**
 * Check all elections that might have just transitioned state.
 * Queries elections whose start_at or end_at is within the recent window,
 * computes the current state, and logs transitions for observability.
 *
 * @param {{ pool?: import('pg').Pool }} [opts] - Optional pool override for testing.
 * @returns {Promise<{ checked: number, transitions: Array<{ electionId: string, state: string }> }>}
 */
async function checkTransitions(opts) {
  const db = (opts && opts.pool) || pool;
  const now = new Date();

  // Find elections whose start_at or end_at is within the last 2 minutes
  // (slightly wider than the 60s interval to avoid missing edges)
  const windowStart = new Date(now.getTime() - 2 * 60_000);

  const { rows } = await db.query(
    `SELECT id, name, scope, association_id, start_at, end_at
     FROM elections
     WHERE start_at <= $1 AND end_at >= $2`,
    [now.toISOString(), windowStart.toISOString()]
  );

  const transitions = [];

  for (const election of rows) {
    const state = computeState(election, now);
    transitions.push({ electionId: election.id, name: election.name, state });
  }

  if (transitions.length > 0) {
    console.log(
      `[lifecycleWorker] Checked ${rows.length} election(s) at ${now.toISOString()}:`,
      transitions.map((t) => `${t.name} (${t.electionId}) → ${t.state}`).join(', ')
    );
  }

  return { checked: rows.length, transitions };
}

/**
 * Start the lifecycle worker on a 60-second interval.
 * Safe to call multiple times — subsequent calls are no-ops if already running.
 */
function startLifecycleWorker() {
  if (intervalId !== null) {
    return; // already running
  }

  console.log('[lifecycleWorker] Starting lifecycle worker (interval: 60s)');

  // Run immediately on start, then every 60 seconds
  checkTransitions().catch((err) => {
    console.error('[lifecycleWorker] Error during initial check:', err.message);
  });

  intervalId = setInterval(() => {
    checkTransitions().catch((err) => {
      console.error('[lifecycleWorker] Error during scheduled check:', err.message);
    });
  }, INTERVAL_MS);
}

/**
 * Stop the lifecycle worker for graceful shutdown.
 */
function stopLifecycleWorker() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[lifecycleWorker] Stopped lifecycle worker');
  }
}

module.exports = {
  checkTransitions,
  startLifecycleWorker,
  stopLifecycleWorker,
  INTERVAL_MS,
};
