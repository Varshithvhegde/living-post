import { requestJson } from "./http.js";

export function createDevClient({ apiKey, baseUrl, fetchImpl, attempts, baseMs, sleep }) {
  if (!apiKey) throw new Error("DEV_API_KEY is missing");
  const root = baseUrl.replace(/\/$/, "");
  const headers = {
    "api-key": apiKey,
    accept: "application/json",
    "content-type": "application/json",
  };

  function send(method, path, body) {
    return requestJson(`${root}${path}`, {
      method,
      headers,
      body,
      fetchImpl,
      attempts,
      baseMs,
      sleep,
    });
  }

  return {
    async getArticle(id) {
      const article = await send("GET", `/articles/${encodeURIComponent(id)}`);
      if (!article?.body_markdown) {
        throw new Error(`Article ${id} did not include body_markdown`);
      }
      return article;
    },

    async getComments(articleId) {
      const seen = new Set();
      const all = [];
      for (let page = 1; page <= 20; page += 1) {
        const batch = await send("GET", `/comments?a_id=${encodeURIComponent(articleId)}&page=${page}`);
        if (!Array.isArray(batch) || batch.length === 0) break;
        const before = seen.size;
        collect(batch, seen, all);
        if (seen.size === before) break;
      }
      return all;
    },

    updateArticle(id, bodyMarkdown) {
      return send("PUT", `/articles/${encodeURIComponent(id)}`, {
        article: { body_markdown: bodyMarkdown },
      });
    },

    createArticle({ bodyMarkdown, published }) {
      return send("POST", "/articles", {
        article: {
          title: "This Post Is Empty. The Comments Are the Article. I'm Freezing It in 48 Hours.",
          published: Boolean(published),
          body_markdown: bodyMarkdown,
          tags: ["showdev", "discuss", "meta", "javascript"],
        },
      });
    },
  };
}

function collect(comments, seen, all) {
  for (const comment of comments || []) {
    const id = String(comment.id_code || comment.id || "");
    if (id && !seen.has(id)) {
      seen.add(id);
      const { children, ...rest } = comment;
      all.push(rest);
      if (children?.length) collect(children, seen, all);
      continue;
    }
    if (comment.children?.length) collect(comment.children, seen, all);
  }
}
