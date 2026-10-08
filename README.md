# living-post

A DEV post that starts as one sentence. GitHub Actions reads new comments, Mercury 2.5 links them into one story, and each comment id is recorded so the next run skips it. Reader names stay in the canon log. They are not characters in the story.

The article source keeps two regions the model is not allowed to touch: the rules, and an HTML comment listing every comment id that has already been addressed. If a run updates DEV and dies before it can commit `state/ledger.json`, the next run reads those ids back out of the article.

## Test it before it touches DEV

No API keys and no network:

```bash
npm test
npm run dry
```

`npm test` covers the limits, liquid tags, retries, the "already addressed" ledger, and a full fixture pass.

`npm run dry` runs the fixture comments through the same loop and writes `out/preview.md`. The fixture model appends the comment instead of calling Mercury, and it rejects any comment that contains the words `reject me`. DEV is not called. `state/ledger.json` is not changed.

`npm run pending` prints each fixture comment as `ready`, `too short`, `author`, or `addressed`.

## Rehearse on the real article

1. Copy `.env.example` to `.env` and fill in `DEV_API_KEY` and `INCEPTION_API_KEY`.
2. Create the draft:

```bash
node src/cli.js seed
```

The command prints the article id. Put it in `ARTICLE_ID`. The draft stays unpublished until you pass `--publish` or hit publish in the DEV editor. Comments open once it is public.

3. Leave a comment yourself, then do one dry run. Dry run still calls Mercury, and it does not update the article or the ledger:

```bash
SKIP_AUTHOR=false node src/cli.js run --dry-run
```

Your own comments are ignored unless `SKIP_AUTHOR=false`. That is the switch for this rehearsal. The GitHub Action leaves it on, so once strangers arrive your notes stay out of the story.

4. Read `out/preview.md`. If the prose looks right:

```bash
SKIP_AUTHOR=false node src/cli.js run
```

Run it a second time. The same comment should produce `No new comments to address.`

## GitHub Action

The workflow is `.github/workflows/weave.yml`. It runs every 5 minutes and on demand. Add these repository secrets:

- `DEV_API_KEY`
- `INCEPTION_API_KEY`
- `ARTICLE_ID`

Until `ARTICLE_ID` is set, the job runs the tests and stops. After you publish, set the repository variable `FREEZE_AT` to 48 hours later, as an ISO timestamp, if you want the title's deadline to be real. `FREEZE_AFTER=200` still applies.

A manual run with the dry-run box checked calls Mercury and writes nothing back.

## Limits

Each pass rewrites at most 3 comments into the story. Cheap rejects (too short, too long, duplicates, your own comments, unknown liquid tags) are capped at 20 per pass so a pile of `lol` cannot block a real comment forever, and cannot stamp the article 100 times.

| Limit | Default |
| --- | --- |
| Comments woven per run | 3 |
| Bookkeeping decisions per run | 20 |
| Comment length | 12–600 characters |
| Story length | 24,000 characters |
| Liquid tags in the story | 15 |
| Freeze | 200 woven comments, or `FREEZE_AT` |

## Liquid tags

Commenters put the tag in backticks so DEV returns the source instead of a rendered embed:

```
{% youtube dQw4w9WgXcQ %}
{% github forem/forem %}
```

The worker also rebuilds `{% youtube %}`, `{% github %}`, and `{% twitter %}` when it can see the rendered embed. Any other tag has to be in the allowlist in `src/liquid.js`. An unknown tag, a dropped tag, or an unclosed `{% raw %}` is rejected. Mercury is asked again, up to `MODEL_ATTEMPTS`, with the validation error attached. If it still drops the tag, the comment is marked rejected and the previous prose stays.

## Retries

DEV and Mercury requests retry on network failures, 408, 429, and 5xx. A `Retry-After` header wins over the backoff. 401 and 404 do not retry. If Mercury rejects `json_schema`, the same comment is sent once more as `json_object`.

A failed request does not mark the comment addressed, so the next run tries it again. A successful update writes the id into the article before the ledger file is saved.

## Ledger

`state/ledger.json` is the file the Action commits. The article carries the same ids here:

```html
<!-- living-post:ledger
ada1
grace1
-->
```

The two are unioned at the start of every run. A comment id in either place is done.
