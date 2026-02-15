/**
 * Email service: SendGrid Web API with fallback to SMTP (nodemailer).
 * When SENDGRID_API_KEY is set, uses SendGrid Web API; otherwise uses config/smtp transporter.
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
}

const defaultFrom = process.env.SENDGRID_FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com';

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
