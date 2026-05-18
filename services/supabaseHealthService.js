const pool = require('../config/db');
const supabase = require('../config/supabaseClient');
const { getSupabaseConfigStatus } = require('../config/supabaseClient');
const {
  classifySupabaseError,
  resolveHostDiagnostics,
  validateDatabaseUrl,
  parseHostname,
} = require('../utils/supabaseDiagnostics');
const { withExponentialRetry } = require('../utils/connectivityRetry');
const { FETCH_TIMEOUT_MS } = require('../utils/supabaseResilientFetch');

async function checkPostgres() {
  const dbUrlCheck = validateDatabaseUrl(process.env.DATABASE_URL);
  const startedAt = Date.now();

  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1 AS ok');
      return {
        status: 'ok',
        latencyMs: Date.now() - startedAt,
        poolerRecommendation: dbUrlCheck.warning,
        usesPooler: (process.env.DATABASE_URL || '').includes('pooler.supabase.com'),
      };
    } finally {
      client.release();
    }
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - startedAt,
      message: err.message,
      poolerRecommendation: dbUrlCheck.warning,
    };
  }
}

async function checkStorage(options = {}) {
  const { attempts = 2, timeoutMs = Math.min(FETCH_TIMEOUT_MS, 30000) } = options;
  const supabaseStatus = getSupabaseConfigStatus();
  const hostname = parseHostname(supabaseStatus.url);
  const dns = await resolveHostDiagnostics(hostname);
  const startedAt = Date.now();

  const probe = await withExponentialRetry(
    'supabase-storage',
    async () => {
      const { data, error } = await supabase.storage.listBuckets();
      if (error) throw error;
      return data;
    },
    { attempts, baseDelayMs: 1500, timeoutMs }
  );

  const latencyMs = Date.now() - startedAt;

  if (!probe.ok) {
    const classified = classifySupabaseError(probe.error);
    return {
      status: 'error',
      latencyMs,
      configured: supabaseStatus.configured,
      hostname,
      dns,
      error: {
        message: probe.error?.message,
        code: classified.code,
        retryable: classified.retryable,
        userMessage: classified.userMessage,
        cause: probe.error?.cause?.message,
        causeCode: probe.error?.cause?.code,
      },
      fetchTimeoutMs: FETCH_TIMEOUT_MS,
      ipv4Fallback:
        'Set NODE_OPTIONS=--dns-result-order=ipv4first if ConnectTimeoutError mentions IPv6 addresses.',
    };
  }

  const buckets = probe.result || [];
  return {
    status: 'ok',
    latencyMs,
    configured: supabaseStatus.configured,
    hostname,
    dns,
    bucketCount: buckets.length,
    buckets: buckets.map((b) => ({ id: b.id, name: b.name, public: b.public })),
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
  };
}

async function getFullConnectivityReport() {
  const [database, storage] = await Promise.all([
    checkPostgres(),
    checkStorage({ attempts: 2 }),
  ]);

  const overall =
    database.status === 'ok' && storage.status === 'ok'
      ? 'healthy'
      : database.status === 'ok'
        ? 'degraded'
        : 'unhealthy';

  return {
    timestamp: new Date().toISOString(),
    overall,
    database,
    storage,
    supabase: getSupabaseConfigStatus(),
    node: {
      version: process.version,
      dnsResultOrder: process.env.NODE_OPTIONS?.includes('dns-result-order=ipv4first')
        ? 'ipv4first'
        : 'default',
    },
  };
}

/**
 * Startup probe: never throws — returns status for logging only.
 */
async function probeStorageAtStartup() {
  const result = await checkStorage({ attempts: 3, timeoutMs: 20000 });
  if (result.status === 'ok') {
    console.log(
      `supabase storage connected ✅ (${result.latencyMs}ms, ${result.bucketCount} buckets)`
    );
    return { ok: true, result };
  }

  console.error('[startup] supabase storage unavailable — continuing without storage');
  console.error('[startup] storage diagnostics:', JSON.stringify({
    hostname: result.hostname,
    error: result.error,
    dns: result.dns,
    ipv4Fallback: result.ipv4Fallback,
  }, null, 2));

  return { ok: false, result };
}

module.exports = {
  checkPostgres,
  checkStorage,
  getFullConnectivityReport,
  probeStorageAtStartup,
};
