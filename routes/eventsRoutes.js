const express = require('express');
const router = express.Router();
const eventsController = require('../controllers/eventsController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// Public
router.get('/', eventsController.list);
router.get('/notification-stats', eventsController.getNotificationStats);
router.get('/:id', eventsController.getById);

// Admin only
router.post('/', authenticateToken, authorizeRoles('admin'), eventsController.create);
router.put('/:id', authenticateToken, authorizeRoles('admin'), eventsController.update);
router.delete('/:id', authenticateToken, authorizeRoles('admin'), eventsController.remove);

module.exports = router;
