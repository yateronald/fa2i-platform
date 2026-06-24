/**
 * Email_Service
 *
 * Sends transactional credential emails via Hostinger SMTP (Nodemailer).
 * Retries up to 3 attempts and logs delivery outcome to email_delivery_log.
 *
 * Requirements: 3.4, 3.5
 */
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const emailLogRepository = require('../db/repositories/emailLogRepository');

const MAX_ATTEMPTS = 3;
const LOGO_CID = 'fa2ilogo';
const DEFAULT_BRAND_NAME = 'FA2I';
const FEDERATION_FULL_NAME = 'Fédération des Associations Ivoiriennes en Inde';

/**
 * Resolve the full display name for the email header.
 * For the default federation brand ('FA2I'), expand to the full federation
 * name; for association brands, the association name is already the full name.
 * @param {string} brandName
 * @param {string} [brandFullName] - explicit override
 * @returns {string}
 */
function resolveBrandFullName(brandName, brandFullName) {
  if (brandFullName) return brandFullName;
  if (!brandName || brandName === DEFAULT_BRAND_NAME) return FEDERATION_FULL_NAME;
  return brandName;
}

/**
 * Render the branded email header (logo + short eyebrow + full name).
 * When the short name differs from the full name (federation default), the
 * short name is shown as a small eyebrow above the full name.
 * @param {string} logoBlock - pre-rendered <img> (or '')
 * @param {string} safeBrand - escaped short brand name
 * @param {string} safeFull - escaped full display name
 * @param {string} green - header background colour
 * @returns {string[]} table-row HTML lines
 */
function renderHeaderRows(logoBlock, safeBrand, safeFull, green) {
  const showEyebrow = safeFull !== safeBrand;
  const eyebrow = showEyebrow
    ? `          <div style="margin-top:10px;color:rgba(255,255,255,0.82);font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">${safeBrand}</div>`
    : '';
  return [
    `        <tr><td align="center" style="background-color:${green};padding:24px;">`,
    `          ${logoBlock}`,
    eyebrow,
    `          <div style="margin-top:6px;color:#ffffff;font-size:${showEyebrow ? '17px' : '22px'};font-weight:bold;line-height:1.3;">${safeFull}</div>`,
    '        </td></tr>',
  ].filter(Boolean);
}

/**
 * Resolve the logo source string and any inline attachment for the credential email.
 *
 * Resolution order:
 *  1. `deps.logoPath` points to an existing file on disk → embed it inline as a CID
 *     attachment and use 'cid:fa2ilogo' as the image source.
 *  2. `deps.logoUrl` is a base64 data URL (data:...) → parse the mime + payload and
 *     embed it inline as a CID attachment. If parsing fails, fall back to using the
 *     data URL directly with no attachment.
 *  3. `deps.logoUrl` is an http(s) URL → use it directly as the image source, no attachment.
 *  4. Otherwise → no logo (empty src), so buildCredentialHtml omits the <img>.
 *
 * @param {{ logoPath?: string|null, logoUrl?: string|null }} [deps]
 * @returns {{ logoSrc: string, attachments: Array<object> }}
 */
function resolveLogo(deps) {
  const logoPath = deps && deps.logoPath;
  const logoUrl = (deps && deps.logoUrl) || null;

  // 1. Bundled / on-disk logo file embedded inline.
  if (logoPath && typeof logoPath === 'string') {
    try {
      if (fs.existsSync(logoPath)) {
        return {
          logoSrc: `cid:${LOGO_CID}`,
          attachments: [{ filename: 'logo.jpg', path: logoPath, cid: LOGO_CID }],
        };
      }
    } catch {
      // fall through to other resolution strategies
    }
  }

  // 2. Base64 data URL embedded inline (improves Gmail rendering of data-URL logos).
  if (logoUrl && logoUrl.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(logoUrl);
    if (match && match[2] && match[3]) {
      const mime = match[1] || 'image/jpeg';
      const ext = mime.split('/')[1] || 'jpg';
      return {
        logoSrc: `cid:${LOGO_CID}`,
        attachments: [
          {
            filename: `logo.${ext}`,
            content: match[3],
            encoding: 'base64',
            cid: LOGO_CID,
          },
        ],
      };
    }
    // Parsing failed → use the data URL directly, no attachment.
    return { logoSrc: logoUrl, attachments: [] };
  }

  // 3. Public http(s) URL used directly.
  if (logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))) {
    return { logoSrc: logoUrl, attachments: [] };
  }

  // 4. No logo.
  return { logoSrc: '', attachments: [] };
}

/**
 * Create the SMTP transporter (Hostinger).
 * Extracted so it can be overridden in tests via dependency injection.
 */
