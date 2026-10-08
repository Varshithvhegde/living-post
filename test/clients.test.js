import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../src/errors.js";
import { requestJson } from "../src/http.js";
import { createDevClient } from "../src/devto.js";
import { createMercury } from "../src/mercury.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

test("requestJson refuses a non-HTTPS URL before calling fetch", async () => {
  let called = false;
  await assert.rejects(
    () => requestJson("http://dev.to/api/articles/1", { fetchImpl: async () => { called = true; } }),
    /HTTPS/,
  );
  assert.equal(called, false);
});

test("requestJson retries a 503 from DEV", async () => {
  let calls = 0;
  const body = await requestJson("https://dev.to/api/articles/1", {
    attempts: 3,
    baseMs: 1,
    random: () => 0.5,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse("nope", { status: 503 });
      return jsonResponse({ ok: true });
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(body, { ok: true });
});

test("comment pages stop when the next page repeats ids", async () => {
  const pages = [];
  const dev = createDevClient({
    apiKey: "test-key",
    baseUrl: "https://dev.to/api",
    attempts: 1,
    fetchImpl: async (url) => {
      pages.push(url);
      if (url.endsWith("page=1")) {
        return jsonResponse([
          {
            id_code: "parent",
            body_html: "<p>parent</p>",
            user: { username: "ada" },
            children: [{ id_code: "child", body_html: "<p>child</p>", user: { username: "grace" }, children: [] }],
          },
        ]);
      }
      return jsonResponse([
        { id_code: "parent", body_html: "<p>parent</p>", user: { username: "ada" }, children: [] },
      ]);
    },
  });

  const comments = await dev.getComments(42);
  assert.deepEqual(comments.map((comment) => comment.id_code), ["parent", "child"]);
  assert.equal(pages.length, 2);
});

test("Mercury falls back to json_object when json_schema is rejected", async () => {
  const formats = [];
  const efforts = [];
  const mercury = createMercury({
    apiKey: "test-key",
    baseUrl: "https://api.inceptionlabs.ai/v1",
    model: "mercury-2.5",
    attempts: 1,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      formats.push(body.response_format.type);
      efforts.push(body.reasoning_effort);
      if (body.response_format.type === "json_schema") {
        return jsonResponse({ error: { message: "schema unsupported" } }, { status: 400 });
      }
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ decision: "weave", reason: "kept", prose: "A story." }) } }],
      });
    },
  });

  const result = await mercury.complete({
    prose: "A story.",
    comment: { username: "ada", text: "Add a bell." },
    requiredTags: [],
    errors: [],
  });
  assert.deepEqual(formats, ["json_schema", "json_object"]);
  assert.deepEqual(efforts, ["none", "none"]);
  assert.equal(result.decision, "weave");
  assert.equal(result.prose, "A story.");
});

test("a Mercury 401 is not retried into a second format", async () => {
  let calls = 0;
  const mercury = createMercury({
    apiKey: "test-key",
    baseUrl: "https://api.inceptionlabs.ai/v1",
    model: "mercury-2.5",
    attempts: 2,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse("bad key", { status: 401 });
    },
  });

  await assert.rejects(
    () => mercury.complete({ prose: "A.", comment: { username: "ada", text: "Hi there friend." }, requiredTags: [], errors: [] }),
    (error) => error instanceof HttpError && error.status === 401,
  );
  assert.equal(calls, 1);
});
