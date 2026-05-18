const dns = require('dns').promises;

/**
 * Network troubleshooting for Supabase REST/Storage (HTTPS to *.supabase.co).
 * If connect timeouts persist, prefer IPv4:
 *   NODE_OPTIONS=--dns-result-order=ipv4first
 * (PowerShell: $env:NODE_OPTIONS="--dns-result-order=ipv4first")
 */

function parseHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isRetryableNetworkError(err) {
  if (!err) return false;
  const msg = `${err.message || ''} ${err.cause?.message || ''} ${err.code || ''}`.toLowerCase();
  const retryableCodes = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    'UND_ERR_HEADERS_TIMEOUT',
  ]);
  if (err.code && retryableCodes.has(err.code)) return true;
  if (err.cause?.code && retryableCodes.has(err.cause.code)) return true;
  if (msg.includes('fetch failed')) return true;
  if (msg.includes('connect timeout')) return true;
  if (msg.includes('network')) return true;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  return false;
}

function classifySupabaseError(error, context = {}) {
  const message = error?.message || String(error);
  const status = error?.status ?? error?.statusCode;
  const causeMsg = error?.cause?.message || '';
  const combined = `${message} ${causeMsg}`.toLowerCase();

  if (status === 401 || status === 403 || combined.includes('invalid api key') || combined.includes('jwt')) {
    return {
      code: 'AUTH',
      retryable: false,
      userMessage: 'Storage authentication failed. Check SUPABASE_SERVICE_ROLE_KEY.',
    };
  }

  if (status === 404 || combined.includes('bucket not found') || combined.includes('not found')) {
    return {
      code: 'BUCKET',
      retryable: false,
      userMessage: 'Storage bucket or object was not found.',
    };
  }

  if (
    combined.includes('timeout') ||
    combined.includes('connect timeout') ||
    error?.name === 'AbortError' ||
    error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return {
      code: 'TIMEOUT',
      retryable: true,
      userMessage: 'Storage request timed out. Please try again in a moment.',
    };
  }

  if (isRetryableNetworkError(error)) {
    return {
      code: 'NETWORK',
      retryable: true,
      userMessage: 'Storage is temporarily unreachable. Please try again shortly.',
    };
  }

  return {
    code: 'UNKNOWN',
    retryable: isRetryableNetworkError(error),
    userMessage: 'Storage operation failed. Please try again.',
  };
}

function analyzeFetchError(err, { url, attempt, elapsedMs }) {
  const hostname = parseHostname(url);
  const cause = err?.cause;
  return {
    type: 'fetch',
    hostname,
    url: url ? String(url).replace(/\/\/[^@]+@/, '//***@') : undefined,
    attempt,
    elapsedMs,
    message: err?.message,
    causeMessage: cause?.message,
    causeCode: cause?.code,
    errorName: err?.name,
    retryable: isRetryableNetworkError(err),
    ipv6Hint:
      cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
      (cause?.message || '').includes('2405:') ||
      (cause?.message || '').includes('::'),
  };
}

function logSupabaseFetchFailure(diag) {
  const parts = [
    '[supabase-fetch]',
    diag.hostname ? `host=${diag.hostname}` : null,
    diag.attempt ? `attempt=${diag.attempt}` : null,
    diag.elapsedMs != null ? `elapsedMs=${diag.elapsedMs}` : null,
    diag.message ? `error=${diag.message}` : null,
    diag.causeCode ? `causeCode=${diag.causeCode}` : null,
    diag.causeMessage ? `cause=${diag.causeMessage}` : null,
    diag.ipv6Hint ? 'hint=try NODE_OPTIONS=--dns-result-order=ipv4first' : null,
  ].filter(Boolean);
  console.warn(parts.join(' '));
}

function logStorageOperationFailure(operation, details) {
  console.warn(
    `[storage] ${operation} failed`,
    details.code ? `code=${details.code}` : '',
    details.bucket ? `bucket=${details.bucket}` : '',
    details.path ? `path=${details.path}` : '',
    details.message || ''
  );
}

async function resolveHostDiagnostics(hostname) {
  if (!hostname) {
    return { hostname: null, resolved: false, addresses: [], error: 'invalid hostname' };
  }
  const start = Date.now();
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    return {
      hostname,
      resolved: true,
      latencyMs: Date.now() - start,
      addresses: results.map((r) => ({ address: r.address, family: r.family })),
    };
  } catch (err) {
    return {
      hostname,
      resolved: false,
      latencyMs: Date.now() - start,
      error: err.message,
      addresses: [],
    };
  }
}

function validateDatabaseUrl(connectionString) {
  if (!connectionString) {
    return { ok: false, warning: 'DATABASE_URL is not set' };
  }
  const usesPooler = connectionString.includes('pooler.supabase.com');
  const usesDirectDb = /\.supabase\.co(?!.*pooler)/i.test(connectionString) && !usesPooler;
  if (process.env.NODE_ENV === 'production' && usesDirectDb) {
    return {
      ok: false,
      warning:
        'DATABASE_URL appears to use direct db host. Use Transaction Pooler (pooler.supabase.com:6543) for backend traffic.',
    };
  }
  if (!usesPooler && connectionString.includes('supabase')) {
    return {
      ok: true,
      warning:
        'DATABASE_URL does not use pooler.supabase.com. Recommended: Supabase Dashboard → Database → Transaction Pooler URL.',
    };
  }
  return { ok: true, warning: null };
}

module.exports = {
  parseHostname,
  isRetryableNetworkError,
  classifySupabaseError,
  analyzeFetchError,
  logSupabaseFetchFailure,
  logStorageOperationFailure,
  resolveHostDiagnostics,
  validateDatabaseUrl,
};
