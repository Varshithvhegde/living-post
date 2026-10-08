import { HttpError } from "./errors.js";
import { assertHttps } from "./https.js";
import { parseRetryAfter, withRetry } from "./retry.js";

function responseHeader(response, name) {
  if (!response?.headers) return null;
  if (typeof response.headers.get === "function") return response.headers.get(name);
  return response.headers[name] ?? response.headers[name.toLowerCase()] ?? null;
}

export async function requestJson(url, options = {}) {
  assertHttps(url);
  const method = options.method || "GET";
  const fetchImpl = options.fetchImpl || fetch;
  return withRetry(async () => {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: options.headers,
        body: options.body == null ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (error?.name === "HttpError") throw error;
      const wrapped = new Error(error?.message || "request failed");
      wrapped.name = error?.name || "TypeError";
      wrapped.retryable = error?.name === "TypeError" || error?.retryable === true;
      throw wrapped;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} ${method} ${url}: ${text.slice(0, 240)}`, {
        status: response.status,
        retryAfterMs: parseRetryAfter(responseHeader(response, "retry-after")),
        method,
        url,
      });
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(`HTTP ${response.status} ${method} ${url} returned non-JSON`, {
        status: response.status,
        method,
        url,
      });
    }
  }, {
    attempts: options.attempts,
    baseMs: options.baseMs,
    sleep: options.sleep,
    random: options.random,
  });
}
