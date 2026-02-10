const nodemailer = require('nodemailer');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

let transporterConfig;

if (isProd) {
  // Production: SendGrid
  transporterConfig = {
    host: process.env.SENDGRID_HOST || 'smtp.sendgrid.net',
    port: parseInt(process.env.SENDGRID_PORT || '587', 10),
    secure: false, // true only for 465
    auth: {
      user: process.env.SENDGRID_USERNAME || 'apikey', // SendGrid username
      pass: process.env.SENDGRID_PASSWORD,             // SendGrid API key
    },
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
    tls: {
      rejectUnauthorized: false, // helps in Railway / dev
    },
  };
}

const transporter = nodemailer.createTransport(transporterConfig);

module.exports = transporter;
