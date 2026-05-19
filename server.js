require('dotenv').config({ quiet: true, override: true });

// Global error handlers - log why process exits/crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException - process will exit:', err?.message || err);
  console.error(err?.stack || err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[WARN] unhandledRejection (process continues):', reason?.message || reason);
  if (reason && typeof reason === 'object' && reason.stack) {
    console.error(reason.stack);
  }
});

async function shutdown(signal) {
  console.log(`[SERVER] ${signal} received - shutting down`);
  await gracefulPoolShutdown();
  process.exit(0);
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(() => process.exit(0));
});

process.on('SIGINT', () => {
  shutdown('SIGINT').catch(() => process.exit(0));
});

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const pool = require('./config/db');
const { gracefulPoolShutdown } = require('./config/db');
const { isUsingSendGrid } = require('./services/emailService');
const { withExponentialRetry } = require('./utils/connectivityRetry');
const { probeStorageAtStartup } = require('./services/supabaseHealthService');
const { validateDatabaseUrl } = require('./utils/supabaseDiagnostics');

// hello

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL;

// Middleware
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(morgan('dev')); // Log requests

// Use JSON body parser for non-multipart requests only (so file uploads work)
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.startsWith('multipart/form-data')) {
    return next();
  }
  return express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from public directory
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Set CORS headers for static files
    res.set('Access-Control-Allow-Origin', FRONTEND_URL);
    res.set('Access-Control-Allow-Credentials', 'true');
    
    // Set appropriate content type for images
    if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      res.set('Content-Type', 'image/jpeg');
    } else if (filePath.endsWith('.png')) {
      res.set('Content-Type', 'image/png');
    } else if (filePath.endsWith('.gif')) {
      res.set('Content-Type', 'image/gif');
    } else if (filePath.endsWith('.webp')) {
      res.set('Content-Type', 'image/webp');
    } else if (filePath.endsWith('.pdf')) {
      res.set('Content-Type', 'application/pdf');
    }
  }
}));