function createTransporter() {
  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // true for 465, false for 587 (STARTTLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

/**
 * Escape a string for safe inclusion in HTML.
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the branded HTML credential email body.
 *
 * @param {string} accountHolder
 * @param {string} identifier
 * @param {string} temporaryPassword
 * @param {string} logoSrc
 * @param {string} brandName
 * @returns {string}
 */
function buildCredentialHtml(accountHolder, identifier, temporaryPassword, logoSrc, brandName, brandFullName) {
  const safeHolder = escapeHtml(accountHolder);
  const safeIdentifier = escapeHtml(identifier);
  const safePassword = escapeHtml(temporaryPassword);
  const safeBrand = escapeHtml(brandName);
  const safeFull = escapeHtml(resolveBrandFullName(brandName, brandFullName));
  const safeLogo = escapeHtml(logoSrc);

  // FA2I palette: green + orange
  const green = '#1b7a3d';
  const orange = '#e8821e';

  const logoBlock = logoSrc
    ? `<img src="${safeLogo}" alt="${safeBrand}" style="max-height:64px;border-radius:8px"/>`
    : '';

  return [
    '<!DOCTYPE html>',
    '<html lang="fr">',
    '<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222;">',
    '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">',
    '    <tr><td align="center">',
    '      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">',
    ...renderHeaderRows(logoBlock, safeBrand, safeFull, green),
    '        <tr><td style="padding:32px 28px;">',
    `          <p style="font-size:16px;margin:0 0 16px;">Bonjour ${safeHolder},</p>`,
    '          <p style="font-size:15px;line-height:1.5;margin:0 0 20px;">Votre compte a &eacute;t&eacute; cr&eacute;&eacute;. Voici vos identifiants de connexion :</p>',
    '          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">',
    `            <tr><td style="font-size:14px;color:#555;padding:6px 0;">Identifiant :</td></tr>`,
    `            <tr><td style="font-size:16px;font-weight:bold;padding:0 0 12px;">${safeIdentifier}</td></tr>`,
    `            <tr><td style="font-size:14px;color:#555;padding:6px 0;">Mot de passe temporaire :</td></tr>`,
    `            <tr><td><div style="display:inline-block;font-size:20px;font-weight:bold;letter-spacing:1px;color:#ffffff;background-color:${orange};padding:10px 18px;border-radius:8px;">${safePassword}</div></td></tr>`,
    '          </table>',
    '          <p style="font-size:14px;line-height:1.5;color:#555;margin:0 0 24px;">Veuillez vous connecter et changer votre mot de passe lors de votre premi&egrave;re connexion.</p>',
    `          <p style="font-size:15px;font-style:italic;color:${green};margin:0;">Dans l'union, nous impacterons</p>`,
    '        </td></tr>',
    `        <tr><td style="background-color:#fafafa;padding:16px 28px;border-top:1px solid #eee;font-size:12px;color:#999;">&copy; ${safeFull}</td></tr>`,
    '      </table>',
    '    </td></tr>',
    '  </table>',
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Send credential email to the account holder with retry logic.
 *
 * - Tries sending up to 3 times.
 * - On success, logs to email_delivery_log with status='SENT' and returns { success: true }.
 * - On 3 failures, logs to email_delivery_log with status='FAILED' and returns
 *   { success: false, accountHolder, error: <message> }.
 *
 * @param {string} accountHolder - The name of the account holder.
 * @param {string} identifier - The login identifier (email) for the account.
 * @param {string} temporaryPassword - The generated temporary password.
 * @param {{ transporter?: object, emailLogRepository?: object, logoUrl?: string|null, logoPath?: string|null, brandName?: string }} [deps] - Dependency/branding overrides.
 * @returns {Promise<{ success: true } | { success: false, accountHolder: string, error: string }>}
 */
async function sendCredentials(accountHolder, identifier, temporaryPassword, deps) {
  const transporter = (deps && deps.transporter) || createTransporter();
  const logRepo = (deps && deps.emailLogRepository) || emailLogRepository;
  const brandName = (deps && deps.brandName) || 'FA2I';
  const brandFullName = (deps && deps.brandFullName) || null;

  const { logoSrc, attachments } = resolveLogo(deps);

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: identifier,
    subject: `${brandName} - Vos identifiants de connexion`,
    text: [
      `Bonjour ${accountHolder},`,
      '',
      `Votre compte ${brandName} a été créé. Voici vos identifiants de connexion :`,
      '',
      `Identifiant : ${identifier}`,
      `Mot de passe temporaire : ${temporaryPassword}`,
      '',
      'Veuillez vous connecter et changer votre mot de passe lors de votre première connexion.',
      '',
      "Dans l'union, nous impacterons",
      '',
      'Cordialement,',
      `L'équipe ${brandName}`,
    ].join('\n'),
    html: buildCredentialHtml(accountHolder, identifier, temporaryPassword, logoSrc, brandName, brandFullName),
  };

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments;
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await transporter.sendMail(mailOptions);

      // Success: log SENT and return
      await logRepo.create({
        accountHolder,
        identifier,
        status: 'SENT',
        attempts: attempt,
      });

      return { success: true };
    } catch (err) {
      lastError = err;
    }
  }

  // All attempts failed: log FAILED and return error info
  const errorMessage = lastError ? lastError.message : 'Unknown email delivery error';

  await logRepo.create({
    accountHolder,
    identifier,
    status: 'FAILED',
    attempts: MAX_ATTEMPTS,
  });

  return {
    success: false,
    accountHolder,
    error: errorMessage,
  };
}

