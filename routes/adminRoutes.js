/**
 * Admin routes: /api/admin
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');
const projectController = require('../controllers/projectController');

// Debug: verify admin router is reachable (remove after verifying)
router.get('/health', (req, res) => res.json({ ok: true, path: '/api/admin' }));

router.use(authenticateToken);
router.use(authorizeRoles('admin', 'vc'));

// Admin: student projects management
router.get('/projects', projectController.adminList);
router.patch('/projects/:id', projectController.adminUpdate);

module.exports = router;
