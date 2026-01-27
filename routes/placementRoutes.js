const express = require('express');
const router = express.Router();
const placementController = require('../controllers/placementController');

router.get('/student/:usn/applications', placementController.getStudentApplications);
router.get('/drives', placementController.getAllDrives);
router.get('/companies', placementController.getAllCompanies);

module.exports = router;
