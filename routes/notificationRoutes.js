const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// List roles (must be before /:id)
router.get('/roles', authenticateToken, authorizeRoles('admin'), notificationController.getRoles);

// Recipient options for "Add notification" (students, alumni, companies, roles)
router.get('/recipient-options', authenticateToken, authorizeRoles('admin'), notificationController.getRecipientOptions);

// List custom notifications
router.get('/', authenticateToken, authorizeRoles('admin'), notificationController.list);

// Create custom notification
router.post('/', authenticateToken, authorizeRoles('admin'), notificationController.create);

// Duplicate (must be before /:id if we had /notifications/duplicate - we use POST :id/duplicate)
// Get one, update, send, recipients, resend, duplicate
router.get('/:id', authenticateToken, authorizeRoles('admin'), notificationController.getById);
router.patch('/:id', authenticateToken, authorizeRoles('admin'), notificationController.update);
router.delete('/:id', authenticateToken, authorizeRoles('admin'), notificationController.delete);
router.post('/:id/send', authenticateToken, authorizeRoles('admin'), notificationController.send);
router.get('/:id/recipients', authenticateToken, authorizeRoles('admin'), notificationController.getRecipients);
router.post('/:id/resend', authenticateToken, authorizeRoles('admin'), notificationController.resend);
router.post('/:id/duplicate', authenticateToken, authorizeRoles('admin'), notificationController.duplicate);

module.exports = router;
