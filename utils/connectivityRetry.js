/**
 * Exponential backoff for startup / health probes.
 */
async function withExponentialRetry(name, fn, options = {}) {
  const {
    attempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 15000,
    timeoutMs = null,
    onAttemptError = null,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const run = async () => fn(attempt);
      const result =
        timeoutMs != null
          ? await Promise.race([
              run(),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error(`${name} timed out after ${timeoutMs}ms`)),
                  timeoutMs
                )
              ),
            ])
          : await run();

      return { ok: true, result, attempt, latencyMs: Date.now() - startedAt };
    } catch (err) {
      lastError = err;
      const elapsedMs = Date.now() - startedAt;
      if (onAttemptError) {
        onAttemptError({ name, attempt, attempts, err, elapsedMs });
      } else {
        console.error(
          `${name} failed (attempt ${attempt}/${attempts}) after ${elapsedMs}ms:`,
          err.message
        );
      }

      if (attempt >= attempts) break;

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { ok: false, error: lastError, attempts };
}

module.exports = { withExponentialRetry };
