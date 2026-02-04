require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const pool = require('./config/db');
const supabase = require('./config/supabaseClient');
const transporter = require('./config/smtp');

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
app.use(express.json());

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
const uploadRoutes = require('./routes/uploadRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const eventsRoutes = require('./routes/eventsRoutes');
const companyRoutes = require('./routes/companyRoutes');
const jobRoutes = require('./routes/jobRoutes');
const ensureProfileImageColumn = require('./migrations/ensureProfileImage');
const ensureResumeFileColumn = require('./migrations/ensureResumeFileColumn');
const ensureIsApprovedColumn = require('./migrations/ensureIsApprovedColumn');
const ensureEventsStatusColumn = require('./migrations/ensureEventsStatusColumn');
const ensureNotificationsEventIdColumn = require('./migrations/ensureNotificationsEventIdColumn');
const ensureNotificationsDriveIdColumn = require('./migrations/ensureNotificationsDriveIdColumn');
const { initializeScheduler } = require('./jobs/scheduler');

app.use('/api/test', testRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/placement', placementRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/jobs', jobRoutes);

app.get('/', (req, res) => {
  res.send('Hello from the Backend!');
});

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  // Ensure public directory exists
  const fs = require('fs');
  const path = require('path');
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    console.log('Created public directory ✅');
  } else {
    console.log('Public directory exists ✅');
  }

  const connectWithRetry = async (name, connectFn, attempts = 3) => {
    for (let i = 1; i <= attempts; i++) {
      try {
        await connectFn();
        console.log(`${name} connected ✅`);
        return;
      } catch (err) {
        console.error(`${name} connect failed (Attempt ${i}/${attempts}) ❌`, err.message);
        if (i === attempts) {
          console.error(`${name} failed after ${attempts} attempts`);
        } else {
          // Wait 2 seconds before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  };

  // Database Connection Check
  await connectWithRetry('database', async () => {
    const client = await pool.connect();
    client.release();
  });

  // Run migrations
  await ensureProfileImageColumn();
  await ensureResumeFileColumn();
  await ensureIsApprovedColumn();
  await ensureEventsStatusColumn();
  await ensureNotificationsEventIdColumn();
  await ensureNotificationsDriveIdColumn();

  // Supabase Storage Connection Check
  await connectWithRetry('supabase storage', async () => {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
  });

  // SMTP Connection Check
  await connectWithRetry('smtp', async () => {
    await transporter.verify();
  });

  // Initialize scheduled jobs (eligibility sync runs every 10 minutes)
  try {
    initializeScheduler();
    console.log('Job scheduler initialized ✅');
  } catch (err) {
    console.error('Job scheduler initialization failed ❌', err.message);
  }
});
