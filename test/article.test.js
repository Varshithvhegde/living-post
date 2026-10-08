import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emptyArticle,
  fixtureComplete,
  renderArticle,
  runOnce,
  splitArticle,
  stripMentions,
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

test("known mentions are removed from the story and an email is left alone", () => {
  const names = new Map([["csm18", "csm"]]);
  assert.equal(stripMentions("from @csm18 and editor@example.com", names), "from and editor@example.com");
  assert.equal(stripMentions("hello @unknown", names), "hello unknown");
});

test("an existing mention is saved without waiting for a new comment", async () => {
  const published = [];
  const markdown = renderArticle({
    prose: "The bell rang for @csm18.",
    entries: [{ id: "3gnf3", username: "csm18", action: "woven", reason: "kept", at: "", norm: "mic testing!" }],
  });
  const result = await runOnce({
    config: baseConfig({ articleId: "4815291" }),
    markdown,
    comments: [{
      id_code: "3gnf3",
      created_at: "2026-10-08T04:20:37Z",
      body_html: "<p>Mic testing!</p>",
      user: { username: "csm18", name: "csm" },
    }],
    ledger: {
      version: 1,
      articleId: "4815291",
      entries: [{ id: "3gnf3", username: "csm18", action: "woven", reason: "kept", at: "", norm: "mic testing!" }],
    },
    complete: fixtureComplete,
    publish: async (body) => published.push(body),
    dryRun: false,
  });

  assert.equal(result.modelCalls, 0);
  assert.equal(published.length, 1);
  assert.doesNotMatch(published[0], /@csm18/);
  assert.match(splitArticle(published[0]).prose, /The bell rang for\./);
  assert.match(published[0], /\| csm \|/);
});

test("a changelog sentence is sent back to the model", async () => {
  let calls = 0;
  const result = await weaveComment({
    config: baseConfig({ modelAttempts: 2 }),
    prose: "The room was quiet.",
    comment: {
      id: "1",
      username: "oneluffychan",
      name: "Monkey D Luffy",
      text: "There was a man who lived in the jungle",
      tags: [],
    },
    requiredTags: [],
    complete: async ({ errors }) => {
      calls += 1;
      if (errors.length === 0) {
        return {
          decision: "weave",
          reason: "log",
          prose: "Monkey D Luffy added a note about a man who lived in the jungle.",
        };
      }
      return {
        decision: "weave",
        reason: "scene",
        prose: "A man lived in the jungle, where the path had already given up.",
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.action, "woven");
  assert.doesNotMatch(result.prose, /added a note|Monkey D Luffy/);
});

test("the comment log is rewritten into one scene", async () => {
  const published = [];
  const entries = [
    { id: "3gnf3", username: "csm18", name: "csm", action: "woven", reason: "kept", at: "", norm: "mic testing!" },
    {
      id: "3gnfk",
      username: "oneluffychan",
      name: "Monkey D Luffy",
      action: "woven",
      reason: "kept",
      at: "",
      norm: "there was a man who lived in the jungle",
    },
  ];
  const markdown = renderArticle({
    prose: [
      "This article started as one sentence. Everything after it was added by people who left a comment, then rewritten by Mercury so the story stays in one voice.",
      "It all began with a simple mic testing! from csm.",
      "Monkey D Luffy added a note about a man who lived in the jungle.",
    ].join("\n\n"),
    entries,
  });
  const result = await runOnce({
    config: baseConfig({ articleId: "4815291", modelAttempts: 2 }),
    markdown,
    comments: [
      {
        id_code: "3gnf3",
        created_at: "2026-10-08T04:20:37Z",
        body_html: "<p>Mic testing!</p>",
        user: { username: "csm18", name: "csm" },
      },
      {
        id_code: "3gnfk",
        created_at: "2026-10-08T04:34:10Z",
        body_html: "<p>There was a man who lived in the jungle</p>",
        user: { username: "oneluffychan", name: "Monkey D Luffy" },
      },
    ],
    ledger: { version: 1, articleId: "4815291", entries },
    complete: async ({ comment, errors }) => {
      if (!comment.beats) return { decision: "reject", reason: "unexpected", prose: "" };
      if (errors.length === 0) {
        return {
          decision: "weave",
          reason: "still a log",
          prose: "Monkey D Luffy added a note about a man who lived in the jungle.",
        };
      }
      return {
        decision: "weave",
        reason: "rewrote the scene",
        prose: [
          "A microphone answered once, and the empty room kept the sound.",
          "Past the last of the path, a man lived in the jungle, and the trees had been waiting.",
        ].join("\n\n"),
      };
    },
    publish: async (body) => published.push(body),
  });

  assert.equal(result.polished, true);
  assert.equal(published.length, 1);
  const prose = splitArticle(published[0]).prose;
  assert.match(prose, /microphone answered once/);
  assert.match(prose, /man lived in the jungle/);
  assert.doesNotMatch(prose, /added a note|mic testing!|This article started|\bcsm\b|Luffy/);
});

test("a mic check the model calls spam is still woven", async () => {
  const result = await weaveComment({
    config: baseConfig({ modelAttempts: 2 }),
    prose: "This article started as one sentence.",
    comment: { id: "3gnf3", username: "csm18", text: "Mic testing!", tags: [] },
    requiredTags: [],
    complete: async () => ({ decision: "reject", reason: "Comment is a spam test.", prose: "untouched" }),
  });
  assert.equal(result.action, "woven");
  assert.match(result.prose, /Mic testing!/);
});

test("an explicit veto is still rejected", async () => {
  const result = await weaveComment({
    config: baseConfig({ modelAttempts: 2 }),
    prose: "This article started as one sentence.",
    comment: {
      id: "spam1",
      username: "spike",
      text: "reject me, this comment is only here to test the veto.",
      tags: [],
    },
    requiredTags: [],
    complete: async () => ({ decision: "reject", reason: "fixture rejected this comment", prose: "untouched" }),
  });
  assert.equal(result.action, "rejected");
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
