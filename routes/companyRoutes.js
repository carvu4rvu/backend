const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// All routes require company role authentication
const companyAuth = [authenticateToken, authorizeRoles('company')];

// Profile
router.get('/profile', ...companyAuth, companyController.getMyProfile);
router.patch('/profile', ...companyAuth, companyController.updateProfile);

// Contacts
router.get('/contacts', ...companyAuth, companyController.getContacts);
router.post('/contacts', ...companyAuth, companyController.addContact);
router.patch('/contacts/:id', ...companyAuth, companyController.updateContact);
router.delete('/contacts/:id', ...companyAuth, companyController.deleteContact);

// Placement Drives
router.get('/drives', ...companyAuth, companyController.getDrives);
router.get('/drives/:id', ...companyAuth, companyController.getDriveById);
router.get('/drives/:id/eligibility', ...companyAuth, companyController.getDriveEligibility);
router.get('/drives/:id/candidates', ...companyAuth, companyController.getDriveCandidates);
router.patch('/drives/:driveId/candidates/:usn', ...companyAuth, companyController.updateCandidateStatus);

// Student Profile (Company-Safe View)
router.get('/students/:usn', ...companyAuth, companyController.getStudentProfile);

// Offers
router.get('/offers', ...companyAuth, companyController.getOffers);

// Events
router.get('/events', ...companyAuth, companyController.getEvents);

// Student projects (only students who registered to company's drives)
router.get('/projects', ...companyAuth, companyController.getProjects);
router.post('/projects/:projectId/share-links', ...companyAuth, companyController.createProjectShareLink);
router.get('/projects/:projectId', ...companyAuth, companyController.getProjectById);

// Notifications
router.get('/notifications', ...companyAuth, companyController.getNotifications);
router.get('/notifications/unread-count', ...companyAuth, companyController.getNotificationsUnreadCount);
router.patch('/notifications/:nodeId', ...companyAuth, companyController.updateNotificationNode);

// Dashboard
router.get('/dashboard', ...companyAuth, companyController.getDashboardStats);

module.exports = router;
