import { extractLiquidTags, htmlToPlain, liquidFromCommentHtml, missingRequiredTags, validateLiquid } from "./liquid.js";
import { isAddressed, isFrozen, markAddressed, publicEntries, renderLedgerComment, wovenCount } from "./ledger.js";

export const PROSE_START = "<!-- living-post:prose -->";
export const PROSE_END = "<!-- /living-post:prose -->";

export const OPENING_PROSE = [
  "This article started as one sentence.",
  "Everything after it was added by people who left a comment, then rewritten by Mercury so the story stays in one voice.",
].join(" ");

export const RULES = `## Add a line

Leave a comment. A few times an hour, a job reads the new ones and asks [Mercury 2.5](https://docs.inceptionlabs.ai/get-started/models) to weave them into the story above.

Limits, so this stays a story:

- 600 characters per comment
- comments under 12 characters are skipped
- 3 comments are rewritten into the story each pass
- the story caps at 24,000 characters
- 15 liquid tags in the story
- weaving stops after 200 accepted comments, or when the freeze time passes

Liquid tags work. Put the tag in backticks so the comment renderer leaves the source intact:

\`\`\`
{% youtube dQw4w9WgXcQ %}
{% github forem/forem %}
{% twitter 834439977220112384 %}
\`\`\`

Unknown tags are rejected, because a bad tag can break the whole article on save. The same comment is never applied twice. A machine-readable list of addressed comment ids sits at the bottom of the source.
`;

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim().slice(0, 160);
}

export function renderCanonLog(entries, { frozen, freezeAfter }) {
  const woven = entries.filter((entry) => entry.action === "woven" || entry.action === "recovered").length;
  const rows = publicEntries(entries).slice(-20);
  const header = frozen
    ? `## Canon log\n\nThis post is frozen at ${woven} woven comments. New comments stay on the thread and stay out of the story.\n`
    : `## Canon log\n\nWoven ${woven} of ${freezeAfter}.\n`;
  const table = [
    "| Comment | Author | Result |",
    "| --- | --- | --- |",
    ...(rows.length
      ? rows.map((entry) => `| \`${escapeCell(entry.id)}\` | ${escapeCell(entry.username ? `@${entry.username}` : "")} | ${escapeCell(entry.action)}: ${escapeCell(entry.reason)} |`)
      : ["| | | waiting for the first comment |"]),
  ].join("\n");
  return `${header}\n${table}`;
}

export function renderArticle({ frontMatter = "", prose, entries, frozen = false, freezeAfter = 200 }) {
  const body = [
    PROSE_START,
    "",
    prose.trim(),
    "",
    PROSE_END,
    "",
    RULES.trim(),
    "",
    renderCanonLog(entries, { frozen, freezeAfter }).trim(),
    "",
    renderLedgerComment(entries),
    "",
  ].join("\n");
  if (!frontMatter) return body;
  const matter = frontMatter.endsWith("\n") ? frontMatter : `${frontMatter}\n`;
  return `${matter}\n${body}`;
}

export function emptyArticle({ published = false } = {}) {
  const frontMatter = [
    "---",
    "title: This Post Is Empty. The Comments Are the Article. I'm Freezing It in 48 Hours.",
    "published: " + (published ? "true" : "false"),
    "tags: showdev, discuss, meta, javascript",
    "description: A DEV post that starts as one sentence. Comments are woven in by Mercury, liquid tags included, and each comment is addressed once.",
    "---",
    "",
  ].join("\n");
  return renderArticle({
    frontMatter,
    prose: OPENING_PROSE,
    entries: [],
    frozen: false,
    freezeAfter: 200,
  });
}

export function splitArticle(markdown) {
  let rest = String(markdown ?? "");
  let frontMatter = "";
  const front = rest.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (front) {
    frontMatter = front[0];
    rest = rest.slice(front[0].length);
  }
  const start = rest.indexOf(PROSE_START);
  const end = rest.indexOf(PROSE_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("Article is missing living-post prose markers. Refusing to rewrite it.");
  }
  const prose = rest.slice(start + PROSE_START.length, end).trim();
  return { frontMatter, prose };
}

