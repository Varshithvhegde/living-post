const LEDGER_PATTERN = /<!-- living-post:ledger\r?\n([\s\S]*?)-->/;

export function emptyLedger(articleId = null) {
  return { version: 1, articleId, entries: [] };
}

export function commentKey(id) {
  return String(id ?? "").trim();
}

export function addressedIds(ledger) {
  return new Set(ledger.entries.map((entry) => entry.id));
}

export function isAddressed(ledger, id) {
  return addressedIds(ledger).has(commentKey(id));
}

export function readArticleLedger(markdown) {
  const match = String(markdown ?? "").match(LEDGER_PATTERN);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9_-]+$/.test(line));
}

export function mergeLedgers(fileLedger, articleIds, articleId) {
  const entries = fileLedger.entries.map((entry) => ({ ...entry }));
  const known = new Set(entries.map((entry) => entry.id));
  for (const id of articleIds) {
    if (known.has(id)) continue;
    entries.push({
      id,
      username: "",
      action: "recovered",
      reason: "id was already in the article",
      at: "",
      norm: "",
    });
    known.add(id);
  }
  return {
    version: 1,
    articleId: fileLedger.articleId || articleId || null,
    entries,
  };
}

export function assertSameArticle(ledger, articleId) {
  if (ledger.articleId && articleId && ledger.articleId !== articleId) {
    throw new Error(
      `Ledger belongs to article ${ledger.articleId}, config says ${articleId}. Refusing to mix them.`,
    );
  }
}

export function markAddressed(ledger, entry) {
  if (isAddressed(ledger, entry.id)) return ledger;
  return {
    ...ledger,
    entries: [...ledger.entries, entry],
  };
}

export function wovenCount(ledger) {
  return ledger.entries.filter((entry) => entry.action === "woven" || entry.action === "recovered").length;
}

export function isFrozen(config, ledger, now) {
  if (wovenCount(ledger) >= config.freezeAfter) return true;
  if (config.freezeAt && now.getTime() >= config.freezeAt.getTime()) return true;
  return false;
}

export function renderLedgerComment(entries) {
  const ids = entries.map((entry) => entry.id).join("\n");
  return `<!-- living-post:ledger\n${ids}\n-->`;
}

export function publicEntries(entries) {
  return entries.filter((entry) => (
    entry.action === "woven" ||
    entry.action === "recovered" ||
    entry.action === "rejected" ||
    entry.action === "frozen"
  ));
}
