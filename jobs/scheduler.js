/**
 * Job Scheduler
 * 
 * Manages scheduled background jobs using node-cron
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const { syncEligibility } = require('./eligibilitySync');

// Track scheduled jobs
const scheduledJobs = new Map();

/**
 * Initialize all scheduled jobs
 */
function initializeScheduler() {
  logger.info('[Scheduler] Initializing scheduled jobs...');

  // Eligibility Sync Job - runs every 10 minutes
  const eligibilitySyncJob = cron.schedule('*/10 * * * *', async () => {
    logger.info('[Scheduler] Running eligibility sync job...');
    try {
      const result = await syncEligibility();
      if (result.studentsUpdated > 0) {
        logger.info(`[Scheduler] Eligibility sync complete: ${result.studentsUpdated} students updated`);
      } else {
        logger.info('[Scheduler] Eligibility sync complete: No updates needed');
      }
    } catch (error) {
      logger.error('[Scheduler] Eligibility sync job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata' // Adjust timezone as needed
  });

  scheduledJobs.set('eligibilitySync', {
    job: eligibilitySyncJob,
    interval: '*/10 * * * *',
    description: 'Syncs eligibility flags from policies to students (false → true only)',
    lastRun: null
  });

  logger.info('[Scheduler] All jobs initialized');
  logger.info('[Scheduler] Eligibility sync job scheduled to run every 10 minutes');
}

/**
 * Get status of all scheduled jobs
 */
function getJobsStatus() {
  const status = [];
  for (const [name, info] of scheduledJobs) {
    status.push({
      name,
      interval: info.interval,
      description: info.description,
      lastRun: info.lastRun,
      running: info.job ? true : false
    });
  }
  return status;
}

/**
 * Stop a specific job
 */
function stopJob(name) {
  const jobInfo = scheduledJobs.get(name);
  if (jobInfo && jobInfo.job) {
    jobInfo.job.stop();
    logger.info(`[Scheduler] Job '${name}' stopped`);
    return true;
  }
  return false;
}

/**
 * Start a specific job
 */
function startJob(name) {
  const jobInfo = scheduledJobs.get(name);
  if (jobInfo && jobInfo.job) {
    jobInfo.job.start();
    logger.info(`[Scheduler] Job '${name}' started`);
    return true;
  }
  return false;
}

/**
 * Stop all scheduled jobs
 */
function stopAllJobs() {
  for (const [name, info] of scheduledJobs) {
    if (info.job) {
      info.job.stop();
    }
  }
  logger.info('[Scheduler] All jobs stopped');
}

module.exports = {
  initializeScheduler,
  getJobsStatus,
  stopJob,
  startJob,
  stopAllJobs
};
