const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

/**
 * Middleware to verify JWT token
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');

    // Optionally verify user still exists and is active
    const userQuery = `
      SELECT ul.id, ul.usn, ul.is_active, ul.email_id, r.name as role_name
      FROM user_login ul
      JOIN roles r ON r.id = ul.role_id
      WHERE ul.id = $1
    `;
    const result = await pool.query(userQuery, [decoded.sub]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    // Attach user info to request (email needed for alumni/me resolution)
    req.user = {
      id: user.id,
      usn: user.usn,
      role: user.role_name,
      email: user.email_id || null
    };

    // For student routes, verify the USN matches (students can only access their own data)
    if (req.params.usn && user.usn && req.params.usn !== user.usn && user.role_name === 'student') {
      return res.status(403).json({ message: 'Access denied. You can only access your own profile.' });
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    console.error('Auth middleware error:', error);
    return res.status(500).json({ message: 'Authentication error' });
  }
};

/**
 * Middleware to check if user has required role(s)
 */
const authorizeRoles = (...allowedRoles) => {
  const normalizedAllowed = allowedRoles.map((r) => (r && typeof r === 'string' ? r.toLowerCase() : r));
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userRole = req.user.role && typeof req.user.role === 'string' ? req.user.role.toLowerCase() : req.user.role;
    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRoles
};
