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
router.get('/projects/:id', projectController.adminGetById);
router.patch('/projects/:id', projectController.adminUpdate);
router.delete('/projects/:id', projectController.adminDelete);

// Admin: project assets (full control)
router.post('/projects/:id/assets', projectController.adminAddAsset);
router.delete('/projects/:id/assets/:assetId', projectController.adminDeleteAsset);
router.patch('/projects/:id/assets/:assetId', projectController.adminUpdateAsset);

// Admin: project asset variants
router.get('/projects/:id/assets/:assetId/variants', projectController.adminListVariants);
router.delete('/projects/:id/assets/:assetId/variants/:variantId', projectController.adminDeleteVariant);

// Admin: project reviews
router.get('/projects/:id/reviews', projectController.adminListReviews);
router.post('/projects/:id/reviews', projectController.adminAddReview);
router.delete('/projects/:id/reviews/:reviewId', projectController.adminDeleteReview);

// Admin: project share links
router.get('/projects/:id/share-links', projectController.adminListShareLinks);
router.post('/projects/:id/share-links', projectController.adminCreateShareLink);
router.delete('/projects/:id/share-links/:linkId', projectController.adminDeleteShareLink);

module.exports = router;
