const jwt = require('jsonwebtoken');
require('dotenv').config();

const generateToken = (user_id, usn, role) => {
  const payload = {
    sub: user_id,
    usn: usn,
    role: role
  };

  return jwt.sign(payload, process.env.JWT_SECRET || 'your_jwt_secret', {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h'
  });
};

module.exports = generateToken;
