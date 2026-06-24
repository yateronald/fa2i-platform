/**
 * PostgreSQL connection pool (Aiven, SSL).
 * Configured from validated environment variables.
 */
const { Pool } = require('pg');

const sslConfig =
  process.env.PGSSLMODE === 'require'
    ? { rejectUnauthorized: false }
    : false;

/**
 * Parse a positive integer from an environment variable, falling back to a
 * default when unset or invalid.
 * @param {string|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function intFromEnv(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Pool sizing. `max` is the most important knob for handling concurrent users:
// it caps how many simultaneous DB connections this process holds. Keep it
// below the provider's per-database connection limit, and remember that when
// running multiple backend instances the limit is shared across ALL of them
// (e.g. limit 80, 4 instances → PG_POOL_MAX ≈ 18 each).
const PG_POOL_MAX = intFromEnv(process.env.PG_POOL_MAX, 10);
// Close idle clients after this many ms so the pool shrinks under low load and
// stale connections are not held open against the database.
const PG_IDLE_TIMEOUT_MS = intFromEnv(process.env.PG_IDLE_TIMEOUT_MS, 30000);
// Fail fast (instead of hanging) when no connection becomes available in time —
// this surfaces pool exhaustion as a clear error rather than a stuck request.
const PG_CONNECTION_TIMEOUT_MS = intFromEnv(process.env.PG_CONNECTION_TIMEOUT_MS, 10000);

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: sslConfig,
  max: PG_POOL_MAX,
  idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
});

// Prevent an unexpected error on an idle client from crashing the process.
// Without this listener, pg emits the error on the pool as an uncaught
// exception, which would take the whole server down.
pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Run `fn(client)` inside a BEGIN/COMMIT/ROLLBACK transaction.
 * Guarantees the client is released back to the pool regardless of outcome.
 *
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 * @param {{ pool: import('pg').Pool }} [opts] - Optional pool override for testing.
 * @returns {Promise<any>} The value returned by `fn`.
 */
async function withTransaction(fn, opts) {
  const p = (opts && opts.pool) || pool;
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
