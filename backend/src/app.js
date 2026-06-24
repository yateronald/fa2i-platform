'use strict';

/**
 * FA2I Voting System — Application entry point.
 *
 * 1. Validates configuration (fail-fast)
 * 2. Bootstraps the Federation Administrator account
 * 3. Sets up Express with JSON + cookie-parser middleware
 * 4. Mounts routes behind requireSession and authorize where appropriate
 * 5. Starts listening on PORT (default 4000) only after config + bootstrap complete
 *
 * Requirements: 1.2, 4.5, 5.1, 7.2, 7.3, 8.6, 10.1, 13.1, 14.2, 16.2, 21.1, 21.2
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { validateConfig } = require('./config/validateConfig');
const { bootstrapAdmin } = require('./lib/bootstrapAdmin');
const createRequireSession = require('./middleware/requireSession');
const authorize = require('./middleware/authorize');

// Route modules
const authRouter = require('./routes/auth');
const associationsRouter = require('./routes/associations');
const electionsRouter = require('./routes/elections');
const ballotsRouter = require('./routes/ballots');
const resultsRouter = require('./routes/results');
const usersRouter = require('./routes/users');
const federationElectionsRouter = require('./routes/federationElections');
const associationUsersRouter = require('./routes/associationUsers');
const membersRouter = require('./routes/members');

/**
 * Create and configure the Express application.
 * Exported for testing (does NOT call listen or validateConfig).
 */
function createApp() {
  const app = express();

  // CORS — allow the frontend origin to make credentialed requests
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true, // allow cookies to be sent cross-origin
  }));

  // Body parsing and cookie parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // Health check — public, lightweight liveness probe for load balancers and
  // container orchestrators. Does not touch the database so it stays green
  // during transient DB blips (liveness, not readiness).
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  // Session middleware instance
  const requireSession = createRequireSession();

  // --- Auth routes ---
  // Public (no session yet): login, logout, and the forgot/reset-password flow.
  // All other /auth routes require a session.
  const PUBLIC_AUTH_PATHS = new Set([
    '/login',
    '/logout',
    '/forgot-password',
    '/reset-password',
  ]);
  app.use(
    '/auth',
    (req, res, next) => {
      if (PUBLIC_AUTH_PATHS.has(req.path)) {
        return next(); // public — skip session check
      }
      return requireSession(req, res, next);
    },
    authRouter
  );

  // Associations — session required; POST requires FEDERATION_ADMINISTRATOR
  app.post('/associations', requireSession, authorize('FEDERATION_ADMINISTRATOR'), associationsRouter);
  app.use('/associations', requireSession, associationsRouter);

  // Users — federation user management; FEDERATION_ADMINISTRATOR only
  app.use('/users', requireSession, authorize('FEDERATION_ADMINISTRATOR'), usersRouter);

  // Association users — an association president manages their own sub-users
  app.use('/association-users', requireSession, associationUsersRouter);

  // Association members — manage an association's member roster (association-only)
  app.use('/members', requireSession, membersRouter);

  // Elections — session required, CRUD
  app.use('/elections', requireSession, electionsRouter);

  // Federation elections — list for association managers / federation roles
  app.use('/federation-elections', requireSession, federationElectionsRouter);

  // Ballots — session required, POST to cast
  app.use('/elections', requireSession, ballotsRouter);

  // Results — session required, GET dashboard
  app.use('/elections', requireSession, resultsRouter);

  return app;
}

/**
 * Start the server after config validation and admin bootstrap.
 * This function is the entry point when running `node src/app.js`.
 */
async function startServer() {
  // 1. Fail-fast config validation
  validateConfig();

  // 2. Bootstrap the Federation Administrator account
  await bootstrapAdmin();

  // 3. Create and configure the Express app
  const app = createApp();

  // 4. Start listening
  const PORT = process.env.PORT || 4000;
  const server = app.listen(PORT, () => {
    console.log(`FA2I backend listening on port ${PORT}`);
  });

  return server;
}

// If this module is run directly (not imported), start the server
if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { createApp, startServer };
