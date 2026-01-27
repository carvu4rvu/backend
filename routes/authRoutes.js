const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/register/initiate', authController.registerInitiate);
router.post('/register/verify', authController.registerVerify);
router.post('/login', authController.login);
router.post('/forgot-password/initiate', authController.forgotPasswordInitiate);
router.post('/forgot-password/verify', authController.forgotPasswordVerify);
router.get('/verify', authenticateToken, authController.verifyToken);

module.exports = router;
