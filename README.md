# agent-eye

**Lighthouse for the page an AI agent reads.** Point it at one URL and it tells you what a browser agent actually pays and sees there: tokens per step, how much of the page is noise, how much of the snapshot moves on its own, how much a delta protocol would save, and how many clicks "succeed" without changing anything.

Local, deterministic, no LLM calls, no telemetry. TypeScript + Playwright.

[한국어 README](README.ko.md) · [CI](../../actions/workflows/ci.yml) · MIT · [![npm](https://img.shields.io/npm/v/@developjik/agent-eye.svg)](https://www.npmjs.com/package/@developjik/agent-eye)

```
$ agent-eye https://your.app/checkout

Observation bill (one step)
mode                                         bytes     tokens  vs cheapest
raw HTML (page.content())                    1.2 MB  212,904 tok        ×260
readability text (article extraction)         38 KB    7,645 tok         ×9.3
ARIA snapshot (Playwright, full tree)         61 KB   11,338 tok        ×13.8
compact interactive refs (names + states)    3.9 KB      821 tok         ×1.0
screenshot 1x 1280x2400 (vision estimate)    684 KB    3,165 tok         ×3.9

noise             37% of 19 analyzed · 3 elements in 1 duplicate cluster
occluded          2 controls covered at their click point
idle churn        6/6 samples changed · 7.7% of lines · 2,453 tokens rescanned in 1.5s
delta headroom    92.1% saved if only changed lines were sent
action truth      3/6 effective · 1 no-effect (16.7% false success) · 2 blocked
```

## Why measure the page, not the driver

Browser agents see your page as a snapshot: an accessibility tree, a markdown blob, or a screenshot. Drivers are getting fast; the page they read is still unmeasured. That gap shows up as bugs in the most popular driver:

- [`agent-browser#2094`](https://github.com/vercel-labs/agent-browser/issues/2094): a lifecycle object on every response adds **~10k tokens per session**
- [`#2096`](https://github.com/vercel-labs/agent-browser/issues/2096): screenshots need a downscale option to cut image tokens
- [`#2652`](https://github.com/vercel-labs/agent-browser/issues/2652), [`#1926`](https://github.com/vercel-labs/agent-browser/issues/1926), [`#2000`](https://github.com/vercel-labs/agent-browser/issues/2000): commands **report success and change nothing**
- [`#2653`](https://github.com/vercel-labs/agent-browser/issues/2653): rows that share their first 48 characters get identical hints

None of that is visible from the page's side, and none of it is in your CI. `agent-eye` measures the page as an agent receives it, before a model is involved: if a deterministic rule-based agent cannot address your checkout, a better model will not save it.

## Quick start

Published on npm as [`@developjik/agent-eye`](https://www.npmjs.com/package/@developjik/agent-eye) — no clone needed:

```bash
npx -y @developjik/agent-eye demo      # profiles the built-in demo storefront
npx -y @developjik/agent-eye https://your.app/checkout --out agent-eye-report
```

Playwright's Chromium is downloaded on first run. To run from source instead (development):

```bash
git clone https://github.com/developjik/agent-eye
cd agent-eye
npm install
npx playwright install chromium      # skip if Chromium is already installed
npm run build

node dist/bin/agent-eye.js demo
node dist/bin/agent-eye.js https://your.app/checkout --out agent-eye-report
```

`agent-eye profile <url>` is the same command. Reports land in `agent-eye-report/` as `report.json`, `report.md` (add `--html` or `--format json,md,html` for the single-file HTML report) plus `screenshot.png`.

Useful flags:

```bash
--out <dir>              write reports (default: terminal only)
--format json,md,html    report formats
--budget-tokens 8000     exit 1 when a step costs more than 8000 tokens
--max-false-success 5    exit 1 when more than 5% of probed clicks do nothing
--max-churn-pct 20       exit 1 when more than 20% of idle samples differ
--max-noise-pct 25       exit 1 when more than 25% of controls are noisy
--churn-ms 1500          idle sampling window (0 disables)
--probes 5               non-destructive controls to click (0 disables, --no-probe)
--storage-state auth.json  profile a logged-in page (Playwright storage state)
--tokenizer cl100k_base  count with the GPT-4 family tokenizer instead of o200k_base
--viewport 1280x900 --headed --timeout 30000 --chromium /path/to/chrome
```

## The five measurements

| # | Measurement | Question it answers | What the report shows |
| --- | --- | --- | --- |
| 1 | **Observation bill** | What does one look at this page cost? | Bytes and tokens for raw HTML, Readability text, Playwright's ARIA snapshot, compact interactive refs, and a full-page screenshot (vision-token estimate) |
| 2 | **Noise & ambiguity** | Can an agent tell controls apart? | Unnamed controls, duplicate `(role, name)` clusters, hidden/clipped/off-screen controls, controls covered at their click point, iframe and shadow-DOM coverage |
| 3 | **Idle churn** | Does the page change while nobody touches it? | How many samples differ, what share of lines move, how many refs go stale, how many tokens get re-read |
| 4 | **Delta headroom** | How much would a delta protocol save? | Unchanged share between consecutive step snapshots and the savings from sending only changed lines |
| 5 | **Action truth** | Did the click do anything? | For each probed control: effective, no-effect (false success), or blocked — with the evidence |

Every finding in the report carries an evidence line and a concrete fix, for example:

```
[high] 3 controls share a label with another control
    evidence: 1 (role, name) cluster(s); worst is button "Add to cart" ×3 (@e7, @e8, @e9).
              An agent that targets by accessible name cannot pick the right one.
    fix: Make each name unique ("Add Aria Headphones to cart"), or scope it with a
         labelled region so name + context is unique.
```

## Acceptance runs: `agent-eye run`

`profile` measures one page. `run` executes a declared flow like a deterministic, rule-based agent (it reads only the compact interactive view — no model), then gates the result. A failure here means the page could not be operated, not that a model had a bad day.

```yaml
# checkout.acceptance.yml
name: checkout acceptance
url: https://staging.example.com/cart

budget:
  tokensPerStep: 8000
  maxFalseSuccess: 0
  maxChurnPct: 15

steps:
  - name: add the headphones
    target: { role: button, name: "Add the Aria Headphones to cart" }   # role + accessible name
    expect:
      - changed: true
      - textContains: "Added to your cart."

  - name: open shipping details
    target: { role: button, name: "Shipping details" }
    expect:
      - changed: true
      - textContains: "Ships in 2 business days"

  - name: checkout is reachable
    do: assert
    expect:
      - elementExists: { role: button, name: "Place order" }
```

```bash
agent-eye run checkout.acceptance.yml --out agent-eye-report
```

```
   1 ✗ add the headphones by name              221 tok
       error: target not found: button "Add the Aria Headphones to cart"
       closest candidates: button "Add to cart" ×3
   2 ✗ open shipping details                   221 tok  false success
       expected the page changes after the action — got 0 line(s) changed
```

Steps support `goto`, `click`, `fill`, `press`, `wait`, `assert`, `snapshot`. Targets resolve by `role` + `name` (substring match on the accessible name), `text`, `selector`, or `nth`. Expectations: `urlContains`, `urlEquals`, `textContains`, `textAbsent`, `elementExists`, `elementAbsent`, `countAtLeast`, `changed`, `ariaChanged`.

Three things make it useful in CI:

- **Ambiguity is reported, not hidden.** If a name matches five controls, the step still runs (at `nth`, default 0) and the report says `ambiguous ×5` — the same ambiguity that makes a real agent pick the wrong row.
- **False success is first class.** A click that reports fine but leaves the snapshot unchanged fails the step, even when no expectation mentions it.
- **Churn cannot fake success.** Before the steps, `run` samples the idle page for 600 ms and ignores the lines/regions that move on their own. A ticker cannot make a dead button look alive.

Gates: `all-steps-pass` (always), plus `tokens-per-step`, `false-success`, `idle-churn`, `noise` when a budget is given in the spec or on the command line. Exit code is `1` when any gate fails, `2` for usage errors.

## In CI

```yaml
- name: Agent readability gate
  run: |
    node dist/bin/agent-eye.js profile "$PREVIEW_URL" --out agent-eye-report \
      --format json,md --budget-tokens 8000 --max-false-success 5 --max-churn-pct 20
```

Profile JSON uses `schemaVersion: 2`, while acceptance-run JSON keeps `schemaVersion: 1`; the Markdown report is meant to be attached to a pull request, and `--format html` produces a single file with inline styles and an embedded screenshot for a preview comment or an artifact.

## What the numbers mean

Honest definitions, because a metric nobody can audit is marketing:

- **Tokens** are counted locally with [`gpt-tokenizer`](https://github.com/niieani/gpt-tokenizer) (`o200k_base` by default, `cl100k_base` optional). Expect a few percent drift against a vendor tokenizer: compare ratios (mode vs mode, before vs after), not absolute values. Texts over 2M characters are sampled and the report says so.
- **Vision tokens** use the documented tiling rule for OpenAI high-detail images (fit 2048×2048, shortest side 768, 512px tiles at 170 tokens + 85) and Anthropic's ~1 token per 750 pixels. Both are estimates and marked `estimated: true`.
- **Noise %** is the share of analyzed interactive controls that are unnamed, share a `(role, name)` with another control, are hidden or clipped below 2px, or sit outside the document. Duplicate clusters count every member, because any of them is a coin flip for a name-based agent. Controls hidden with `hidden`/`display:none` and *not* reachable are not counted.
- **Occlusion** is sampled once: `elementFromPoint` at the control's centre in the current viewport. If something else is on top, that is the topmost element and the report names it.
- **Idle churn** reports both the frequency (share of samples that differed from the previous one) and the magnitude (average share of lines per sample), plus how many refs became stale and how many tokens were re-read. CSS animations are paused during the sample; JS timers are not.
- **Delta headroom** is a line-set diff between consecutive step snapshots (in `profile`, the safe probes supply the steps). Refs are renumbered every step, so treat the number as an upper bound on what a delta protocol would save.
- **Action truth** clicks only controls on an allowlist: named, enabled, non-destructive buttons/tabs/checkboxes/switches/radios/summary elements, not inside a form, not links. Labels matching delete/pay/buy/order/submit/send/logout/cancel/… (English and Korean) are never clicked. A click is `effective` when the URL changes or the *stable* part of the snapshot changes; `no-effect` when neither happens (a false-success candidate); `blocked` when the driver could not click it (overlay, off-screen, hidden, never stable). Network activity and console errors are recorded but not used as verdicts, since a page can poll on its own.

## Safety

- **No model, no network calls of its own.** Everything is computed locally; nothing leaves the machine. There is no telemetry.
- **Read-mostly.** `profile` loads a page, reads it, and clicks only the non-destructive allowlist above (disable with `--no-probe` for a strictly read-only run). It never types into fields, never submits a form, never follows a link.
- **Destructive labels are excluded even when a page mislabels them.** `run` follows your spec, including `fill`, so point it at staging or a test account, not at a live checkout with a real card.
- **Nothing is deleted or written back to the page** except the temporary `data-agent-eye-ref` attribute used to address elements, which never persists beyond the session.

## Limitations

- Accessibility names are approximated for the compact view (`aria-label`, `aria-labelledby`, labels, text, placeholder, title). The ARIA-snapshot mode uses Playwright's own tree, so the two can disagree on odd markup.
- Occlusion is measured at the initial viewport only; elements below the fold are not checked against fixed headers.
- One URL per invocation; no crawling, no multi-step navigation unless your `run` spec does it.
- Shadow DOM is pierced when open; closed shadow roots and cross-origin iframes are counted as coverage gaps, not inspected.
- `profile` probes at most 5 controls by default (`--probes`), so the false-success rate is a sample, not a census.

## The demo

`agent-eye demo` serves two versions of the same storefront from memory and reports both:

| metric | before | after | change |
| --- | ---: | ---: | ---: |
| tokens / step (compact refs) | 221 tok | 223 tok | +0.9% |
| noise | 37% | 0% | −100% |
| idle churn (samples that changed) | 100% | 0% | −100% |
| false success | 16.7% | 0% | −100% |
| occluded controls | 2 | 0 | −100% |

The "before" page is a plausible checkout: a cookie banner over the CTA, three identical "Add to cart" buttons, two unlabelled icon buttons, a millisecond clock and a rotating promo, a toggle wired to nothing, a 1px-clipped focusable button, an off-screen button, an iframe and a shadow-DOM widget. The "after" page fixes each one. Naming controls properly costs 2 tokens and removes a third of the noise. Reports for both pages, plus a passing acceptance run on the clean page and a failing one on the noisy page, are written to `agent-eye-report/`.

## Development

```bash
npm run typecheck    # tsc, no emit
npm run build        # dist/ (bin included)
npm test             # build + 57 unit and Playwright e2e tests
npm run demo         # build + demo
npm run pack:check   # npm pack --dry-run
```

Tests run against the real fixture server with real Chromium: the bill, the noise buckets, churn on a ticking page, the dead toggle, the covered button, the acceptance gates, and the CLI's exit codes are all asserted. `AGENT_EYE_CHROMIUM=/path/to/chrome` points Playwright at a specific binary; in CI it installs its own.

Layout: `src/extract.ts` (in-page collection), `src/metrics/*` (bill, noise, churn, delta, action truth), `src/profile.ts` (orchestration + findings), `src/run/*` (spec + deterministic runner), `src/report/*` (terminal, Markdown, JSON, HTML), `src/demo/*` (fixture app).

## License

MIT

### Unmeasured click probes

`falseSuccessPct` is `null` when probes are disabled or no safe control was attempted, not a measured 0%. Reports state the reason. A requested `--max-false-success` gate fails in either case and the CLI exits 1. With at least one attempted control, the existing percentage and threshold rules apply. Only measured results can pass this gate.

Profile JSON uses `schemaVersion: 2`: `scorecard.falseSuccessPct` and `actionTruth.falseSuccessPct` are nullable. Consumers of version 1 must handle `null` as unmeasured, not zero. Acceptance-run JSON keeps its separate version 1 schema.

## Development baseline (DEV-128)

Use Node.js 22.12.0 (`.nvmrc`) for development and CI. Vitest 5.1.1 requires Node 22.12+ on its supported release lines; Node 20.19 is outside its declared development support range. It may execute there, but CI does not treat that as supported test-runner usage. This development requirement does not change the package engine declaration. Runtime compatibility must be checked using the built package, separately from the test runner. TypeScript 7.0.2 is the development compiler baseline.


## Site crawl

```sh
agent-eye crawl https://your-site.example --out audit --format json,md,html
agent-eye crawl https://your-site.example --sitemap https://your-site.example/sitemap.xml --budget-tokens 8000
agent-eye crawl https://your-site.example --max-pages 100 --concurrency 2 --max-noise-pct 20
```

Crawl tries `/sitemap.xml` (urlset or sitemapindex), then falls back to same-origin
rendered links using breadth-first batches. An explicit --sitemap must load and
parse successfully. Only HTTP(S) URLs without credentials are allowed. Fragments
are removed and URLs deduplicated. Sitemap documents and redirects stay on the
root origin; profile navigation still follows browser redirects before an
outside-origin final page is marked incomplete and excluded from totals. This
is not a network sandbox. Only audit sites you own or are allowed to test.

Default100 pages (1..1000),2 concurrent profiles (1..4),20 sitemap documents,
5MB decoded XML per document,32 levels,64 namespaces and2000 links per page
bound the discovery. DTD/entity declarations are rejected. Invalid child maps
or locations are recorded as warnings; discovery caps are explicit. A compressed
.gz file is unsupported unless HTTP Content-Encoding serves decoded XML.

Crawl defaults differ deliberately from single-page profile: click probes and
screenshots are off, and optional storage-state requires a site you trust.
Use --probes 5 or --screenshot to opt in. Probes can perform real actions and
repeat server-side effects. The existing profile/run defaults are unchanged.
Each profile has its own browser context. JavaScript in loaded pages still runs.

The aggregate report holds a full profile per page, a per-page table, total/mean
compact interactive tokens, mean page noise percentage, highest-token and
highest-noise rankings. Totals describe one observation per complete page, not a
forecast of a real agent task. Failed/HTTP-error/cross-origin pages are recorded
but excluded from sums/means. Budget gates remain per-page, including explicit
unmeasured gates. Any page gate failure, failed page or truncated/incomplete
discovery makes crawl exit1, matching profile's runtime/gate-failure code.
CLI usage errors exit2. Existing single-page commands and outputs stay unchanged.

--out writes a unique crawl-* folder with selected report.json/.md/.html files.
Report URLs/snippets are untrusted data and escaped for Markdown/HTML; HTML has
no scripts or external resources. JSON keeps original evidence. Full profiles
remain in memory, so lower max-pages/concurrency for unusually large pages.
No claim is made that bounded discovery found every URL on a site.

Crawl --screenshot measures screenshot token cost but does not save per-page
image files; no image path is available in the aggregate. Redirect aliases share
a canonical final URL and are marked DUPLICATE, excluded from totals/rankings.

### Offline observation + hidden-instruction audit

```sh
agent-eye audit --eye profile/report.json --leak scan/snapshot.json \
  --out saved-audit --format json,md,html
```

`audit` reads saved **single-URL** agent-eye profile schemaVersion2 and
agentleak.snapshot/v1 JSON files. It never visits the site or runs the other tool.
Both inputs are optional individually: an omitted, unreadable or invalid source
is marked missing/failed, not a pass or a safe page. At least one file is required.
It preserves original metrics/verdicts and scanner warning meanings in separate
sections, with tool versions, requested/final URLs, measurement times, local-file
links and SHA256 hashes. There is no combined safety score. Tokens/step are the
original compact observation count, not a dollar cost. Scanner findings are
warnings, not proof of intent; no findings is not a safety certificate.

Requested/final URL or timestamp differences and incomplete scan observations
are explicit warnings. Timestamp equality does not establish equal page contents.
Timestamp-only differences are advisory and do not fail CI. Exit0 means both
sources were read and targets matched without incomplete coverage, **not**
that either tool passed its own gates or that the page is safe. Exit1 means a
missing/failed/target-mismatched/incomplete input; exit2 is CLI usage. Existing profile,
run, crawl and their exit codes are unchanged. Output uses a fresh audit-* folder.

Each local input must be a non-symlink regular JSON file below20MB. Reports retain
full source JSON, including evidence that may be sensitive. Keep reports private;
local-file links are useful only where the original saved files remain accessible.
No remote image, target URL, evidence markup or script is executed by the HTML
report. A crawl aggregate is not accepted as a single-page snapshot.
