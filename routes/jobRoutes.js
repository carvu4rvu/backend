/**
 * Job Routes
 * 
 * API endpoints for managing and triggering background jobs
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');
const { syncEligibility } = require('../jobs/eligibilitySync');
const { getJobsStatus, stopJob, startJob } = require('../jobs/scheduler');
const logger = require('../utils/logger');

/**
 * GET /api/jobs/status
 * Get status of all scheduled jobs
 */
router.get('/status', authenticateToken, authorizeRoles('admin'), (req, res) => {
  try {
    const status = getJobsStatus();
    res.json({ jobs: status });
  } catch (error) {
    logger.error('[JobRoutes] Error getting job status:', error);
    res.status(500).json({ message: 'Failed to get job status' });
  }
});

/**
 * POST /api/jobs/eligibility-sync
 * Manually trigger the eligibility sync job
 */
router.post('/eligibility-sync', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { dryRun = false } = req.body;
    
    logger.info(`[JobRoutes] Manual eligibility sync triggered by admin (dryRun: ${dryRun})`);
    
    const result = await syncEligibility({ dryRun });
    
    res.json({
      success: true,
      message: dryRun 
        ? `Dry run complete. Would update ${result.studentsUpdated} students across ${result.updates.length} batches.`
        : `Sync complete. Updated ${result.studentsUpdated} students across ${result.updates.length} batches.`,
      ...result
    });
  } catch (error) {
    logger.error('[JobRoutes] Manual eligibility sync failed:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Eligibility sync failed' 
    });
  }
});

/**
 * POST /api/jobs/eligibility-sync/preview
 * Preview what the eligibility sync would do (dry run)
 */
router.post('/eligibility-sync/preview', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    logger.info('[JobRoutes] Eligibility sync preview requested');
    
    const result = await syncEligibility({ dryRun: true });
    
    res.json({
      success: true,
      message: `Preview: Would update ${result.studentsUpdated} students across ${result.updates.length} batches`,
      ...result
    });
  } catch (error) {
    logger.error('[JobRoutes] Eligibility sync preview failed:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Preview failed' 
    });
  }
});

/**
 * POST /api/jobs/:jobName/stop
 * Stop a scheduled job
 */
router.post('/:jobName/stop', authenticateToken, authorizeRoles('admin'), (req, res) => {
  try {
    const { jobName } = req.params;
    const stopped = stopJob(jobName);
    
    if (stopped) {
      res.json({ success: true, message: `Job '${jobName}' stopped` });
    } else {
      res.status(404).json({ success: false, message: `Job '${jobName}' not found` });
    }
  } catch (error) {
    logger.error('[JobRoutes] Error stopping job:', error);
    res.status(500).json({ message: 'Failed to stop job' });
  }
});

/**
 * POST /api/jobs/:jobName/start
 * Start a scheduled job
 */
router.post('/:jobName/start', authenticateToken, authorizeRoles('admin'), (req, res) => {
  try {
    const { jobName } = req.params;
    const started = startJob(jobName);
    
    if (started) {
      res.json({ success: true, message: `Job '${jobName}' started` });
    } else {
      res.status(404).json({ success: false, message: `Job '${jobName}' not found` });
    }
  } catch (error) {
    logger.error('[JobRoutes] Error starting job:', error);
    res.status(500).json({ message: 'Failed to start job' });
  }
});

module.exports = router;
