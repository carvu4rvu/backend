const nodemailer = require('nodemailer');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

let transporterConfig;

// Timeouts so we fail fast instead of hanging (e.g. on Render when SMTP is blocked or credentials missing)
const CONNECTION_TIMEOUT_MS = 15000; // 15s
const GREETING_TIMEOUT_MS = 5000;

if (isProd) {
  // Production: SendGrid SMTP (prefer SENDGRID_API_KEY + Web API in emailService to avoid SMTP on PaaS)
  transporterConfig = {
    host: process.env.SENDGRID_HOST || 'smtp.sendgrid.net',
    port: parseInt(process.env.SENDGRID_PORT || '587', 10),
    secure: false, // true only for 465
    auth: {
      user: process.env.SENDGRID_USERNAME || 'apikey', // SendGrid username
      pass: process.env.SENDGRID_PASSWORD,             // SendGrid API key
    },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
  };
} else {
  // Development: local SMTP (Gmail here)
  transporterConfig = {
    host: process.env.SMTP_HOST_LOCAL || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT_LOCAL || '587', 10),
    secure: false, // true only for 465
    auth: {
      user: process.env.SMTP_USER, // gmail user
      pass: process.env.SMTP_PASS, // gmail app password
    },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    tls: {
      rejectUnauthorized: false, // helps in Railway / dev
    },
  };
}

const transporter = nodemailer.createTransport(transporterConfig);

module.exports = transporter;
