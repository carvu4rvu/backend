const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const studentProfileController = require('../controllers/studentProfileController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// Metadata routes (public - no auth needed)
router.get('/schools', studentProfileController.getSchools);
router.get('/programs', studentProfileController.getPrograms);
router.get('/majors', studentProfileController.getMajors);
router.get('/minors', studentProfileController.getMinors);
router.get('/specializations', studentProfileController.getSpecializations);

// Academy overview (protected - admin/placement use)
router.get('/academy/overview', authenticateToken, studentProfileController.getAcademyOverview);

// Students list for admin (protected)
router.get('/students', authenticateToken, studentProfileController.getStudentsList);

// Add student (single) - admin only
router.post('/students', authenticateToken, authorizeRoles('admin', 'superadmin'), studentProfileController.addStudent);
// Bulk: check duplicates - admin only
router.post('/students/bulk/check-duplicates', authenticateToken, authorizeRoles('admin', 'superadmin'), studentProfileController.checkBulkDuplicates);
// Bulk: insert - admin only
router.post('/students/bulk', authenticateToken, authorizeRoles('admin', 'superadmin'), studentProfileController.bulkInsertStudents);

// Personal Profile specific routes (protected)
router.get('/profile/:usn/personal', authenticateToken, studentProfileController.getPersonalProfile);
router.put('/profile/:usn/personal', authenticateToken, studentProfileController.updatePersonalProfile);

// Contact Profile specific routes (protected)
router.get('/profile/:usn/contact', authenticateToken, studentProfileController.getContactProfile);
router.put('/profile/:usn/contact', authenticateToken, studentProfileController.updateContactProfile);

// Education Profile specific routes (protected)
router.put('/profile/:usn/education', authenticateToken, studentProfileController.updateEducation);

// Academics Profile specific routes (protected)
router.put('/profile/:usn/academics', authenticateToken, studentProfileController.updateAcademics);

// Projects Profile specific routes (protected)
router.get('/profile/:usn/projects', authenticateToken, studentProfileController.getProjects);
router.put('/profile/:usn/projects', authenticateToken, studentProfileController.updateProjects);

// Internships Profile specific routes (protected)
router.get('/profile/:usn/internships', authenticateToken, studentProfileController.getInternships);
router.put('/profile/:usn/internships', authenticateToken, studentProfileController.updateInternships);

// Trainings Profile specific routes (protected)
router.get('/profile/:usn/trainings', authenticateToken, studentProfileController.getTrainingsProfile);
router.put('/profile/:usn/trainings', authenticateToken, studentProfileController.updateTrainingsProfile);

// Certifications Profile specific routes (protected)
router.get('/profile/:usn/certifications', authenticateToken, studentProfileController.getCertifications);
router.put('/profile/:usn/certifications', authenticateToken, studentProfileController.updateCertifications);

// Parent / Guardian Details (family) specific routes (protected)
router.get('/profile/:usn/family', authenticateToken, studentProfileController.getParentDetails);
router.put('/profile/:usn/family', authenticateToken, studentProfileController.updateParentDetails);

// Extra-Curricular Activities Profile specific routes (protected)
router.get('/profile/:usn/extra-curricular', authenticateToken, studentProfileController.getExtraCurricular);
router.put('/profile/:usn/extra-curricular', authenticateToken, studentProfileController.updateExtraCurricular);

// Capstone Profile specific routes (protected)
router.get('/profile/:usn/capstone', authenticateToken, studentProfileController.getCapstone);
router.put('/profile/:usn/capstone', authenticateToken, studentProfileController.updateCapstone);

// Publications Profile specific routes (protected)
router.get('/profile/:usn/publications', authenticateToken, studentProfileController.getPublicationsProfile);
router.put('/profile/:usn/publications', authenticateToken, studentProfileController.updatePublications);

// Other Experiences Profile specific routes (protected)
router.get('/profile/:usn/other-experiences', authenticateToken, studentProfileController.getOtherExperiences);
router.put('/profile/:usn/other-experiences', authenticateToken, studentProfileController.updateOtherExperiences);

// Summer Immersion (1:N, policy-gated; handled in studentProfileController)
router.get('/profile/:usn/summer-immersion', authenticateToken, studentProfileController.getSummerImmersion);
router.put('/profile/:usn/summer-immersion', authenticateToken, studentProfileController.updateSummerImmersion);
router.get('/profile/:usn/summer_immersion', authenticateToken, studentProfileController.getSummerImmersion);
router.put('/profile/:usn/summer_immersion', authenticateToken, studentProfileController.updateSummerImmersion);

// General routes (protected)
router.get('/profile/:usn', authenticateToken, studentController.getProfile);
router.get('/profile/:usn/:section', authenticateToken, studentController.getProfileSection);
router.put('/profile/:usn/:section', authenticateToken, studentController.updateProfileSection);

module.exports = router;
