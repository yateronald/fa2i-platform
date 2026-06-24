/**
 * Startup configuration validator.
 *
 * Reads required environment variables, collects every variable that is
 * absent, empty, or whitespace-only, and if the collected list is non-empty
 * prints each offending variable name and exits with a non-zero code
 * without serving any request.
 */
const { requiredVariables } = require('./env');

/**
 * Pure validation function — testable without side-effects.
 *
 * Checks process.env (or a supplied env object) for every variable declared
 * in the required-variable schema. A variable is considered invalid when it
 * is absent, empty, or consists only of whitespace characters.
 *
 * @param {Record<string, string|undefined>} [env=process.env] - The environment object to validate against.
 * @returns {{ valid: boolean, missing: string[] }} Result with a flag and the list of offending variable names.
 */
function validate(env = process.env) {
  const missing = [];

  for (const [, vars] of Object.entries(requiredVariables)) {
    for (const name of vars) {
      const value = env[name];
      if (value === undefined || value === null || value.trim() === '') {
        missing.push(name);
      }
    }
  }

  return { valid: missing.length === 0, missing };
}

/**
 * Startup entrypoint — validates config and exits non-zero on failure.
 *
 * Intended to be called once before the HTTP server binds a port.
 * Prints every offending variable name so operators can fix all issues
 * in a single pass rather than discovering them one at a time.
 */
function validateConfig() {
  const { valid, missing } = validate();

  if (!valid) {
    console.error('Missing or empty required environment variables:');
    for (const name of missing) {
      console.error(`  - ${name}`);
    }
    process.exit(1);
  }
}

module.exports = { validate, validateConfig };
