const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');

router.get('/profile/:usn', studentController.getProfile);
router.get('/profile/:usn/:section', studentController.getProfileSection);
router.put('/profile/:usn/:section', studentController.updateProfileSection);

module.exports = router;
