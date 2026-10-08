import assert from "node:assert/strict";
import test from "node:test";
import { htmlToPlain, liquidFromCommentHtml, validateLiquid } from "../src/liquid.js";

test("reads a liquid tag out of a code span", () => {
  const html = "<p>Play this.</p><p><code>{% youtube dQw4w9WgXcQ %}</code></p>";
  assert.match(htmlToPlain(html), /\{% youtube dQw4w9WgXcQ %\}/);
  const tags = liquidFromCommentHtml(html);
  assert.deepEqual(tags.map((tag) => tag.raw), ["{% youtube dQw4w9WgXcQ %}"]);
});

test("rebuilds a youtube tag from a rendered embed", () => {
  const html = '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>';
  assert.deepEqual(liquidFromCommentHtml(html).map((tag) => tag.raw), ["{% youtube dQw4w9WgXcQ %}"]);
});

test("rebuilds a github tag only from the readme embed", () => {
  const html = '<div class="ltag-github-readme-tag"><a href="https://github.com/forem/forem">forem</a></div>';
  assert.deepEqual(liquidFromCommentHtml(html).map((tag) => tag.raw), ["{% github forem/forem %}"]);
});

test("rejects unknown and unbalanced liquid tags", () => {
  assert.equal(validateLiquid("{% youtube dQw4w9WgXcQ %}").ok, true);
  assert.equal(validateLiquid("{% raw %}keep{% endraw %}").ok, true);
  assert.match(validateLiquid("{% system rm %}").errors[0], /unknown liquid tag/);
  assert.match(validateLiquid("{% raw %}never closed").errors[0], /endraw/);
});

test("caps how many liquid tags the story can hold", () => {
  const tags = Array.from({ length: 4 }, (_, index) => `{% user person${index} %}`).join("\n");
  const result = validateLiquid(tags, { maxTags: 3, maxArgChars: 50 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /limit is 3/);
});
