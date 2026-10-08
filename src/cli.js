import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyArticle, fixtureComplete, inspectComment, prepareComment, flattenComments, runOnce } from "./article.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { createDevClient } from "./devto.js";
import { assertSameArticle, emptyLedger, isAddressed, mergeLedgers, readArticleLedger } from "./ledger.js";
import { createMercury } from "./mercury.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const ledgerPath = join(root, "state", "ledger.json");
const fixturePath = join(root, "fixtures", "comments.json");

loadEnvFile(join(root, ".env"));

const args = process.argv.slice(2);
const command = args[0] || "help";
const flags = new Set(args.slice(1).filter((arg) => arg.startsWith("--")));

function loadLedgerFile() {
  const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error("state/ledger.json is not a ledger");
  return parsed;
}

function saveLedgerFile(ledger) {
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

function expandFixture(comment) {
  const copy = {
    ...comment,
    children: (comment.children || []).map(expandFixture),
  };
  if (String(copy.body_html).includes("TOO_LONG_PLACEHOLDER")) {
    copy.body_html = `<p>${"word ".repeat(160)}</p>`;
  }
  return copy;
}

function loadFixtureComments() {
  return JSON.parse(readFileSync(fixturePath, "utf8")).map(expandFixture);
}

function printResults(result) {
  console.log(`model calls: ${result.modelCalls}`);
  console.log(`woven so far: ${result.woven}`);
  console.log(`frozen: ${result.frozen}`);
  console.log(`stopped with comments still waiting: ${result.stoppedEarly}`);
  for (const row of result.results) {
    console.log(`${row.action}\t${row.id}\t@${row.username}\t${row.reason}`);
  }
}

function writePreview(markdown) {
  const dir = join(root, "out");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "preview.md");
  writeFileSync(path, markdown);
  return path;
}

async function seed() {
  const config = loadConfig();
  const published = flags.has("--publish");
  const markdown = emptyArticle({ published });
  if (!config.devApiKey) {
    console.error("No DEV_API_KEY set, so nothing was created. Paste the markdown into a new DEV draft, or add the key and run seed again.");
    console.log(markdown);
    return;
  }
  const dev = createDevClient({
    apiKey: config.devApiKey,
    baseUrl: config.devBaseUrl,
    attempts: config.maxRetries,
    baseMs: config.retryBaseMs,
  });
  const created = await dev.createArticle({ bodyMarkdown: markdown, published });
  console.log(`Created article ${created.id}`);
  console.log(created.url || created.path || "");
  console.log("Put that id in ARTICLE_ID before the workflow runs.");
  if (!published) console.log("It is a draft. Comments open up once you publish it.");
}

async function pending() {
  const config = loadConfig();
  const fixture = flags.has("--fixture");
  const comments = fixture ? loadFixtureComments() : await liveComments(config);
  const ledger = fixture ? emptyLedger("fixture") : loadLedgerFile();
  const rows = flattenComments(comments).map(prepareComment).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const comment of rows) {
    const state = isAddressed(ledger, comment.id) ? "addressed" : inspectComment(comment, config, ledger) || "ready";
    console.log(`${state}\t${comment.id}\t@${comment.username}\t${comment.text.slice(0, 80)}`);
  }
}

async function liveComments(config) {
  if (!config.devApiKey || !config.articleId) {
    throw new Error("Set DEV_API_KEY and ARTICLE_ID, or pass --fixture.");
  }
  const dev = createDevClient({
    apiKey: config.devApiKey,
    baseUrl: config.devBaseUrl,
    attempts: config.maxRetries,
    baseMs: config.retryBaseMs,
  });
  return dev.getComments(config.articleId);
}

async function run() {
  const config = loadConfig();
  const fixture = flags.has("--fixture");
  const dryRun = flags.has("--dry-run") || process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  if (fixture && !dryRun) {
    throw new Error("Fixture mode never publishes. Add --dry-run, or drop --fixture to update the live article.");
  }

  if (fixture) {
    const result = await runOnce({
      config: { ...config, articleId: "fixture" },
      markdown: emptyArticle({ published: false }),
      comments: loadFixtureComments(),
      ledger: emptyLedger("fixture"),
      complete: fixtureComplete,
      now: new Date("2026-10-08T05:00:00Z"),
      dryRun: true,
    });
    const preview = writePreview(result.markdown);
    printResults(result);
    console.log(`preview: ${preview}`);
    console.log("Fixture run. No DEV write, no ledger write.");
    return;
  }

  if (!config.devApiKey || !config.articleId || !config.inceptionApiKey) {
    throw new Error("Set DEV_API_KEY, ARTICLE_ID, and INCEPTION_API_KEY. Use --fixture --dry-run to test without them.");
  }

  const dev = createDevClient({
    apiKey: config.devApiKey,
    baseUrl: config.devBaseUrl,
    attempts: config.maxRetries,
    baseMs: config.retryBaseMs,
  });
  const article = await dev.getArticle(config.articleId);
  const comments = await dev.getComments(config.articleId);
  const fileLedger = loadLedgerFile();
  assertSameArticle(fileLedger, String(config.articleId));
  const ledger = mergeLedgers(fileLedger, readArticleLedger(article.body_markdown), String(config.articleId));

  const mercury = createMercury({
    apiKey: config.inceptionApiKey,
    baseUrl: config.inceptionBaseUrl,
    model: config.model,
    attempts: config.maxRetries,
    baseMs: config.retryBaseMs,
  });

  const result = await runOnce({
    config,
    markdown: article.body_markdown,
    comments,
    ledger,
    complete: (input) => mercury.complete(input),
    publish: (markdown) => dev.updateArticle(config.articleId, markdown),
    dryRun,
  });

  const preview = writePreview(result.markdown);
  printResults(result);
  console.log(`preview: ${preview}`);
  if (dryRun) {
    console.log("Dry run. DEV was not updated and the ledger file was not changed.");
    return;
  }
  if (result.changed) {
    saveLedgerFile(result.ledger);
    console.log(`ledger: ${ledgerPath}`);
  } else {
    console.log("No new comments to address.");
  }
}

const HELP = `living-post

Test without keys or network:
  npm test
  npm run dry

See which fixture comments would be addressed:
  npm run pending

Rehearse against the live article without writing it:
  ARTICLE_ID=123 DEV_API_KEY=... INCEPTION_API_KEY=... node src/cli.js run --dry-run

One real pass, including a comment you left yourself:
  SKIP_AUTHOR=false ARTICLE_ID=123 DEV_API_KEY=... INCEPTION_API_KEY=... node src/cli.js run

Create the DEV article (draft unless you pass --publish):
  node src/cli.js seed
  node src/cli.js seed --publish
`;

const commands = { seed, pending, run, help: async () => console.log(HELP) };

if (!commands[command]) {
  console.log(HELP);
  process.exitCode = 1;
} else {
  commands[command]().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
