/**
 * @typedef { RequestInit & { maxRetry?: number; delay?: number; revalidate?: number; }} RetryOptions
 */

const isTimeoutError = e =>
  e instanceof Error &&
  typeof e.cause === 'object' &&
  e.cause !== null &&
  'code' in e.cause &&
  e.cause.code === 'ETIMEDOUT';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Does a fetch with retry logic for network errors and timeouts.
 *
 * @param {string} url
 * @param {RetryOptions} [options]
 * @returns {Promise<Response>}
 */
export const fetchWithRetry = async (
  url,
  { maxRetry = 3, delay = 100, revalidate = 3600, ...options } = {}
) => {
  const retries = Math.max(1, Number(maxRetry) || 1);
  const backoff = Math.max(0, Number(delay) || 0);

  const attemptFetch = async attempt => {
    const start = performance.now();
    try {
      const response = await fetch(url, {
        ...options,
        // Default to 1-hour ISR caching via the vinext fetch cache so that
        // data fetches (vulnerabilities, release data, opencollective, etc.)
        // are served from KV on Cloudflare Workers instead of hitting the
        // network on every ISR miss or background revalidation render.
        // Callers can override by passing { revalidate: N } or
        // { cache: 'no-store' } in options.
        next: { revalidate, ...options.next },
        signal: AbortSignal.timeout(30000),
      });
      const ms = (performance.now() - start).toFixed(1);
      console.log(
        `[fetch] ${url} — ${response.status} in ${ms}ms (attempt ${attempt}/${retries})`
      );
      return response;
    } catch (e) {
      const ms = (performance.now() - start).toFixed(1);
      const reason = e instanceof Error ? e.message : String(e);
      console.error(
        `[fetch] ${url} — failed in ${ms}ms (attempt ${attempt}/${retries}): ${reason}`
      );
      if (attempt === retries || !isTimeoutError(e)) {
        throw e;
      }
      return sleep(backoff * attempt).then(() => attemptFetch(attempt + 1));
    }
  };

  return attemptFetch(1);
};
