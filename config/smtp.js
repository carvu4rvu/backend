const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,          // IMPORTANT
  secure: false,      // true only for 465
  auth: {
    user: process.env.SMTP_USER, // your gmail
    pass: process.env.SMTP_PASS, // app password
  },
  tls: {
    rejectUnauthorized: false, // helps in Railway
  },
});

module.exports = transporter;
