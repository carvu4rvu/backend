const { analyzeFetchError, logSupabaseFetchFailure } = require('./supabaseDiagnostics');

const FETCH_TIMEOUT_MS = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS) || 45000;
const MAX_RETRIES = Number(process.env.SUPABASE_FETCH_RETRIES) || 3;
const BASE_RETRY_DELAY_MS = Number(process.env.SUPABASE_FETCH_RETRY_DELAY_MS) || 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeAbortSignals(signals) {
  const valid = signals.filter(Boolean);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  try {
    return AbortSignal.any(valid);
  } catch {
    return valid[0];
  }
}

/**
 * Retry-safe fetch for @supabase/supabase-js (REST + Storage).
 * Retries transient network/timeouts; does not retry HTTP 4xx except rate limits.
 */
async function supabaseResilientFetch(url, options = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const signal = mergeAbortSignals([options.signal, timeoutSignal]);

    try {
      const response = await fetch(url, { ...options, signal });

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        console.warn(`[supabase-fetch] rate limited (429), retry in ${delay}ms`);
        await sleep(delay);
        continue;
      }

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        console.warn(`[supabase-fetch] server ${response.status}, retry in ${delay}ms`);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err;
      const diag = analyzeFetchError(err, {
        url,
        attempt,
        elapsedMs: Date.now() - startedAt,
      });
      logSupabaseFetchFailure(diag);

      if (!diag.retryable || attempt >= MAX_RETRIES) {
        throw err;
      }

      const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
}

module.exports = {
  supabaseResilientFetch,
  FETCH_TIMEOUT_MS,
  MAX_RETRIES,
};