export function commentId(comment) {
  return String(comment.id_code || comment.id || "").trim();
}

export function commentUsername(comment) {
  return String(comment.user?.username || "").trim();
}

export function normalizeText(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function prepareComment(comment) {
  const text = htmlPlainAndTags(comment);
  return {
    id: commentId(comment),
    username: commentUsername(comment),
    createdAt: comment.created_at || "",
    text: text.plain,
    norm: normalizeText(text.plain),
    tags: text.tags,
  };
}

function htmlPlainAndTags(comment) {
  if (comment.body_html) {
    return {
      plain: htmlToPlain(comment.body_html),
      tags: liquidFromCommentHtml(comment.body_html),
    };
  }
  const plain = String(comment.body_markdown || comment.body || "").trim();
  return { plain, tags: extractLiquidTags(plain) };
}

const SILENT_PROBLEMS = new Set(["author", "too short", "duplicate", "missing id", "already addressed"]);

export function flattenComments(comments, out = []) {
  for (const comment of comments || []) {
    out.push(comment);
    if (comment.children?.length) flattenComments(comment.children, out);
  }
  return out;
}

export function inspectComment(prepared, config, ledger) {
  if (!prepared.id) return "missing id";
  if (isAddressed(ledger, prepared.id)) return "already addressed";
  if (config.skipAuthor && prepared.username.toLowerCase() === config.authorUsername) return "author";
  if (prepared.text.length < config.minCommentChars) return "too short";
  if (prepared.text.length > config.maxCommentChars) return "too long";
  const duplicate = ledger.entries.some((entry) => entry.norm && entry.norm === prepared.norm);
  if (duplicate) return "duplicate";
  const liquid = validateLiquid(prepared.tags.map((tag) => tag.raw).join("\n"), {
    maxTags: config.maxLiquidTags,
    maxArgChars: config.maxTagArgChars,
  });
  if (!liquid.ok) return liquid.errors[0];
  return null;
}

export function requiredTagsFor(prose, comment) {
  const existing = extractLiquidTags(prose).map((tag) => tag.raw);
  const incoming = comment.tags.map((tag) => tag.raw);
  return [...new Set([...existing, ...incoming])];
}

export function validateProse(prose, { requiredTags, maxProseChars, maxLiquidTags, maxTagArgChars }) {
  const errors = [];
  const text = String(prose ?? "").trim();
  if (!text) errors.push("prose is empty");
  if (text.length > maxProseChars) errors.push(`prose is ${text.length} characters, limit is ${maxProseChars}`);
  if (text.includes("<!-- living-post") || text.includes("<!-- /living-post")) {
    errors.push("prose contains ledger markers");
  }
  if (/<(?!https?:\/\/)[a-zA-Z!/?]/.test(text)) errors.push("prose contains HTML tags");
  const liquid = validateLiquid(text, { maxTags: maxLiquidTags, maxArgChars: maxTagArgChars });
  errors.push(...liquid.errors);
  const missing = missingRequiredTags(text, requiredTags);
  for (const tag of missing) errors.push(`missing required liquid tag ${tag}`);
  return errors;
}

export function fixtureComplete({ prose, comment, requiredTags }) {
  if (comment.text.toLowerCase().includes("reject me")) {
    return {
      decision: "reject",
      reason: "fixture rejected this comment",
      prose,
    };
  }
  let next = `${prose.trim()}\n\n${comment.text.trim()}`;
  for (const tag of requiredTags) {
    if (!next.includes(tag)) next += `\n\n${tag}`;
  }
  return {
    decision: "weave",
    reason: "fixture wove the comment into the story",
    prose: next,
  };
}

function stamp(now, username, id, action, reason, norm) {
  return {
    id,
    username,
    action,
    reason,
    at: now.toISOString(),
    norm,
  };
}

export async function weaveComment({ complete, prose, comment, requiredTags, config }) {
  const errors = [];
  for (let attempt = 1; attempt <= config.modelAttempts; attempt += 1) {
    let result;
    try {
      result = await complete({ prose, comment, requiredTags, errors });
    } catch (error) {
      if (error.name !== "ModelOutputError") throw error;
      errors.push(error.message);
      continue;
    }
    const decision = String(result?.decision ?? "").toLowerCase();
    const reason = String(result?.reason ?? "").trim().slice(0, 200) || "no reason given";
    if (decision === "reject") {
      return { action: "rejected", reason, prose };
    }
    if (decision !== "weave") {
      errors.push("model returned a decision other than weave or reject");
      continue;
    }
    const problems = validateProse(result.prose, {
      requiredTags,
      maxProseChars: config.maxProseChars,
      maxLiquidTags: config.maxLiquidTags,
      maxTagArgChars: config.maxTagArgChars,
    });
    if (problems.length === 0) {
      return { action: "woven", reason, prose: String(result.prose).trim() };
    }
    errors.push(problems.join("; "));
  }
  return {
    action: "rejected",
    reason: `gave up after ${config.modelAttempts} tries: ${errors.at(-1) || "invalid model output"}`,
    prose,
  };
}

export async function runOnce({ config, markdown, comments, ledger, complete, publish, now = new Date(), dryRun = false }) {
  const article = splitArticle(markdown);
  let prose = article.prose;
  let nextLedger = ledger.articleId || !config.articleId
    ? ledger
    : { ...ledger, articleId: config.articleId };
  const prepared = flattenComments(comments)
    .map(prepareComment)
    .filter((comment) => comment.id)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));

  const results = [];
  let modelCalls = 0;
  let bookkeeping = 0;
  let stoppedEarly = false;

  for (const comment of prepared) {
    if (isAddressed(nextLedger, comment.id)) continue;

    const problem = inspectComment(comment, config, nextLedger);
    if (problem === "already addressed") continue;
    const frozen = isFrozen(config, nextLedger, now);

    if (frozen || problem) {
      if (bookkeeping >= config.maxBookkeepingPerRun) {
        stoppedEarly = true;
        break;
      }
      const action = frozen ? "frozen" : SILENT_PROBLEMS.has(problem) ? "skipped" : "rejected";
      const reason = frozen ? "post is frozen" : problem;
      nextLedger = markAddressed(
        nextLedger,
        stamp(now, comment.username, comment.id, action === "skipped" ? "skipped" : action, reason, comment.norm),
      );
      results.push({ id: comment.id, username: comment.username, action, reason });
      bookkeeping += 1;
      continue;
    }

    if (modelCalls >= config.maxCommentsPerRun) {
      stoppedEarly = true;
      break;
    }

    const requiredTags = requiredTagsFor(prose, comment);
    const outcome = await weaveComment({ complete, prose, comment, requiredTags, config });
    modelCalls += 1;
    if (outcome.action === "woven") prose = outcome.prose;
    nextLedger = markAddressed(
      nextLedger,
      stamp(now, comment.username, comment.id, outcome.action, outcome.reason, comment.norm),
    );
    results.push({
      id: comment.id,
      username: comment.username,
      action: outcome.action,
      reason: outcome.reason,
    });
  }

  const changed = results.length > 0;
  const nextFrozen = isFrozen(config, nextLedger, now);
  const nextMarkdown = renderArticle({
    frontMatter: article.frontMatter,
    prose,
    entries: nextLedger.entries,
    frozen: nextFrozen,
    freezeAfter: config.freezeAfter,
  });

  if (changed && !dryRun) {
    if (!publish) throw new Error("publish is required when dryRun is false");
    await publish(nextMarkdown);
  }

  return {
    changed,
    dryRun,
    stoppedEarly,
    frozen: nextFrozen,
    modelCalls,
    results,
    ledger: nextLedger,
    markdown: nextMarkdown,
    woven: wovenCount(nextLedger),
  };
}
