'use strict';

/**
 * Production entry point.
 *
 * Unlike `npm start` (which uses `node --env-file=.env src/app.js`), this file
 * loads the .env itself, so it can be launched directly by a process manager
 * such as PM2 without needing the --env-file flag:
 *
 *     pm2 start server.js --name fa2i-backend
 *
 * If the platform injects environment variables another way (no .env file on
 * disk), the missing-file case is ignored and the app relies on those.
 */

const path = require('path');

// Load environment variables from the backend's .env (Node >= 20.12 / 21.7).
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(path.join(__dirname, '.env'));
  }
} catch (err) {
  // .env is optional when env vars are provided by the host/orchestrator.
  console.warn('[server] No .env loaded (' + err.message + '). Relying on process environment.');
}

const { startServer } = require('./src/app');

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
