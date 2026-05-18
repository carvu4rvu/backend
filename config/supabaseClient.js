const dns = require('dns');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

if (
  process.env.SUPABASE_PREFER_IPV4 === '1' ||
  process.env.SUPABASE_PREFER_IPV4 === 'true' ||
  (process.env.NODE_OPTIONS || '').includes('dns-result-order=ipv4first')
) {
  dns.setDefaultResultOrder('ipv4first');
  console.log('[supabase] DNS result order: ipv4first');
}
const { supabaseResilientFetch } = require('../utils/supabaseResilientFetch');
const { parseHostname } = require('../utils/supabaseDiagnostics');

/**
 * Supabase REST + Storage client (HTTPS to SUPABASE_URL).
 * Postgres uses DATABASE_URL + pg Pool separately (pooler.supabase.com).
 *
 * Network: if you see ConnectTimeoutError / fetch failed to *.supabase.co,
 * try IPv4-first DNS:
 *   NODE_OPTIONS=--dns-result-order=ipv4first
 */

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabaseConfigStatus() {
  return {
    configured: Boolean(supabaseUrl && supabaseKey),
    url: supabaseUrl || null,
    hostname: parseHostname(supabaseUrl),
    hasServiceRoleKey: Boolean(supabaseKey),
  };
}

const configStatus = getSupabaseConfigStatus();
if (!configStatus.configured) {
  console.warn(
    '[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — storage/REST features will fail until configured.'
  );
} else {
  console.log(`[supabase] client configured host=${configStatus.hostname}`);
}

const supabase = createClient(supabaseUrl || 'http://localhost', supabaseKey || 'missing-key', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: supabaseResilientFetch,
  },
});

module.exports = supabase;
module.exports.getSupabaseConfigStatus = getSupabaseConfigStatus;
