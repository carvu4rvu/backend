const express = require('express');
const multer = require('multer');
const router = express.Router();
const eventsController = require('../controllers/eventsController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Public
router.get('/', eventsController.list);
router.get('/notification-stats', eventsController.getNotificationStats);
router.get('/:id', eventsController.getById);

// Admin only
router.post('/', authenticateToken, authorizeRoles('admin'), eventsController.create);
router.post(
  '/:id/image',
  authenticateToken,
  authorizeRoles('admin'),
  upload.single('file'),
  eventsController.uploadImage
);
router.put('/:id', authenticateToken, authorizeRoles('admin'), eventsController.update);
router.delete('/:id', authenticateToken, authorizeRoles('admin'), eventsController.remove);

router.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Image too large. Maximum size is 5MB.' });
  }
  if (err) return res.status(400).json({ message: err.message || 'Upload error' });
  next();
});

module.exports = router;
