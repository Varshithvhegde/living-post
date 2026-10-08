export class HttpError extends Error {
  constructor(message, { status, retryAfterMs, method, url }) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs ?? null;
    this.method = method;
    this.url = url;
  }
}

export function isRetryable(err) {
  if (!err) return false;
  if (err.retryable) return true;
  if (err instanceof HttpError || err.name === "HttpError") {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  // fetch throws TypeError when the socket fails before a response exists.
  if (err.name === "TypeError") return true;
  return false;
}
