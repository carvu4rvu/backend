const express = require('express');
const router = express.Router();
const placementController = require('../controllers/placementController');
const emailRecipientsController = require('../controllers/emailRecipientsController');
const violationsController = require('../controllers/violationsController');
const studentEditControlController = require('../controllers/studentEditControlController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// Validate critical middleware/handlers (avoids cryptic "argument handler must be a function" crash)
if (typeof authenticateToken !== 'function') throw new Error('authMiddleware.authenticateToken is not a function');
if (typeof authorizeRoles !== 'function') throw new Error('authMiddleware.authorizeRoles is not a function');

router.get('/student/:usn/applications', authenticateToken, placementController.getStudentApplications);
router.get('/offers/:usn', authenticateToken, placementController.getStudentOffers);
router.patch('/offers/decision', authenticateToken, placementController.submitOfferDecision);
router.get('/process/list', authenticateToken, authorizeRoles('admin'), placementController.getAllProcessList);
router.patch('/process/:id', authenticateToken, authorizeRoles('admin'), placementController.updateProcessStatus);
router.get('/drives', authenticateToken, placementController.getAllDrives);
router.post('/drives/sync-status', authenticateToken, authorizeRoles('admin'), placementController.syncDriveStatuses);
router.get('/drives/:driveId/registrations', authenticateToken, authorizeRoles('admin'), placementController.getDriveRegistrations);
router.get('/drives/:driveId/export', authenticateToken, authorizeRoles('admin'), placementController.getDriveExportData);
router.delete('/drives/:driveId/registrations/:usn', authenticateToken, authorizeRoles('admin'), placementController.removeFromProcess);
router.get('/drives/:driveId/eligibility', authenticateToken, placementController.getDriveEligibility);
router.put('/drives/:driveId/eligibility', authenticateToken, authorizeRoles('admin'), placementController.upsertDriveEligibility);
router.get('/drives/:id', authenticateToken, placementController.getDriveById);
router.post('/drives', authenticateToken, authorizeRoles('admin'), placementController.addPlacementDrive);
router.put('/drives/:id', authenticateToken, authorizeRoles('admin'), placementController.updatePlacementDrive);
router.patch('/drives/:id', authenticateToken, authorizeRoles('admin'), placementController.patchPlacementDrive);
router.patch('/drives/:id/status', authenticateToken, authorizeRoles('admin'), placementController.updatePlacementDriveStatusOnly);
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

router.get('/students', authenticateToken, authorizeRoles('admin', 'vc'), placementController.getStudentsForPlacement);
router.get('/students/overview', authenticateToken, placementController.getPlacementOverview);
router.get('/students/overview-table', authenticateToken, authorizeRoles('admin'), placementController.getStudentsOverviewTable);
router.get('/students/eligibility', authenticateToken, authorizeRoles('admin'), placementController.getStudentsEligibility);
router.put('/students/eligibility/bulk', authenticateToken, authorizeRoles('admin'), placementController.bulkUpdateStudentEligibility);
router.put('/students/:usn/eligibility', authenticateToken, authorizeRoles('admin'), placementController.updateStudentEligibility);

// Student edit control (profile locks) - admin only
router.get(
  '/students/profile-locks',
  authenticateToken,
  authorizeRoles('admin'),
  studentEditControlController.getProfileLocks
);
router.post(
  '/students/profile-locks/sync',
  authenticateToken,
  authorizeRoles('admin'),
  studentEditControlController.syncProfileLocks
);
router.put(
  '/students/profile-locks/:usn',
  authenticateToken,
  authorizeRoles('admin'),
  studentEditControlController.updateProfileLocks
);
router.get(
  '/students/:usn/edit-control',
  authenticateToken,
  authorizeRoles('admin', 'vc'),
  studentEditControlController.getEditControlByUsn
);
router.get('/policies', authenticateToken, placementController.getAllPolicies);
router.get('/policies/me', authenticateToken, placementController.getMyPolicy);
router.post('/policies', authenticateToken, placementController.upsertPolicy);
router.post('/policies/sync', authenticateToken, placementController.syncPolicies);

// Email recipients for bulk email (filter by category: students, parents, alumni, staff)
router.get('/email-recipients', authenticateToken, emailRecipientsController.getEmailRecipients);

// Projects: alumni feed, view increment, like (alumni or authenticated)
router.get('/projects/alumni', authenticateToken, authorizeRoles('alumni'), placementController.getAlumniProjects);
router.post('/projects/:id/view', placementController.incrementProjectView);
router.post('/projects/:id/like', authenticateToken, placementController.toggleProjectLike);

// Alumni (me before :identifier; codes before :identifier to avoid matching "codes" as id)
router.get('/alumni/me', authenticateToken, authorizeRoles('alumni'), placementController.getAlumniMe);
router.put('/alumni/me', authenticateToken, authorizeRoles('alumni'), placementController.updateAlumniMe);
// Alumni: HR Recommendations
router.post('/alumni/hr-recommendations', authenticateToken, authorizeRoles('alumni'), placementController.submitHrRecommendation);
router.get('/alumni/hr-recommendations', authenticateToken, authorizeRoles('alumni'), placementController.getMyHrRecommendations);
// Alumni: view student profile (limited access)
router.get('/alumni/student/:usn', authenticateToken, authorizeRoles('alumni'), placementController.getStudentProfileForAlumni);
router.post('/alumni/connect', authenticateToken, authorizeRoles('alumni'), placementController.createAlumniConnectionRequest);
router.get('/alumni', authenticateToken, placementController.getAllAlumni);
router.post('/alumni', authenticateToken, placementController.addAlumni);
router.get('/alumni/codes', authenticateToken, placementController.getRegistrationCodes);
router.post('/alumni/codes', authenticateToken, placementController.createRegistrationCode);
router.delete('/alumni/codes/:id', authenticateToken, placementController.deleteRegistrationCode);
router.get('/alumni/conversions', authenticateToken, placementController.getAlumniConversions);
router.get('/alumni/conversion-logs', authenticateToken, authorizeRoles('admin'), placementController.getAlumniConversionLogs);
router.post('/alumni/convert', authenticateToken, authorizeRoles('admin'), placementController.convertToAlumni);
router.get('/alumni/:identifier', authenticateToken, placementController.getAlumniByIdOrUsn);
router.put('/alumni/:identifier', authenticateToken, placementController.updateAlumni);

// Violations: eligibility logs, placement violations, disciplinary records
router.get('/violations/eligibility-logs', authenticateToken, authorizeRoles('admin'), violationsController.getEligibilityDecisionLogs);
router.get('/violations/placement-violations', authenticateToken, authorizeRoles('admin'), violationsController.getPlacementViolations);
router.get('/violations/disciplinary-records', authenticateToken, authorizeRoles('admin'), violationsController.getDisciplinaryRecords);
router.post('/violations/eligibility-logs', authenticateToken, authorizeRoles('admin'), violationsController.createEligibilityDecisionLog);
router.post('/violations/placement-violations', authenticateToken, authorizeRoles('admin'), violationsController.createPlacementViolation);
router.post('/violations/disciplinary-records', authenticateToken, authorizeRoles('admin'), violationsController.createDisciplinaryRecord);

// Job Offers - ensure handlers exist before registering (avoids "argument handler must be a function" crash)
const getAllJobOffersHandler = placementController.getAllJobOffers;
const addJobOfferHandler = placementController.addJobOffer;
if (typeof getAllJobOffersHandler !== 'function') {
  throw new Error(`placementController.getAllJobOffers is not a function (got ${typeof getAllJobOffersHandler}). Available: ${Object.keys(placementController).filter(k => k.startsWith('get') || k.startsWith('add')).join(', ')}`);
}
if (typeof addJobOfferHandler !== 'function') {
  throw new Error(`placementController.addJobOffer is not a function (got ${typeof addJobOfferHandler})`);
}
router.get('/job-offers', authenticateToken, authorizeRoles('admin', 'vc'), getAllJobOffersHandler);
router.post('/job-offers', authenticateToken, authorizeRoles('admin'), addJobOfferHandler);
router.put('/job-offers/:id', authenticateToken, authorizeRoles('admin'), placementController.updateJobOffer);

// Dashboard Stats (admin and VC - VC can only view dashboard)
router.get('/dashboard/stats', authenticateToken, authorizeRoles('admin', 'vc'), placementController.getDashboardStats);

// HR Recommendations (admin)
router.get('/hr-recommendations', authenticateToken, authorizeRoles('admin'), placementController.getAllHrRecommendations);

module.exports = router;
