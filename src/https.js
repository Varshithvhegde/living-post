export function assertHttps(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Refusing non-URL endpoint: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Refusing non-HTTPS endpoint: ${url}`);
  }
  return parsed;
}
