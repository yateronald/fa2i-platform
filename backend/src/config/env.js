/**
 * Required environment variable schema grouped by concern.
 * Used by the startup validator to fail fast on missing config.
 */
const requiredVariables = {
  PostgreSQL: ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE'],
  Cloudinary: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  Smtp: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'],
  App: ['SESSION_SECRET', 'APP_BASE_URL'],
};

module.exports = { requiredVariables };
