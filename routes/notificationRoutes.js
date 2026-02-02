const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// Admin: create (no send), list, getById, send
router.post(
  '/',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'),
  notificationController.create
);
router.get(
  '/',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'),
  notificationController.list
);

// Student: my notifications, mark read (specific paths before /:id)
router.get(
  '/me/unread-count',
  authenticateToken,
  notificationController.getUnreadCount
);
router.patch(
  '/me/read-all',
  authenticateToken,
  notificationController.markAllAsRead
);
router.get(
  '/me',
  authenticateToken,
  notificationController.getMyNotifications
);
router.patch(
  '/me/:id/read',
  authenticateToken,
  notificationController.markAsRead
);
router.patch(
  '/me/:id/star',
  authenticateToken,
  notificationController.toggleStar
);
router.patch(
  '/me/:id/archive',
  authenticateToken,
  notificationController.toggleArchive
);

// Admin: single notification, recipients, send, resend (after /me routes)
// More specific routes first (recipients before generic :id)
router.get(
  '/:id/recipients',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'),
  notificationController.getRecipients
);
router.get(
  '/:id',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'),
  notificationController.getById
);
router.post(
  '/:id/send',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'),
  notificationController.send
);
router.post(
  '/:id/resend',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'),
  notificationController.resend
);

module.exports = router;