/**
 * Build the branded HTML password-reset email body containing the reset code.
 *
 * @param {string} accountHolder
 * @param {string} code - The numeric reset code.
 * @param {number} ttlMinutes - Validity window in minutes.
 * @param {string} logoSrc
 * @param {string} brandName
 * @returns {string}
 */
function buildResetHtml(accountHolder, code, ttlMinutes, logoSrc, brandName, brandFullName) {
  const safeHolder = escapeHtml(accountHolder);
  const safeCode = escapeHtml(code);
  const safeBrand = escapeHtml(brandName);
  const safeFull = escapeHtml(resolveBrandFullName(brandName, brandFullName));
  const safeLogo = escapeHtml(logoSrc);
  const safeTtl = escapeHtml(String(ttlMinutes));

  const green = '#1b7a3d';
  const orange = '#e8821e';

  const logoBlock = logoSrc
    ? `<img src="${safeLogo}" alt="${safeBrand}" style="max-height:64px;border-radius:8px"/>`
    : '';

  return [
    '<!DOCTYPE html>',
    '<html lang="fr">',
    '<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222;">',
    '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">',
    '    <tr><td align="center">',
    '      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">',
    ...renderHeaderRows(logoBlock, safeBrand, safeFull, green),
    '        <tr><td style="padding:32px 28px;">',
    `          <p style="font-size:16px;margin:0 0 16px;">Bonjour ${safeHolder},</p>`,
    '          <p style="font-size:15px;line-height:1.5;margin:0 0 20px;">Vous avez demand&eacute; la r&eacute;initialisation de votre mot de passe. Voici votre code de r&eacute;initialisation :</p>',
    '          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">',
    `            <tr><td align="center"><div style="display:inline-block;font-size:30px;font-weight:bold;letter-spacing:8px;color:#ffffff;background-color:${orange};padding:14px 26px;border-radius:8px;">${safeCode}</div></td></tr>`,
    '          </table>',
    `          <p style="font-size:14px;line-height:1.5;color:#555;margin:0 0 20px;">Ce code est valable pendant ${safeTtl} minutes. Saisissez-le sur la page de r&eacute;initialisation pour choisir un nouveau mot de passe.</p>`,
    '          <p style="font-size:13px;line-height:1.5;color:#999;margin:0 0 24px;">Si vous n\'&ecirc;tes pas &agrave; l\'origine de cette demande, ignorez cet email : votre mot de passe restera inchang&eacute;.</p>',
    `          <p style="font-size:15px;font-style:italic;color:${green};margin:0;">Dans l'union, nous impacterons</p>`,
    '        </td></tr>',
    `        <tr><td style="background-color:#fafafa;padding:16px 28px;border-top:1px solid #eee;font-size:12px;color:#999;">&copy; ${safeFull}</td></tr>`,
    '      </table>',
    '    </td></tr>',
    '  </table>',
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Send a password-reset code email with retry logic (mirrors sendCredentials).
 *
 * @param {string} accountHolder
 * @param {string} identifier - recipient email.
 * @param {string} code - the numeric reset code.
 * @param {{ ttlMinutes?: number, transporter?: object, emailLogRepository?: object, logoUrl?: string|null, logoPath?: string|null, brandName?: string }} [deps]
 * @returns {Promise<{ success: true } | { success: false, accountHolder: string, error: string }>}
 */
async function sendPasswordReset(accountHolder, identifier, code, deps) {
  const transporter = (deps && deps.transporter) || createTransporter();
  const logRepo = (deps && deps.emailLogRepository) || emailLogRepository;
  const brandName = (deps && deps.brandName) || 'FA2I';
  const brandFullName = (deps && deps.brandFullName) || null;
  const ttlMinutes = (deps && deps.ttlMinutes) || 15;

  const { logoSrc, attachments } = resolveLogo(deps);

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: identifier,
    subject: `${brandName} - Code de réinitialisation du mot de passe`,
    text: [
      `Bonjour ${accountHolder},`,
      '',
      'Vous avez demandé la réinitialisation de votre mot de passe.',
      '',
      `Code de réinitialisation : ${code}`,
      `Ce code est valable pendant ${ttlMinutes} minutes.`,
      '',
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
      '',
      "Dans l'union, nous impacterons",
      '',
      `L'équipe ${brandName}`,
    ].join('\n'),
    html: buildResetHtml(accountHolder, code, ttlMinutes, logoSrc, brandName, brandFullName),
  };

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments;
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      await logRepo.create({ accountHolder, identifier, status: 'SENT', attempts: attempt });
      return { success: true };
    } catch (err) {
      lastError = err;
    }
  }

  const errorMessage = lastError ? lastError.message : 'Unknown email delivery error';
  await logRepo.create({ accountHolder, identifier, status: 'FAILED', attempts: MAX_ATTEMPTS });
  return { success: false, accountHolder, error: errorMessage };
}

module.exports = {
  sendCredentials,
  sendPasswordReset,
  createTransporter,
  resolveLogo,
};
