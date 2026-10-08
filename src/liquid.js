const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export const LIQUID_TAGS = new Set([
  "link",
  "user",
  "tag",
  "devcomment",
  "podcast",
  "twitter",
  "tweet",
  "glitch",
  "github",
  "youtube",
  "vimeo",
  "twitch",
  "slideshare",
  "codepen",
  "stackblitz",
  "codesandbox",
  "jsfiddle",
  "dotnetfiddle",
  "replit",
  "stackery",
  "nexttech",
  "instagram",
  "speakerdeck",
  "soundcloud",
  "spotify",
  "blogcast",
  "kotlin",
  "wikipedia",
  "reddit",
  "medium",
  "embed",
  "codeberg",
  "asciinema",
  "slack",
  "gist",
  "stackoverflow",
  "raw",
  "endraw",
  "liquid",
  "endliquid",
  "details",
  "enddetails",
  "poll",
  "endpoll",
]);

const PAIRS = {
  raw: "endraw",
  liquid: "endliquid",
  details: "enddetails",
  poll: "endpoll",
};

const CLOSERS = new Map(Object.entries(PAIRS).map(([open, close]) => [close, open]));

const TAG_PATTERN = /\{%-?\s*([A-Za-z][A-Za-z0-9_]*)\s*([\s\S]*?)\s*-?%\}/g;

export function decodeHtml(value) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] !== "#") return NAMED_ENTITIES[entity] ?? match;
    const codePoint = entity[1] === "x" || entity[1] === "X"
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (!Number.isFinite(codePoint)) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  });
}

export function htmlToPlain(html) {
  const withBreaks = String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtml(withBreaks).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function canonicalTag(name, args) {
  const cleanName = name.toLowerCase();
  const cleanArgs = args.trim().replace(/\s+/g, " ");
  return cleanArgs ? `{% ${cleanName} ${cleanArgs} %}` : `{% ${cleanName} %}`;
}

export function extractLiquidTags(text) {
  const tags = [];
  for (const match of String(text ?? "").matchAll(TAG_PATTERN)) {
    tags.push({
      name: match[1].toLowerCase(),
      args: match[2].trim().replace(/\s+/g, " "),
      raw: canonicalTag(match[1], match[2]),
    });
  }
  return tags;
}

function uniqueTags(tags) {
  const seen = new Set();
  const unique = [];
  for (const tag of tags) {
    if (seen.has(tag.raw)) continue;
    seen.add(tag.raw);
    unique.push(tag);
  }
  return unique;
}

export function liquidFromCommentHtml(html) {
  const source = String(html ?? "");
  const tags = extractLiquidTags(htmlToPlain(source));

  for (const match of source.matchAll(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/g)) {
    tags.push({ name: "youtube", args: match[1], raw: canonicalTag("youtube", match[1]) });
  }

  for (const match of source.matchAll(
    /ltag-github-readme-tag[\s\S]{0,800}?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g,
  )) {
    const repo = `${match[1]}/${match[2].replace(/\.git$/, "")}`;
    tags.push({ name: "github", args: repo, raw: canonicalTag("github", repo) });
  }

  for (const match of source.matchAll(/(?:twitter\.com|x\.com)\/[^/"'\s]+\/status(?:es)?\/(\d+)/g)) {
    tags.push({ name: "twitter", args: match[1], raw: canonicalTag("twitter", match[1]) });
  }

  return uniqueTags(tags);
}

export function validateLiquid(text, limits = {}) {
  const maxTags = limits.maxTags ?? 15;
  const maxArgChars = limits.maxArgChars ?? 300;
  const tags = extractLiquidTags(text);
  const errors = [];

  if (tags.length > maxTags) {
    errors.push(`prose has ${tags.length} liquid tags, limit is ${maxTags}`);
  }

  const stack = [];
  for (const tag of tags) {
    if (!LIQUID_TAGS.has(tag.name)) {
      errors.push(`unknown liquid tag {% ${tag.name} %}`);
    }
    if (tag.args.length > maxArgChars) {
      errors.push(`{% ${tag.name} %} arguments are longer than ${maxArgChars} characters`);
    }
    if (/[\r\n]/.test(tag.args)) {
      errors.push(`{% ${tag.name} %} arguments must stay on one line`);
    }
    if (PAIRS[tag.name]) {
      stack.push(tag.name);
    } else if (CLOSERS.has(tag.name)) {
      const expected = CLOSERS.get(tag.name);
      const open = stack.pop();
      if (open !== expected) {
        errors.push(`{% ${tag.name} %} closes ${open ? `{% ${open} %}` : "nothing"}`);
      }
    }
  }

  for (const open of stack) {
    errors.push(`{% ${open} %} is missing {% ${PAIRS[open]} %}`);
  }

  return { ok: errors.length === 0, errors, tags };
}

export function missingRequiredTags(text, requiredTags) {
  const present = new Set(extractLiquidTags(text).map((tag) => tag.raw));
  return requiredTags.filter((tag) => !present.has(tag));
}
