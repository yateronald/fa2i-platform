/**
 * PM2 process configuration for the FA2I backend.
 *
 * Runs the API in CLUSTER mode so a single host uses all available CPU cores
 * (Node is single-threaded, so one bare `node` process only uses one core).
 * This is safe here because the app is horizontally scalable by design:
 *   - Authentication is stateless (JWT in a cookie) — no sticky sessions needed.
 *   - The only in-process state is the short-TTL results cache, which each
 *     worker keeps independently and which self-heals within seconds.
 *
 * IMPORTANT — database connections: each cluster worker opens its own pool of
 * up to PG_POOL_MAX connections. Total connections = instances × PG_POOL_MAX,
 * and that total must stay under your database provider's limit. Tune
 * PG_POOL_MAX accordingly (e.g. limit 80, 4 instances → PG_POOL_MAX ≈ 18).
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 reload ecosystem.config.js   # zero-downtime rolling restart
 *   pm2 logs fa2i-backend
 */
module.exports = {
  apps: [
    {
      name: 'fa2i-backend',
      script: 'src/app.js',
      // Load .env the same way `npm start` does.
      node_args: '--env-file=.env',
      // 'max' = one worker per CPU core. Set an explicit number to cap how many
      // workers (and thus how many connection pools) are created.
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      // Restart policy
      autorestart: true,
      max_restarts: 10,
      // Guard against memory leaks by recycling a worker that grows too large.
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
