const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { getPoolConfig } = require('../config/db');
const { getSupabaseConfigStatus } = require('../config/supabaseClient');
const {
  getFullConnectivityReport,
  checkPostgres,
  checkStorage,
} = require('../services/supabaseHealthService');

router.get('/supabase-test', async (req, res) => {
  const startedAt = Date.now();
  try {
    const report = await getFullConnectivityReport();
    const httpStatus =
      report.overall === 'healthy' ? 200 : report.database.status === 'ok' ? 200 : 503;

    res.status(httpStatus).json({
      ...report,
      probeLatencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    res.status(500).json({
      overall: 'error',
      message: err.message,
      probeLatencyMs: Date.now() - startedAt,
    });
  }
});

router.get('/db-test', async (req, res) => {
  const result = await checkPostgres();
  if (result.status === 'ok') {
    return res.json({
      message: 'Database connection successful',
      ...result,
      pool: getPoolConfig(),
    });
  }
  res.status(503).json({
    message: 'Database connection failed',
    ...result,
    pool: getPoolConfig(),
  });
});

router.get('/storage-test', async (req, res) => {
  const result = await checkStorage({ attempts: 2 });
  const status = result.status === 'ok' ? 200 : 503;
  res.status(status).json({
    message: result.status === 'ok' ? 'Storage connection successful' : 'Storage unavailable',
    supabase: getSupabaseConfigStatus(),
    ...result,
  });
});

router.get('/db-test-legacy', async (req, res) => {
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
