import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emptyArticle,
  fixtureComplete,
  runOnce,
  splitArticle,
  weaveComment,
} from "../src/article.js";
import { loadConfig } from "../src/config.js";
import { emptyLedger, readArticleLedger } from "../src/ledger.js";
import { HttpError } from "../src/errors.js";
import { ModelOutputError } from "../src/mercury.js";

function fixtureComments() {
  const comments = JSON.parse(readFileSync(new URL("../fixtures/comments.json", import.meta.url), "utf8"));
  return comments.map(function expand(comment) {
    const copy = { ...comment, children: (comment.children || []).map(expand) };
    if (String(copy.body_html).includes("TOO_LONG_PLACEHOLDER")) {
      copy.body_html = `<p>${"word ".repeat(160)}</p>`;
    }
    return copy;
  });
}

function baseConfig(overrides = {}) {
  return { ...loadConfig({}), ...overrides };
}

test("fixture pass addresses every sample comment once and keeps the youtube tag", async () => {
  const published = [];
  const first = await runOnce({
    config: baseConfig({ articleId: "fixture" }),
    markdown: emptyArticle(),
    comments: fixtureComments(),
    ledger: emptyLedger("fixture"),
    complete: fixtureComplete,
    publish: async (markdown) => published.push(markdown),
    now: new Date("2026-10-08T05:00:00Z"),
    dryRun: false,
  });

  assert.equal(published.length, 1);
  assert.equal(first.modelCalls, 3);
  assert.deepEqual(
    first.results.map((row) => [row.id, row.action]),
    [
      ["short1", "skipped"],
      ["author1", "skipped"],
      ["ada1", "woven"],
      ["grace1", "woven"],
      ["long1", "rejected"],
      ["spam1", "rejected"],
    ],
  );
  assert.match(splitArticle(first.markdown).prose, /The lighthouse kept the same hours/);
  assert.match(splitArticle(first.markdown).prose, /\{% youtube dQw4w9WgXcQ %\}/);
  assert.deepEqual(readArticleLedger(first.markdown), ["short1", "author1", "ada1", "grace1", "long1", "spam1"]);

  const second = await runOnce({
    config: baseConfig({ articleId: "fixture" }),
    markdown: first.markdown,
    comments: fixtureComments(),
    ledger: first.ledger,
    complete: fixtureComplete,
    publish: async (markdown) => published.push(markdown),
    now: new Date("2026-10-08T06:00:00Z"),
    dryRun: false,
  });

  assert.equal(second.modelCalls, 0);
  assert.equal(second.changed, false);
  assert.equal(published.length, 1);
});

test("a dry run weaves in memory and does not publish", async () => {
  let published = 0;
  const result = await runOnce({
    config: baseConfig(),
    markdown: emptyArticle(),
    comments: fixtureComments(),
    ledger: emptyLedger("fixture"),
    complete: fixtureComplete,
    publish: async () => { published += 1; },
    dryRun: true,
  });
  assert.equal(published, 0);
  assert.equal(result.changed, true);
  assert.match(result.markdown, /lighthouse/);
});

test("Mercury is asked again when it drops a required liquid tag", async () => {
  const calls = [];
  const config = baseConfig({ modelAttempts: 3 });
  const comment = {
    id: "g1",
    username: "grace",
    text: "Play the clip.",
    tags: [{ raw: "{% youtube dQw4w9WgXcQ %}" }],
  };
  const result = await weaveComment({
    config,
    prose: "The room was quiet.",
    comment,
    requiredTags: ["{% youtube dQw4w9WgXcQ %}"],
    complete: async ({ errors }) => {
      calls.push(errors.length);
      if (errors.length === 0) {
        return { decision: "weave", reason: "forgot the tag", prose: "The room was quiet.\n\nPlay the clip." };
      }
      return {
        decision: "weave",
        reason: "put the tag back",
        prose: "The room was quiet.\n\nPlay the clip.\n\n{% youtube dQw4w9WgXcQ %}",
      };
    },
  });

  assert.deepEqual(calls, [0, 1]);
  assert.equal(result.action, "woven");
  assert.match(result.prose, /\{% youtube dQw4w9WgXcQ %\}/);
});

test("bad model JSON is retried, then the comment is rejected", async () => {
  let calls = 0;
  const result = await weaveComment({
    config: baseConfig({ modelAttempts: 2 }),
    prose: "The room was quiet.",
    comment: { id: "x", username: "ada", text: "Add a bell that rings at dusk.", tags: [] },
    requiredTags: [],
    complete: async () => {
      calls += 1;
      throw new ModelOutputError("model did not return JSON");
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.action, "rejected");
  assert.match(result.reason, /did not return JSON/);
});

test("an HTTP failure publishes nothing and leaves the comment unaddressed", async () => {
  let published = 0;
  await assert.rejects(
    () => runOnce({
      config: baseConfig({ articleId: "fixture" }),
      markdown: emptyArticle(),
      comments: [{
        id_code: "ada1",
        created_at: "2026-10-08T04:02:00Z",
        body_html: "<p>The lighthouse kept the same hours as the comments.</p>",
        user: { username: "ada" },
      }],
      ledger: emptyLedger("fixture"),
      complete: async () => {
        throw new HttpError("down", { status: 503 });
      },
      publish: async () => { published += 1; },
      dryRun: false,
    }),
    (error) => error.status === 503,
  );
  assert.equal(published, 0);
});

test("the story freezes once the woven limit is hit, inside the same run", async () => {
  const result = await runOnce({
    config: baseConfig({ freezeAfter: 1, articleId: "fixture" }),
    markdown: emptyArticle(),
    comments: [
      {
        id_code: "one",
        created_at: "2026-10-08T04:00:00Z",
        body_html: "<p>The first sentence arrives with the tide.</p>",
        user: { username: "ada" },
      },
      {
        id_code: "two",
        created_at: "2026-10-08T04:01:00Z",
        body_html: "<p>The second sentence misses the boat.</p>",
        user: { username: "grace" },
      },
    ],
    ledger: emptyLedger("fixture"),
    complete: fixtureComplete,
    dryRun: true,
  });

  assert.deepEqual(result.results.map((row) => [row.id, row.action]), [
    ["one", "woven"],
    ["two", "frozen"],
  ]);
  assert.equal(result.frozen, true);
});

test("only three story rewrites happen per run", async () => {
  const comments = ["one", "two", "three", "four"].map((id, index) => ({
    id_code: id,
    created_at: `2026-10-08T04:0${index}:00Z`,
    body_html: `<p>Sentence number ${id} is long enough to weave.</p>`,
    user: { username: id },
  }));
  const result = await runOnce({
    config: baseConfig({ maxCommentsPerRun: 3 }),
    markdown: emptyArticle(),
    comments,
    ledger: emptyLedger("fixture"),
    complete: fixtureComplete,
    dryRun: true,
  });
  assert.equal(result.modelCalls, 3);
  assert.equal(result.stoppedEarly, true);
  assert.equal(result.results.some((row) => row.id === "four"), false);
});

test("the article is left alone when the prose markers are missing", async () => {
  await assert.rejects(
    () => runOnce({
      config: baseConfig(),
      markdown: "just a paragraph",
      comments: [],
      ledger: emptyLedger(),
      complete: fixtureComplete,
      dryRun: true,
    }),
    /prose markers/,
  );
});
