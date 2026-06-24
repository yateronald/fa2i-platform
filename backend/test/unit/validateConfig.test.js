import { describe, it, expect } from 'vitest';
import { validate } from '../../src/config/validateConfig.js';
import { requiredVariables } from '../../src/config/env.js';

// Flatten all required variable names for test helpers
const allVarNames = Object.values(requiredVariables).flat();

/**
 * Build a complete valid env object where every required variable has a value.
 */
function buildValidEnv() {
  const env = {};
  for (const name of allVarNames) {
    env[name] = 'valid-value';
  }
  return env;
}

describe('validate()', () => {
  it('returns valid:true and empty missing when all variables are set', () => {
    const env = buildValidEnv();
    const result = validate(env);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports absent variables as missing', () => {
    const env = buildValidEnv();
    delete env.PGHOST;
    delete env.SESSION_SECRET;
    const result = validate(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('PGHOST');
    expect(result.missing).toContain('SESSION_SECRET');
  });

  it('reports empty-string variables as missing', () => {
    const env = buildValidEnv();
    env.CLOUDINARY_API_KEY = '';
    const result = validate(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('CLOUDINARY_API_KEY');
  });

  it('reports whitespace-only variables as missing', () => {
    const env = buildValidEnv();
    env.SMTP_USER = '   ';
    env.APP_BASE_URL = '\t\n';
    const result = validate(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('SMTP_USER');
    expect(result.missing).toContain('APP_BASE_URL');
  });

  it('collects ALL offending variables, not just the first', () => {
    // Pass a completely empty env to get every variable reported
    const result = validate({});
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(allVarNames.length);
    for (const name of allVarNames) {
      expect(result.missing).toContain(name);
    }
  });

  it('returns valid:true when variables have non-whitespace values', () => {
    const env = buildValidEnv();
    env.PGPORT = '5432';
    env.SESSION_SECRET = 'a-very-secret-key';
    const result = validate(env);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
