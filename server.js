require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const pool = require('./config/db');
const supabase = require('./config/supabaseClient');
const transporter = require('./config/smtp');

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

// Routes
const testRoutes = require('./routes/testRoutes');
const authRoutes = require('./routes/authRoutes');
const placementRoutes = require('./routes/placementRoutes');
const studentRoutes = require('./routes/studentRoutes');

app.use('/api/test', testRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/placement', placementRoutes);
app.use('/api/student', studentRoutes);

app.get('/', (req, res) => {
  res.send('Hello from the Backend!');
});

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

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

  // Supabase Storage Connection Check
  await connectWithRetry('supabase storage', async () => {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
  });

  // SMTP Connection Check
  await connectWithRetry('smtp', async () => {
    await transporter.verify();
  });
});
