/**
 * Spicy AMLL Player — Network Utilities
 * Provides a robust fetch implementation with proxy rotation and error handling.
 */

const PROXIES = [
  (url) => `https://proxy.corsfix.com/?${url}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

/**
 * Attempts to fetch a URL through a direct attempt first, then a rotation of CORS proxies.
 * @param {string} url - The target URL.
 * @param {object} options - Fetch options (headers, method, etc.)
 * @returns {Promise<Response>} The successful response.
 */
export async function robustFetch(url, options = {}) {
  let lastError = null;
  const skipProxy = options.skipProxy || false;

  // Strip custom properties before passing to native fetch
  const { skipProxy: _sp, ...fetchOptions } = options;

  // 1. Try Direct Fetch First
  try {
    console.log(`[NetworkUtils] Trying direct fetch: ${url}`);
    const directResponse = await fetch(url, fetchOptions);
    if (directResponse.ok) return directResponse;
    lastError = new Error(`Direct fetch failed: ${directResponse.status} ${directResponse.statusText}`);
  } catch (e) {
    lastError = e;
    console.warn(`[NetworkUtils] Direct fetch blocked or failed:`, e.name);
  }

  // 2. Try Proxies (only if not skipped)
  if (!skipProxy) {
    for (let i = 0; i < PROXIES.length; i++) {
      try {
        const proxiedUrl = PROXIES[i](url);
        console.log(`[NetworkUtils] Trying proxy ${i + 1}: ${new URL(proxiedUrl).hostname}`);
        
        const response = await fetch(proxiedUrl, fetchOptions);

        if (response.ok) {
          return response;
        }

        const statusText = response.statusText || 'Unknown Error';
        lastError = new Error(`Proxy ${i + 1} (${new URL(proxiedUrl).hostname}) failed: ${response.status} ${statusText}`);
        console.warn(`[NetworkUtils] ${lastError.message}`);

        // If it's a 403 or 429, try next proxy immediately
        if (response.status === 403 || response.status === 429) continue;

      } catch (e) {
        lastError = e;
        console.warn(`[NetworkUtils] Proxy ${i + 1} request error:`, e.message);
      }

      // Delay between retries
      if (i < PROXIES.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after direct attempt ${skipProxy ? '' : 'and all proxies'}.`);
}

/**
 * Robust fetch that automatically handles JSON parsing and errors.
 */
export async function fetchJson(url, options = {}) {
  const response = await robustFetch(url, options);
  return response.json();
}
