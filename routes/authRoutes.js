const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

router.post('/verify-usn', authController.verifyUSN);
router.post('/register/send-otp', authController.sendCollegeOTP);
router.post('/register/verify-otp', authController.verifyCollegeOTP);
router.post('/register/send-personal-otp', authController.sendPersonalOTP);
router.post('/register/verify-personal-otp', authController.verifyPersonalOTP);
router.post('/register-student', authController.registerStudent);
router.post('/login', authController.login);
router.post('/forgot-password/initiate', authController.forgotPasswordInitiate);
router.post('/forgot-password/verify', authController.forgotPasswordVerify);
router.get('/verify', authenticateToken, authController.verifyToken);

// Admin: User Login Management (admin/superadmin/placement)
router.get('/admin/user-login', authenticateToken, authorizeRoles('admin'), authController.getAdminUserLoginList);
router.get('/admin/students-without-login', authenticateToken, authorizeRoles('admin'), authController.getStudentsWithoutLogin);
router.patch('/admin/user-login/bulk', authenticateToken, authorizeRoles('admin'), authController.patchBulkUserLoginIsActive);
router.patch('/admin/user-login/:id', authenticateToken, authorizeRoles('admin'), authController.patchUserLoginIsActive);

// Admin: Company Login Management
router.get('/admin/company-logins', authenticateToken, authorizeRoles('admin'), authController.getCompanyLogins);
router.post('/admin/company-login', authenticateToken, authorizeRoles('admin'), authController.createCompanyLogin);
router.patch('/admin/company-login/:id', authenticateToken, authorizeRoles('admin'), authController.patchCompanyLoginPassword);
router.delete('/admin/company-login/:id', authenticateToken, authorizeRoles('admin'), authController.deleteCompanyLogin);

// Admin: VC Login Management
router.get('/admin/vc-logins', authenticateToken, authorizeRoles('admin'), authController.getVcLogins);
router.post('/admin/vc-login', authenticateToken, authorizeRoles('admin'), authController.createVcLogin);
router.patch('/admin/vc-login/:id', authenticateToken, authorizeRoles('admin'), authController.patchVcLoginPassword);
router.delete('/admin/vc-login/:id', authenticateToken, authorizeRoles('admin'), authController.deleteVcLogin);

// Alumni registration (no auth required)
router.post('/alumni/validate-code', authController.validateAlumniCode);
router.post('/alumni/send-otp', authController.sendAlumniOtp);
router.post('/alumni/verify-otp', authController.verifyAlumniOtp);
router.post('/alumni/register', authController.registerAlumni);

module.exports = router;
