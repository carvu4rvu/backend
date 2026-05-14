require('dotenv').config({ quiet: true, override: true });

// Global error handlers - log why process exits/crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException - process will exit:', err?.message || err);
  console.error(err?.stack || err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] unhandledRejection - promise:', promise);
  console.error('[FATAL] reason:', reason?.message || reason);
  if (reason && typeof reason === 'object' && reason.stack) {
    console.error(reason.stack);
  }
});

process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received - shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SERVER] SIGINT received - shutting down');
  process.exit(0);
});

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const pool = require('./config/db');
const supabase = require('./config/supabaseClient');
const { isUsingSendGrid } = require('./services/emailService');

// hello

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

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
const ensureNotificationNodesRecipientEntityId = require('./migrations/ensureNotificationNodesRecipientEntityId');
const ensureProjectsVisibilityPublicLink = require('./migrations/ensureProjectsVisibilityPublicLink');
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

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
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

  const connectWithRetry = async (name, connectFn, attempts = 3) => {
    for (let i = 1; i <= attempts; i++) {
      try {
        await connectFn();
        console.log(`${name} connected ✅`);
        return;
      } catch (err) {
        console.error(`${name} connect failed (Attempt ${i}/${attempts}) ❌`, err.message);
        if (i === attempts) {
          throw new Error(`${name} failed after ${attempts} attempts: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  };

  try {
    console.log(`Server listening on 0.0.0.0:${PORT}`);

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

    await connectWithRetry('database', async () => {
      const client = await pool.connect();
      client.release();
    });

    await ensureProfileImageColumn();
    await ensureResumeFileColumn();
    await ensureIsApprovedColumn();
    await ensureAlumniLikedProjectIds();
    await ensureEventsStatusColumn();
    await ensureNotificationNodesRecipientEntityId();
    await ensureProjectsVisibilityPublicLink();

    if (process.env.NODE_ENV === 'production') {
      await connectWithRetry('supabase storage', async () => {
        const { error } = await supabase.storage.listBuckets();
        if (error) throw error;
      });
    } else {
      try {
        await connectWithRetry('supabase storage', async () => {
          const { error } = await supabase.storage.listBuckets();
          if (error) throw error;
        });
      } catch (err) {
        console.warn('[startup] supabase storage unavailable in development; continuing without storage health check');
      }
    }

    if (process.env.NODE_ENV !== 'production' && !isUsingSendGrid()) {
      const transporter = require('./config/smtp');
      await connectWithRetry('smtp', async () => {
        await transporter.verify();
      });
    }
  } catch (err) {
    console.error('Startup failed:', err.message);
    server.close(() => {
      process.exit(1);
    });
  }
});
