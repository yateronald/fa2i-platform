import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendCredentials } from '../../src/services/emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests for Email_Service - sendCredentials
 *
 * Mocks nodemailer transporter and emailLogRepository to test:
 * - Successful send logs SENT
 * - Retry logic on transient failures
 * - 3 consecutive failures log FAILED and surface the affected account holder
 */

function createMockTransporter(sendMailFn) {
  return { sendMail: sendMailFn };
}

function createMockLogRepo() {
  const calls = [];
  return {
    create: vi.fn(async (entry) => {
      calls.push(entry);
      return entry;
    }),
    getCalls: () => calls,
  };
}

describe('emailService.sendCredentials()', () => {
  const accountHolder = 'Jean Dupont';
  const identifier = 'jean.dupont@example.com';
  const temporaryPassword = 'Temp1234!xyz';

  let mockLogRepo;

  beforeEach(() => {
    mockLogRepo = createMockLogRepo();
  });

  it('sends email on first attempt and logs SENT with attempts=1', async () => {
    const transporter = createMockTransporter(vi.fn().mockResolvedValue({ messageId: '123' }));

    const result = await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
    });

    expect(result).toEqual({ success: true });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(mockLogRepo.create).toHaveBeenCalledWith({
      accountHolder,
      identifier,
      status: 'SENT',
      attempts: 1,
    });
  });

  it('retries on failure and succeeds on second attempt, logging attempts=2', async () => {
    const sendMail = vi.fn()
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({ messageId: '456' });
    const transporter = createMockTransporter(sendMail);

    const result = await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
    });

    expect(result).toEqual({ success: true });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(mockLogRepo.create).toHaveBeenCalledWith({
      accountHolder,
      identifier,
      status: 'SENT',
      attempts: 2,
    });
  });

  it('retries on failure and succeeds on third attempt, logging attempts=3', async () => {
    const sendMail = vi.fn()
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockRejectedValueOnce(new Error('SMTP error'))
      .mockResolvedValueOnce({ messageId: '789' });
    const transporter = createMockTransporter(sendMail);

    const result = await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
    });

    expect(result).toEqual({ success: true });
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(mockLogRepo.create).toHaveBeenCalledWith({
      accountHolder,
      identifier,
      status: 'SENT',
      attempts: 3,
    });
  });

  it('logs FAILED and returns error after 3 consecutive failures', async () => {
    const sendMail = vi.fn()
      .mockRejectedValueOnce(new Error('Timeout 1'))
      .mockRejectedValueOnce(new Error('Timeout 2'))
      .mockRejectedValueOnce(new Error('Timeout 3'));
    const transporter = createMockTransporter(sendMail);

    const result = await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
    });

    expect(result).toEqual({
      success: false,
      accountHolder,
      error: 'Timeout 3',
    });
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(mockLogRepo.create).toHaveBeenCalledWith({
      accountHolder,
      identifier,
      status: 'FAILED',
      attempts: 3,
    });
  });

  it('surfaces the affected account holder on failure for caller error display', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('Auth failed'));
    const transporter = createMockTransporter(sendMail);

    const result = await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
    });

    expect(result.success).toBe(false);
    expect(result.accountHolder).toBe(accountHolder);
    expect(result.error).toBe('Auth failed');
  });

  it('includes recipient, subject, and credentials in mail options', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'abc' });
    const transporter = createMockTransporter(sendMail);

    await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
    });

    const mailOptions = sendMail.mock.calls[0][0];
    expect(mailOptions.to).toBe(identifier);
    expect(mailOptions.subject).toContain('FA2I');
    expect(mailOptions.text).toContain(identifier);
    expect(mailOptions.text).toContain(temporaryPassword);
    expect(mailOptions.text).toContain(accountHolder);
  });

  it('includes a branded HTML body with the logo URL and brand name when provided', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'brand' });
    const transporter = createMockTransporter(sendMail);

    await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
      logoUrl: 'https://cdn.example.com/logo.png',
      brandName: 'Mon Association',
    });

    const mailOptions = sendMail.mock.calls[0][0];
    expect(mailOptions.html).toBeDefined();
    expect(mailOptions.html).toContain('https://cdn.example.com/logo.png');
    expect(mailOptions.html).toContain('Mon Association');
    expect(mailOptions.html).toContain(temporaryPassword);
    expect(mailOptions.subject).toContain('Mon Association');
  });

  it('omits the logo image tag when no logoUrl is provided but still renders HTML', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'nologo' });
    const transporter = createMockTransporter(sendMail);

    await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
    });

    const mailOptions = sendMail.mock.calls[0][0];
    expect(mailOptions.html).toBeDefined();
    expect(mailOptions.html).not.toContain('<img');
    // Defaults to FA2I branding
    expect(mailOptions.html).toContain('FA2I');
  });

  it('embeds the logo inline as a CID attachment when logoPath points to an existing file', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'cidfile' });
    const transporter = createMockTransporter(sendMail);

    const logoPath = path.join(__dirname, '..', '..', 'src', 'assets', 'fa2i-logo.jpg');

    await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
      logoPath,
    });

    const mailOptions = sendMail.mock.calls[0][0];
    expect(Array.isArray(mailOptions.attachments)).toBe(true);
    expect(mailOptions.attachments).toHaveLength(1);
    expect(mailOptions.attachments[0]).toMatchObject({ cid: 'fa2ilogo', path: logoPath });
    expect(mailOptions.html).toContain('cid:fa2ilogo');
  });

  it('uses an http(s) logoUrl directly as the img src with no attachment', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'httpurl' });
    const transporter = createMockTransporter(sendMail);

    await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
      logoUrl: 'https://cdn.example.com/logo.png',
    });

    const mailOptions = sendMail.mock.calls[0][0];
    expect(mailOptions.attachments).toBeUndefined();
    expect(mailOptions.html).toContain('https://cdn.example.com/logo.png');
    expect(mailOptions.html).not.toContain('cid:fa2ilogo');
  });

  it('embeds a base64 data URL logo inline as a CID attachment', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'dataurl' });
    const transporter = createMockTransporter(sendMail);

    const payload = 'iVBORw0KGgoAAAANSUhEUg==';
    await sendCredentials(accountHolder, identifier, temporaryPassword, {
      transporter,
      emailLogRepository: mockLogRepo,
      logoUrl: `data:image/png;base64,${payload}`,
    });

    const mailOptions = sendMail.mock.calls[0][0];
    expect(mailOptions.attachments).toHaveLength(1);
    expect(mailOptions.attachments[0]).toMatchObject({
      cid: 'fa2ilogo',
      encoding: 'base64',
      content: payload,
    });
    expect(mailOptions.html).toContain('cid:fa2ilogo');
  });
});
