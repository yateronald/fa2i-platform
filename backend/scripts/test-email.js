'use strict';

// Standalone email diagnostic script for FA2I.
// Run with: node --env-file=.env scripts/test-email.js
// or:       npm run test:email
//
// It reads the Hostinger SMTP configuration from the environment and attempts to
// send a test email, printing verbose diagnostics at every step so that the
// exact point of failure (auth, unauthorized IP, unverified sender, etc.) is
// visible.

const nodemailer = require('nodemailer');

const TEST_RECIPIENT = 'yateronald@gmail.com';

function mask(value) {
  if (!value) return '(empty)';
  return `length=${value.length}`;
}

async function main() {
  console.log('========================================');
  console.log('FA2I - Email diagnostic script');
  console.log('Started at:', new Date().toISOString());
  console.log('========================================');

  const config = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  };

  console.log('\n--- Resolved SMTP configuration ---');
  console.log('SMTP_HOST    :', config.host || '(empty)');
  console.log('SMTP_PORT    :', config.port || '(empty)');
  console.log('SMTP_USER    :', config.user || '(empty)');
  console.log('SMTP_FROM    :', config.from || '(empty)');
  console.log('SMTP_PASSWORD:', mask(config.password), '(value hidden)');
  console.log('Recipient    :', TEST_RECIPIENT);

  // Validate required fields.
  const required = {
    SMTP_HOST: config.host,
    SMTP_PORT: config.port,
    SMTP_USER: config.user,
    SMTP_PASSWORD: config.password,
    SMTP_FROM: config.from,
  };

  const missing = Object.keys(required).filter((key) => {
    const v = required[key];
    return v === undefined || v === null || String(v).trim() === '';
  });

  if (missing.length > 0) {
    console.error('\n[ERROR] Missing required SMTP environment variables:');
    missing.forEach((key) => console.error('  -', key));
    console.error('\nAborting. Please set these variables in your .env file.');
    process.exit(1);
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  console.log('\n--- Creating transporter ---');
  console.log('Using port:', port, '| secure:', port === 465);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    logger: true, // verbose SMTP conversation
    debug: true,
  });

  // Verify connection / authentication.
  console.log('\n--- Verifying SMTP connection & authentication ---');
  try {
    await transporter.verify();
    console.log('[OK] transporter.verify() succeeded: server is ready to take messages.');
  } catch (err) {
    console.error('[FAIL] transporter.verify() failed.');
    console.error('  message     :', err && err.message);
    console.error('  code        :', err && err.code);
    console.error('  command     :', err && err.command);
    console.error('  response    :', err && err.response);
    console.error('  responseCode:', err && err.responseCode);
    console.error('\nFull error object:');
    console.error(err);
    process.exit(1);
  }

  // Send the test email.
  console.log('\n--- Sending test email ---');
  const subject = 'FA2I - Test email ' + new Date().toISOString();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: TEST_RECIPIENT,
    subject,
    text:
      'Ceci est un email de test du système FA2I. Si vous recevez ce message, ' +
      'la configuration SMTP Hostinger fonctionne.',
    html:
      '<p>Ceci est un <strong>email de test</strong> du système FA2I.</p>' +
      '<p>Si vous recevez ce message, la configuration SMTP Hostinger fonctionne.</p>',
  });

  console.log('\n--- Send result ---');
  console.log('messageId:', info && info.messageId);
  console.log('response :', info && info.response);
  console.log('accepted :', JSON.stringify(info && info.accepted));
  console.log('rejected :', JSON.stringify(info && info.rejected));
  console.log('\n[SUCCESS] Email sent successfully.');
}

main()
  .then(() => {
    console.log('\nDone. Exiting with code 0.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n[FAIL] sendMail (or main) threw an error.');
    console.error('  message     :', err && err.message);
    console.error('  code        :', err && err.code);
    console.error('  command     :', err && err.command);
    console.error('  response    :', err && err.response);
    console.error('  responseCode:', err && err.responseCode);
    console.error('\nFull error object:');
    console.error(err);
    process.exit(1);
  });
