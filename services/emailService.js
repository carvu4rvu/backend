/**
 * Email service: SendGrid Web API with fallback to SMTP (nodemailer).
 * When SENDGRID_API_KEY is set, uses SendGrid Web API; otherwise uses config/smtp transporter.
 * On PaaS (e.g. Render) set SENDGRID_API_KEY in the dashboard so Web API is used (no SMTP timeout issues).
 */

require('dotenv').config();

const transporter = require('../config/smtp');

let sgMail = null;
let useSendGrid = false;

if (process.env.SENDGRID_API_KEY) {
  try {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    useSendGrid = true;
  } catch (err) {
    console.warn('[emailService] SendGrid package or API key issue, using SMTP:', err?.message);
  }
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[emailService] SENDGRID_API_KEY not set in production. Set it in your host dashboard (e.g. Render) to use SendGrid Web API and avoid SMTP timeouts.');
}

const defaultFrom = process.env.SENDGRID_FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com';

const EMAIL_SEND_TIMEOUT_MS = 20000; // 20s max for entire send

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label || 'Operation'} timed out after ${ms}ms`)), ms)
  ]);
}

/**
 * Send a single email.
 * @param {object} opts - { to, subject, text, html?, from? }
 * @returns {Promise<void>}
 */
async function sendEmail(opts) {
  const { to, subject, text, html, from = defaultFrom } = opts || {};
  if (!to || !subject || (!text && !html)) {
    throw new Error('emailService.sendEmail: to, subject, and (text or html) are required');
  }

  const doSend = async () => {
    if (useSendGrid && sgMail) {
      await sgMail.send({
        to,
        from: typeof from === 'string' ? from : defaultFrom,
        subject,
        text: text || undefined,
        html: html || undefined,
      });
      return;
    }

    const mailOptions = {
      from,
      to,
      subject,
      text: text || '',
      html: html || undefined,
    };
    await transporter.sendMail(mailOptions);
  };

  try {
    await withTimeout(doSend(), EMAIL_SEND_TIMEOUT_MS, 'Email send');
  } catch (err) {
    const code = err?.code || '';
    const msg = err?.message || '';
    if (code === 'ETIMEDOUT' || code === 'ESOCKET' || msg.includes('timed out') || msg.includes('timeout')) {
      console.error('[emailService] Send failed (timeout/connection):', code, msg);
      throw new Error('Email service is temporarily unavailable. Please try again in a few minutes.');
    }
    if (code === 'EAUTH' || msg.toLowerCase().includes('authenticat')) {
      console.error('[emailService] Send failed (auth):', code, msg);
      throw new Error('Email configuration error. Please contact support.');
    }
    console.error('[emailService] Send failed:', code, msg);
    throw err;
  }
}

/**
 * Send OTP email (used by auth flows).
 * @param {string} email - Recipient email
 * @param {string} otp - OTP code
 * @param {string} purpose - e.g. 'REGISTRATION', 'PASSWORD RESET'
 */
async function sendOTPEmail(email, otp, purpose) {
  const subject = `Your OTP for ${purpose} - CarvingYou`;
  const text = `Your OTP for ${purpose} is ${otp}. It expires in 5 minutes.`;
  await sendEmail({ to: email, subject, text });
}

module.exports = {
  sendEmail,
  sendOTPEmail,
  isUsingSendGrid: () => useSendGrid,
};
