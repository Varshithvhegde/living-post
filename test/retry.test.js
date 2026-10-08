import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../src/errors.js";
import { parseRetryAfter, withRetry } from "../src/retry.js";

test("retries a 503 and then returns the value", async () => {
  const sleeps = [];
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw new HttpError("down", { status: 503 });
    return "ok";
  }, { attempts: 4, baseMs: 10, random: () => 0.5, sleep: async (ms) => sleeps.push(ms) });

  assert.equal(value, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("honors Retry-After on 429", async () => {
  const sleeps = [];
  let calls = 0;
  await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw new HttpError("slow", { status: 429, retryAfterMs: 25 });
    return "ok";
  }, { attempts: 3, baseMs: 500, sleep: async (ms) => sleeps.push(ms) });

  assert.deepEqual(sleeps, [25]);
});

test("does not retry a 401", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => {
      calls += 1;
      throw new HttpError("no", { status: 401 });
    }, { attempts: 4, sleep: async () => {} }),
    (error) => error.status === 401,
  );
  assert.equal(calls, 1);
});

test("parses retry-after seconds", () => {
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter(""), null);
});
