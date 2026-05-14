const express = require('express');
const router = express.Router();
const supabase = require('../config/supabaseClient');
const pool = require('../config/db');

// Test Supabase Connection (e.g., list buckets)
router.get('/supabase-test', async (req, res) => {
  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    res.json({ message: 'Supabase connection successful', buckets: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test Database Connection (e.g., get current time)
router.get('/db-test', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    res.json({ message: 'Database connection successful', time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
