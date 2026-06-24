/**
 * Email log repository.
 * Exposes parameterized query functions for the email_delivery_log table.
 */
const { pool } = require('../pool');

/**
 * Insert a row into the email_delivery_log table.
 *
 * @param {{ accountHolder: string, identifier: string, status: 'SENT'|'FAILED', attempts: number }} logEntry
 * @param {{ pool?: import('pg').Pool }} [opts] - Optional pool override for testing.
 * @returns {Promise<object>} The inserted row.
 */
async function create(logEntry, opts) {
  const p = (opts && opts.pool) || pool;
  const { accountHolder, identifier, status, attempts } = logEntry;
  const result = await p.query(
    `INSERT INTO email_delivery_log (account_holder, identifier, status, attempts)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [accountHolder, identifier, status, attempts]
  );
  return result.rows[0];
}

module.exports = {
  create,
};
