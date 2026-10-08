import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { emptyLedger, isFrozen, mergeLedgers, readArticleLedger, renderLedgerComment } from "../src/ledger.js";
import { emptyArticle, renderArticle } from "../src/article.js";

test("refuses plain HTTP endpoints", () => {
  assert.throws(() => loadConfig({ DEV_BASE_URL: "http://dev.to/api" }), /HTTPS/);
  assert.throws(() => loadConfig({ INCEPTION_BASE_URL: "http://api.inceptionlabs.ai/v1" }), /HTTPS/);
});

test("rejects a limit outside its range", () => {
  assert.throws(() => loadConfig({ MAX_COMMENTS_PER_RUN: "0" }), /MAX_COMMENTS_PER_RUN/);
  assert.throws(() => loadConfig({ MAX_COMMENTS_PER_RUN: "11" }), /MAX_COMMENTS_PER_RUN/);
});

test("recovers addressed ids from the article when the file ledger is empty", () => {
  const markdown = renderArticle({
    prose: "Hello.",
    entries: [{ id: "ada1", username: "ada", action: "woven", reason: "kept", at: "", norm: "hello" }],
  });
  const ids = readArticleLedger(markdown);
  assert.deepEqual(ids, ["ada1"]);
  const ledger = mergeLedgers(emptyLedger(), ids, "99");
  assert.equal(ledger.entries[0].action, "recovered");
  assert.equal(ledger.articleId, "99");
});

test("the seed article carries its own ledger comment", () => {
  const ids = readArticleLedger(emptyArticle());
  assert.deepEqual(ids, []);
  assert.match(emptyArticle(), /living-post:prose/);
  assert.match(renderLedgerComment([]), /living-post:ledger/);
});

test("a manual run writes to DEV unless dry_run is the string true", () => {
  const workflow = readFileSync(new URL("../.github/workflows/weave.yml", import.meta.url), "utf8");
  assert.match(workflow, /inputs\.dry_run == 'true'/);
});

test("freeze checks woven comments and the timestamp", () => {
  const config = loadConfig({ FREEZE_AFTER: "1", FREEZE_AT: "2026-10-09T00:00:00Z" });
  const ledger = {
    version: 1,
    articleId: "1",
    entries: [{ id: "a", action: "woven" }],
  };
  assert.equal(isFrozen(config, ledger, new Date("2026-10-08T00:00:00Z")), true);
  const open = { ...ledger, entries: [] };
  assert.equal(isFrozen(config, open, new Date("2026-10-08T00:00:00Z")), false);
  assert.equal(isFrozen(config, open, new Date("2026-10-09T00:00:00Z")), true);
});
