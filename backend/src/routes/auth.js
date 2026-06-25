'use strict';

/**
 * Auth routes: login and password change.
 *
 * POST /auth/login — authenticate, return token as httpOnly cookie
 * POST /auth/change-password — behind requireSession, rotate password
 *
 * Requirements: 1.2, 4.5, 5.1
 */

const { Router } = require('express');
const authenticationService = require('../services/authenticationService');
const credentialService = require('../services/credentialService');
const passwordResetService = require('../services/passwordResetService');

const router = Router();

/**
 * POST /auth/login
 * Body: { identifier, password }
 * Sets an httpOnly session cookie on success.
 */
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required' });
    }

    const result = await authenticationService.authenticate(identifier, password);

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    // Establish a session token
    const token = await authenticationService.establishSession(result.user.id);

    // Set the token as an httpOnly cookie
    // secure: true + sameSite: 'none' allows cross-origin credentialed requests.
    // Browsers exempt localhost from the Secure requirement, so this works
    // in local dev (different ports) and in production behind HTTPS.
    res.cookie('session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 60 * 1000, // 30 minutes
      path: '/',
    });

    return res.status(200).json({
      success: true,
      mustRotatePassword: result.mustRotatePassword || false,
      user: {
        id: result.user.id,
        role: result.user.role,
        association_id: result.user.association_id,
        can_add_federation_voters: result.user.can_add_federation_voters === true,
        can_manage_members: result.user.can_manage_members === true,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/change-password
 * Body: { newPassword }
 * Requires an active session (requireSession middleware applied at mount).
 */
router.post('/change-password', async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    const { pool } = require('../db/pool');
    const usersRepository = require('../db/repositories/usersRepository');

    const result = await credentialService.rotatePassword(req.user.id, newPassword, {
      usersRepository,
      pool,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/forgot-password
 * Body: { email }
 * Public. Always responds 200 with a generic message — never reveals whether
 * the email is registered. When registered, a reset code is emailed.
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    await passwordResetService.requestReset(email);
    // Uniform, non-revealing response.
    return res.status(200).json({
      success: true,
      message:
        'Si cette adresse est enregistrée, vous recevrez un code pour réinitialiser votre mot de passe.',
    });
  } catch (err) {
    // Even on internal error, avoid leaking details; respond uniformly.
    return res.status(200).json({
      success: true,
      message:
        'Si cette adresse est enregistrée, vous recevrez un code pour réinitialiser votre mot de passe.',
    });
  }
});

/**
 * POST /auth/verify-reset-code
 * Body: { email, code }
 * Public. Verifies the emailed code WITHOUT consuming it, so the UI can confirm
 * the code before showing the new-password step. After too many wrong attempts
 * the code is invalidated (locked) and the user must request a new one.
 */
router.post('/verify-reset-code', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: 'Email et code sont requis.' });
    }

    const result = await passwordResetService.verifyResetCode(email, code);
    if (!result.success) {
      return res.status(400).json({
        error: result.error,
        locked: result.locked === true,
        remainingAttempts:
          typeof result.remainingAttempts === 'number' ? result.remainingAttempts : undefined,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/reset-password
 * Body: { email, code, newPassword }
 * Public. Verifies the emailed code and sets a new permanent password.
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body || {};

    if (!email || !code || !newPassword) {
      return res
        .status(400)
        .json({ error: 'Email, code et nouveau mot de passe sont requis.' });
    }

    const result = await passwordResetService.resetPassword(email, code, newPassword);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Mot de passe réinitialisé. Vous pouvez maintenant vous connecter.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/logout
 * Clears the session cookie. Works even without an active session.
 */
router.post('/logout', (req, res) => {
  res.clearCookie('session', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
  return res.status(200).json({ success: true });
});

/**
 * GET /auth/me
 * Returns the current session user's role and association info.
 * Used by the frontend to determine role-based routing.
 */
router.get('/me', async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    return res.status(200).json({
      id: user.id,
      email: user.email,
      role: user.role,
      association_id: user.association_id || null,
      can_add_federation_voters: user.can_add_federation_voters === true,
      can_manage_members: user.can_manage_members === true,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
