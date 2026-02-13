/**
 * Project routes: /api/projects
 * Student-facing CRUD, feed, assets, share links, reviews, likes, favorites, ratings.
 */

const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { authenticateToken, optionalAuthenticate } = require('../middleware/authMiddleware');

// Public routes (no auth required)
router.get('/feed', projectController.feed);
router.get('/share/:token', projectController.getByShareToken);

// All routes below require auth (except feed and share)
router.use(authenticateToken);

// List (with optional usn, profile params)
router.get('/', projectController.list);

// CRUD
router.post('/', projectController.create);

// Share - MUST be before /:id (more specific path)
router.post('/:id/share', (req, res, next) => {
  console.log('[projectRoutes] POST /:id/share hit', { id: req.params.id, method: req.method, path: req.path, originalUrl: req.originalUrl });
  next();
}, projectController.createShareLink);

router.get('/:id', projectController.getOne);
router.patch('/:id', projectController.update);
router.delete('/:id', projectController.delete);

// Workflow
router.patch('/:id/submit', projectController.submit);
router.patch('/:id/publish', projectController.publish);

// Assets
router.post('/:id/assets', projectController.addAsset);
router.delete('/:id/assets/:assetId', projectController.deleteAsset);

// Engagement (reviews, like, favorite, rate)
router.post('/:id/reviews', projectController.addReview);
router.patch('/:id/reviews/:reviewId', projectController.replyReview);
router.post('/:id/like', projectController.toggleLike);
router.post('/:id/favorite', projectController.toggleFavorite);
router.put('/:id/rate', projectController.rate);

module.exports = router;
