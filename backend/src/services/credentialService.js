'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?/~`';
const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;

const PASSWORD_LENGTH = 16; // fixed length within the 12–128 range

/**
 * Pick a random character from the given character set using crypto.randomInt.
 * @param {string} charset
 * @returns {string}
 */
function randomCharFrom(charset) {
  const index = crypto.randomInt(0, charset.length);
  return charset[index];
}

/**
 * Fisher-Yates shuffle using crypto.randomInt for uniform distribution.
 * @param {string[]} arr - array of characters to shuffle in place
 * @returns {string[]}
 */
function secureShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate a temporary password of 16 characters guaranteed to contain
 * at least one uppercase letter, one lowercase letter, one digit, and one symbol.
 * Uses crypto.randomInt for secure randomness.
 *
 * @returns {string} A random password meeting the composition rule.
 */
function generateTemporaryPassword() {
  const chars = [];

  // Guarantee at least one of each required category
  chars.push(randomCharFrom(UPPERCASE));
  chars.push(randomCharFrom(LOWERCASE));
  chars.push(randomCharFrom(DIGITS));
  chars.push(randomCharFrom(SYMBOLS));

  // Fill the remaining characters from the full set
  for (let i = chars.length; i < PASSWORD_LENGTH; i++) {
    chars.push(randomCharFrom(ALL_CHARS));
  }

  // Shuffle so guaranteed characters aren't always in the first positions
  secureShuffle(chars);

  return chars.join('');
}

const SALT_ROUNDS = 10;

/**
 * Hash a plaintext password using bcrypt with a per-account salt.
 * Never stores or logs the plaintext.
 *
 * @param {string} plaintext - The password to hash.
 * @returns {Promise<string>} The bcrypt hash string (includes embedded salt).
 */
async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 * Never stores or logs the plaintext.
 *
 * @param {string} plaintext - The password to verify.
 * @param {string} hash - The stored bcrypt hash.
 * @returns {Promise<boolean>} True if the password matches the hash.
 */
async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000; // 259200000 ms = 72 hours

/**
 * Determine whether a temporary password has expired.
 * Returns true when more than 72 hours have elapsed between generatedAt and now.
 *
 * @param {Date|string} generatedAt - The instant the temporary password was created (Date or ISO string).
 * @param {Date|string} now - The current instant (Date or ISO string).
 * @returns {boolean} True if the temporary password is expired (more than 72h elapsed).
 */
function isTemporaryExpired(generatedAt, now) {
  const generatedMs = new Date(generatedAt).getTime();
  const nowMs = new Date(now).getTime();
  return (nowMs - generatedMs) > TEMP_PASSWORD_TTL_MS;
}

/**
 * Check whether a password meets the composition rule:
 * - Length between 12 and 128 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one symbol (non-alphanumeric)
 *
 * @param {string} password - The password to validate.
 * @returns {{ valid: boolean, error?: string }}
 */
function meetsCompositionRule(password) {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }
  if (password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must be at most 128 characters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one digit' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one symbol' };
  }
  return { valid: true };
}

/**
 * Rotate a user's password from temporary to permanent.
 * Succeeds only when the new password meets the composition rule and differs
 * from the current temporary password; otherwise retains the temporary password,
 * its status, and returns the unmet rule.
 *
 * @param {string} userId - The user's ID.
 * @param {string} newPassword - The proposed new password.
 * @param {{ usersRepository: object, pool: object }} deps - Dependencies injected for testability.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function rotatePassword(userId, newPassword, deps) {
  const { usersRepository, pool } = deps;

  // Step 1: Validate composition rule
  const compositionResult = meetsCompositionRule(newPassword);
  if (!compositionResult.valid) {
    return { success: false, error: compositionResult.error };
  }

  // Step 2: Look up the user and verify new password differs from current
  const client = await pool.connect();
  try {
    const user = await usersRepository.findById(client, userId);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const isSameAsTemp = await verifyPassword(newPassword, user.password_hash);
    if (isSameAsTemp) {
      return { success: false, error: 'New password must be different from the temporary password' };
    }

    // Step 3: Hash new password and update the user
    const newHash = await hashPassword(newPassword);
    await usersRepository.updatePassword(client, userId, newHash);

    return { success: true };
  } finally {
    client.release();
  }
}

module.exports = {
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
  isTemporaryExpired,
  meetsCompositionRule,
  rotatePassword,
};
