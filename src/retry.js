import { isRetryable } from "./errors.js";

export function parseRetryAfter(header) {
  if (header == null || header === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

export async function withRetry(fn, options = {}) {
  const attempts = options.attempts ?? 4;
  const baseMs = options.baseMs ?? 800;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retry = options.shouldRetry ? options.shouldRetry(error) : isRetryable(error);
      if (attempt === attempts || !retry) throw error;
      const headerDelay = error.retryAfterMs ?? null;
      const backoff = Math.round(baseMs * 2 ** (attempt - 1) * (0.5 + random()));
      const delay = Math.min(maxDelayMs, headerDelay ?? backoff);
      await sleep(delay);
    }
  }

  throw lastError;
}