// Routes
const testRoutes = require('./routes/testRoutes');
const authRoutes = require('./routes/authRoutes');
const placementRoutes = require('./routes/placementRoutes');
const studentRoutes = require('./routes/studentRoutes');
const { authenticateToken } = require('./middleware/authMiddleware');
const projectController = require('./controllers/projectController');
const projectRoutes = require('./routes/projectRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const eventsRoutes = require('./routes/eventsRoutes');
const companyRoutes = require('./routes/companyRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const adminRoutes = require('./routes/adminRoutes');
const ensureProfileImageColumn = require('./migrations/ensureProfileImage');
const ensureResumeFileColumn = require('./migrations/ensureResumeFileColumn');
const ensureIsApprovedColumn = require('./migrations/ensureIsApprovedColumn');
const ensureAlumniLikedProjectIds = require('./migrations/ensureAlumniLikedProjectIds');
const ensureEventsStatusColumn = require('./migrations/ensureEventsStatusColumn');
const ensureEligibilityCriteriaColumn = require('./migrations/ensureEligibilityCriteriaColumn');
const ensureNotificationNodesRecipientEntityId = require('./migrations/ensureNotificationNodesRecipientEntityId');
const ensureProjectsVisibilityPublicLink = require('./migrations/ensureProjectsVisibilityPublicLink');
const ensurePlacementPerformanceIndexes = require('./migrations/ensurePlacementPerformanceIndexes');
const ensurePlacementReportsTable = require('./migrations/ensurePlacementReportsTable');
app.use('/api/test', testRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/placement', placementRoutes);
app.use('/api/student', studentRoutes);
// Direct share route (avoids router ordering issues)
app.post('/api/projects/:id/share', (req, res, next) => {
  console.log('[server] POST /api/projects/:id/share direct route hit', req.params.id);
  next();
}, authenticateToken, projectController.createShareLink);
app.use('/api/projects', projectRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => {
  res.send('health');
});

app.get('/api/health', async (req, res) => {
  const { checkPostgres, checkStorage } = require('./services/supabaseHealthService');
  const [database, storage] = await Promise.all([
    checkPostgres(),
    checkStorage({ attempts: 1, timeoutMs: 8000 }),
  ]);
  const status =
    database.status === 'ok' && storage.status === 'ok'
      ? 'ok'
      : database.status === 'ok'
        ? 'degraded'
        : 'unhealthy';
  res.status(status === 'unhealthy' ? 503 : 200).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: { status: database.status, latencyMs: database.latencyMs },
    storage: { status: storage.status, latencyMs: storage.latencyMs },
  });
});

// Debug: verify backend is reachable
app.get('/api/share-debug', (req, res) => {
  console.log('[server] GET /api/share-debug hit');
  res.json({ ok: true, message: 'Backend reachable' });
});

// 404 handler - must be last; return JSON for unmatched routes (helps debug)
app.use((req, res) => {
  console.warn('[404] No route matched:', req.method, req.originalUrl);
  res.set('Content-Type', 'application/json');
  res.status(404).json({
    success: false,
    message: `Not found: ${req.method} ${req.originalUrl}`,
    errorCode: 'NOT_FOUND',
  });
});

const server = app.listen(PORT, '0.0.0.0', async () => {
  const fs = require('fs');
  const path = require('path');

  try {
    console.log(`Server listening on 0.0.0.0:${PORT}`);

    const dbUrlCheck = validateDatabaseUrl(process.env.DATABASE_URL);
    if (dbUrlCheck.warning) {
      console.warn(`[startup] ${dbUrlCheck.warning}`);
    }

    if (process.env.NODE_ENV === 'production') {
      const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];
      const missing = required.filter((k) => !process.env[k]);
      if (missing.length) {
        throw new Error(`Missing required env vars: ${missing.join(', ')}`);
      }
    }

    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
      console.log('Created public directory ✅');
    } else {
      console.log('Public directory exists ✅');
    }

    const dbProbe = await withExponentialRetry(
      'database',
      async () => {
        const client = await pool.connect();
        try {
          await client.query('SELECT 1');
        } finally {
          client.release();
        }
      },
      {
        attempts: 5,
        baseDelayMs: 1500,
        timeoutMs: 10000,
        onAttemptError: ({ attempt, attempts, err, elapsedMs }) => {
          console.error(
            `database connect failed (attempt ${attempt}/${attempts}) after ${elapsedMs}ms:`,
            err.message
          );
        },
      }
    );

    if (!dbProbe.ok) {
      throw dbProbe.error || new Error('database connection failed');
    }
    console.log(`database connected ✅ (${dbProbe.latencyMs}ms)`);

    await ensureProfileImageColumn();
    await ensureResumeFileColumn();
    await ensureIsApprovedColumn();
    await ensureAlumniLikedProjectIds();
    await ensureEventsStatusColumn();
    await ensureEligibilityCriteriaColumn();
    await ensureNotificationNodesRecipientEntityId();
    await ensureProjectsVisibilityPublicLink();
    try {
      await ensurePlacementPerformanceIndexes();
    } catch (idxErr) {
      console.warn('[startup] placement performance indexes:', idxErr.message);
    }
    await ensurePlacementReportsTable();

    // Storage is optional at startup — never terminate the process if REST/Storage is down.
    await probeStorageAtStartup();

    if (process.env.NODE_ENV !== 'production' && !isUsingSendGrid()) {
      const smtpProbe = await withExponentialRetry(
        'smtp',
        async () => {
          const transporter = require('./config/smtp');
          await transporter.verify();
        },
        { attempts: 3, baseDelayMs: 2000 }
      );
      if (smtpProbe.ok) {
        console.log(`smtp connected ✅ (${smtpProbe.latencyMs}ms)`);
      } else {
        console.warn('[startup] smtp unavailable; email features may fail until SMTP is reachable');
      }
    }
  } catch (err) {
    console.error('Startup failed:', err.message);
    server.close(() => {
      process.exit(1);
    });
  }
});
