/**
 * Projects API routes (new): /api/projects
 * Uses projects table and owner_user_id. Separate from placement/projectController.
 */

const express = require('express');
const router = express.Router();
const projectsController = require('../controllers/projectsController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Public
router.get('/feed', projectsController.feed);
router.get('/share/:token', projectsController.resolveShare);

// Auth required: list mine (or ?usn= for profile view, ?profile=1 for public-only list)
router.get('/', authenticateToken, projectsController.list);

// Single project (visibility enforced; includes assets, variants, reviews; registers view for PUBLIC)
router.get('/:id', projectsController.getOne);

router.post('/', authenticateToken, projectsController.create);
router.patch('/:id/publish', authenticateToken, projectsController.publish);
router.patch('/:id', authenticateToken, projectsController.update);
router.delete('/:id', authenticateToken, projectsController.delete);

// Assets
router.post('/:id/assets', authenticateToken, projectsController.addAsset);
router.delete('/:id/assets/:assetId', authenticateToken, projectsController.deleteAsset);

// Share links
router.post('/:id/share', authenticateToken, projectsController.createShareLink);

// Reviews (auth required)
router.post('/:id/reviews', authenticateToken, projectsController.addReview);

module.exports = router;
