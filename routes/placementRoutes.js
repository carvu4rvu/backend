const express = require('express');
const router = express.Router();
const placementController = require('../controllers/placementController');
const projectController = require('../controllers/projectController');
const emailRecipientsController = require('../controllers/emailRecipientsController');
const violationsController = require('../controllers/violationsController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// Validate critical middleware/handlers (avoids cryptic "argument handler must be a function" crash)
if (typeof authenticateToken !== 'function') throw new Error('authMiddleware.authenticateToken is not a function');
if (typeof authorizeRoles !== 'function') throw new Error('authMiddleware.authorizeRoles is not a function');

router.get('/student/:usn/applications', authenticateToken, placementController.getStudentApplications);
router.get('/offers/:usn', authenticateToken, placementController.getStudentOffers);
router.patch('/offers/decision', authenticateToken, placementController.submitOfferDecision);
router.get('/process/list', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.getAllProcessList);
router.patch('/process/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.updateProcessStatus);
router.get('/drives', authenticateToken, placementController.getAllDrives);
router.post('/drives/sync-status', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.syncDriveStatuses);
router.get('/drives/:driveId/registrations', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.getDriveRegistrations);
router.get('/drives/:driveId/export', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.getDriveExportData);
router.delete('/drives/:driveId/registrations/:usn', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.removeFromProcess);
router.get('/drives/:driveId/eligibility', authenticateToken, placementController.getDriveEligibility);
router.put('/drives/:driveId/eligibility', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.upsertDriveEligibility);
router.get('/drives/:id', authenticateToken, placementController.getDriveById);
router.post('/drives', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.addPlacementDrive);
router.put('/drives/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.updatePlacementDrive);
router.patch('/drives/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.patchPlacementDrive);
router.patch('/drives/:id/status', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.updatePlacementDriveStatusOnly);
router.get('/companies', placementController.getAllCompanies);
router.post('/companies', placementController.addCompany);
router.get('/companies/:id', placementController.getCompanyById);
router.put('/companies/:id', placementController.updateCompany);
router.get('/companies/:id/contacts', placementController.getCompanyContacts);
router.post('/companies/:id/contacts', placementController.addCompanyContacts);
router.put('/companies/:id/contacts/:contactId', placementController.updateCompanyContact);
router.delete('/companies/:id/contacts/:contactId', placementController.deleteCompanyContact);
router.get('/companies/:id/drives', placementController.getCompanyDrives);
router.get('/companies/:id/offers', placementController.getCompanyOffers);
router.post('/drives/:driveId/apply', authenticateToken, placementController.applyToDrive);

router.get('/students', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.getStudentsForPlacement);
router.get('/students/overview', authenticateToken, placementController.getPlacementOverview);
router.get('/policies', authenticateToken, placementController.getAllPolicies);
router.get('/policies/me', authenticateToken, placementController.getMyPolicy);
router.post('/policies', authenticateToken, placementController.upsertPolicy);
router.post('/policies/sync', authenticateToken, placementController.syncPolicies);

// Email recipients for bulk email (filter by category: students, parents, alumni, staff)
router.get('/email-recipients', authenticateToken, emailRecipientsController.getEmailRecipients);

// Alumni (me before :identifier; codes before :identifier to avoid matching "codes" as id)
router.get('/alumni/me', authenticateToken, authorizeRoles('alumni'), placementController.getAlumniMe);
router.put('/alumni/me', authenticateToken, authorizeRoles('alumni'), placementController.updateAlumniMe);
router.get('/alumni', authenticateToken, placementController.getAllAlumni);
router.post('/alumni', authenticateToken, placementController.addAlumni);
router.get('/alumni/codes', authenticateToken, placementController.getRegistrationCodes);
router.post('/alumni/codes', authenticateToken, placementController.createRegistrationCode);
router.delete('/alumni/codes/:id', authenticateToken, placementController.deleteRegistrationCode);
router.get('/alumni/:identifier', authenticateToken, placementController.getAlumniByIdOrUsn);
router.put('/alumni/:identifier', authenticateToken, placementController.updateAlumni);

// Student projects: admin list/update; public showcase
router.get('/projects/public', projectController.getPublicProjects);
router.get('/projects', authenticateToken, authorizeRoles('admin', 'superadmin'), projectController.getAllProjects);
router.patch('/projects/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), projectController.updateProject);

// Violations: eligibility logs, placement violations, disciplinary records
router.get('/violations/eligibility-logs', authenticateToken, authorizeRoles('admin', 'superadmin'), violationsController.getEligibilityDecisionLogs);
router.get('/violations/placement-violations', authenticateToken, authorizeRoles('admin', 'superadmin'), violationsController.getPlacementViolations);
router.get('/violations/disciplinary-records', authenticateToken, authorizeRoles('admin', 'superadmin'), violationsController.getDisciplinaryRecords);
router.post('/violations/placement-violations', authenticateToken, authorizeRoles('admin', 'superadmin'), violationsController.createPlacementViolation);
router.post('/violations/disciplinary-records', authenticateToken, authorizeRoles('admin', 'superadmin'), violationsController.createDisciplinaryRecord);

// Job Offers - ensure handlers exist before registering (avoids "argument handler must be a function" crash)
const getAllJobOffersHandler = placementController.getAllJobOffers;
const addJobOfferHandler = placementController.addJobOffer;
if (typeof getAllJobOffersHandler !== 'function') {
  throw new Error(`placementController.getAllJobOffers is not a function (got ${typeof getAllJobOffersHandler}). Available: ${Object.keys(placementController).filter(k => k.startsWith('get') || k.startsWith('add')).join(', ')}`);
}
if (typeof addJobOfferHandler !== 'function') {
  throw new Error(`placementController.addJobOffer is not a function (got ${typeof addJobOfferHandler})`);
}
router.get('/job-offers', authenticateToken, authorizeRoles('admin', 'superadmin'), getAllJobOffersHandler);
router.post('/job-offers', authenticateToken, authorizeRoles('admin', 'superadmin'), addJobOfferHandler);
router.put('/job-offers/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.updateJobOffer);

// Dashboard Stats
router.get('/dashboard/stats', authenticateToken, authorizeRoles('admin', 'superadmin'), placementController.getDashboardStats);

module.exports = router;
