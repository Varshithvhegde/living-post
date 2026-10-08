import { readFileSync, existsSync } from "node:fs";
import { assertHttps } from "./https.js";

export function loadEnvFile(path = ".env") {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

function integer(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function bool(env, name, fallback) {
  const raw = env[name];
  if (raw == null || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env = process.env) {
  const devBaseUrl = env.DEV_BASE_URL || "https://dev.to/api";
  const inceptionBaseUrl = env.INCEPTION_BASE_URL || "https://api.inceptionlabs.ai/v1";
  assertHttps(devBaseUrl);
  assertHttps(inceptionBaseUrl);

  const freezeAtRaw = env.FREEZE_AT || "";
  let freezeAt = null;
  if (freezeAtRaw) {
    const parsed = new Date(freezeAtRaw);
    if (Number.isNaN(parsed.getTime())) throw new Error("FREEZE_AT must be an ISO timestamp");
    freezeAt = parsed;
  }

  return {
    devApiKey: env.DEV_API_KEY || "",
    inceptionApiKey: env.INCEPTION_API_KEY || "",
    articleId: env.ARTICLE_ID || "",
    devBaseUrl: devBaseUrl.replace(/\/$/, ""),
    inceptionBaseUrl: inceptionBaseUrl.replace(/\/$/, ""),
    model: env.MERCURY_MODEL || "mercury-2.5",
    authorUsername: (env.AUTHOR_USERNAME || "varshithvhegde").toLowerCase(),
    skipAuthor: bool(env, "SKIP_AUTHOR", true),
    maxCommentsPerRun: integer(env, "MAX_COMMENTS_PER_RUN", 3, { min: 1, max: 10 }),
    maxBookkeepingPerRun: integer(env, "MAX_BOOKKEEPING_PER_RUN", 20, { min: 1, max: 100 }),
    maxCommentChars: integer(env, "MAX_COMMENT_CHARS", 600, { min: 20, max: 5000 }),
    minCommentChars: integer(env, "MIN_COMMENT_CHARS", 12, { min: 1, max: 500 }),
    maxProseChars: integer(env, "MAX_PROSE_CHARS", 24_000, { min: 500, max: 100_000 }),
    maxLiquidTags: integer(env, "MAX_LIQUID_TAGS", 15, { min: 1, max: 40 }),
    maxTagArgChars: integer(env, "MAX_TAG_ARG_CHARS", 300, { min: 20, max: 2000 }),
    freezeAfter: integer(env, "FREEZE_AFTER", 200, { min: 1, max: 5000 }),
    freezeAt,
    maxRetries: integer(env, "MAX_RETRIES", 4, { min: 1, max: 8 }),
    retryBaseMs: integer(env, "RETRY_BASE_MS", 800, { min: 0, max: 60_000 }),
    modelAttempts: integer(env, "MODEL_ATTEMPTS", 3, { min: 1, max: 6 }),
  };
}
