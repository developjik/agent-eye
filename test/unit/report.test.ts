import { describe, expect, it } from "vitest";
import { renderHtmlProfile, renderHtmlRun } from "../../src/report/html.js";
import { renderMarkdownProfile, renderMarkdownRun } from "../../src/report/markdown.js";
import { renderComparison, renderTerminalProfile, renderTerminalRun } from "../../src/report/terminal.js";
import type { ProfileReport } from "../../src/types.js";
import type { RunReport } from "../../src/run/types.js";

export function profileFixture(): ProfileReport {
  return {
    schemaVersion: 2,
    tool: { name: "agent-eye", version: "0.1.0" },
    generatedAt: "2026-11-22T00:00:00.000Z",
    target: { url: "https://example.com/cart", finalUrl: "https://example.com/cart", title: "Cart", status: 200, viewport: { width: 1280, height: 900 }, bytes: 204800 },
    tokenizer: { name: "o200k_base", label: "o200k_base (GPT-4o / 4.1 / 5 family)", note: "approximate" },
    bill: [
      { mode: "raw-html", label: "raw HTML (page.content())", bytes: 204800, tokens: 51000, estimated: false },
      { mode: "readability-text", label: "readability text (article extraction)", bytes: 20480, tokens: 4100, estimated: false },
      { mode: "aria-snapshot", label: "ARIA snapshot (Playwright, full tree)", bytes: 30720, tokens: 7400, estimated: false },
      { mode: "interactive-refs", label: "compact interactive refs (names + states)", bytes: 4500, tokens: 980, estimated: false },
      { mode: "screenshot", label: "screenshot 1x 1280x2400 (vision estimate)", bytes: 900000, tokens: 3165, estimated: true },
    ],
    interactiveText: '@e1 [button] "Add to cart"',
    noise: {
      interactive: 42,
      analyzed: 42,
      truncated: false,
      unnamed: { count: 3, items: [{ ref: "@e9", role: "button", tag: "button", name: "", reason: "no accessible name" }] },
      duplicates: { count: 1, elements: 3, clusters: [{ role: "button", name: "Add to cart", count: 3, refs: ["@e1", "@e2", "@e3"] }] },
      hidden: { count: 2, focusable: 1, clipped: 1, items: [] },
      offscreen: { count: 1, items: [] },
      occluded: { count: 2, inViewport: 30, items: [{ ref: "@e7", role: "button", tag: "button", name: "Place order", reason: "covered", detail: "button \"Accept all\"" }] },
      frames: { count: 1, interactive: 2 },
      shadow: { roots: 1, interactive: 1 },
      noisePct: 26.2,
      ambiguousPct: 7.1,
    },
    churn: {
      durationMs: 1500,
      intervalMs: 250,
      samples: [
        { tMs: 250, lines: 60, changedVsPrevious: 2, changedVsBaseline: 2, changedPct: 3.3, refsInvalidated: 0, tokens: 400 },
        { tMs: 500, lines: 60, changedVsPrevious: 0, changedVsBaseline: 2, changedPct: 0, refsInvalidated: 0, tokens: 400 },
      ],
      lines: 60,
      unstableSamplePct: 50,
      avgChangedPct: 1.7,
      maxChangedPct: 3.3,
      refInvalidationPct: 0,
      tokensChurned: 800,
      volatileLines: [],
      volatileZones: ["#clock"],
      stable: false,
      frozenAnimations: true,
    },
    delta: {
      steps: [{ from: "initial", to: "click", linesBefore: 60, linesAfter: 62, added: 3, removed: 1, unchangedPct: 95.2, fullTokens: 420, deltaTokens: 30, savingsPct: 92.9 }],
      avgUnchangedPct: 95.2,
      avgSavingsPct: 92.9,
      note: "line-set diff",
    },
    actionTruth: {
      attempted: 5,
      effective: 3,
      noEffect: 1,
      blocked: 1,
      errored: 0,
      skipped: 7,
      falseSuccessPct: 20,
      controls: [
        { ref: "@e1", role: "button", name: "Add to cart", verdict: "effective", urlChanged: false, linesChanged: 3, networkRequests: 0, consoleErrors: 0, navigatedAway: false },
        { ref: "@e7", role: "button", name: "Place order", verdict: "blocked", urlChanged: false, linesChanged: 0, networkRequests: 0, consoleErrors: 0, navigatedAway: false, error: "another element receives the click at that point" },
      ],
      volatileLines: 0,
    },
    scorecard: { tokensPerStep: 980, noisePct: 26.2, churnPct: 50, churnMagnitudePct: 1.7, deltaSavingsPct: 92.9, falseSuccessPct: 20, occluded: 2, duplicateClusters: 1, unnamed: 3 },
    gates: [{ name: "budget-tokens", threshold: "≤ 8000", actual: "980", passed: true }],
    verdict: {
      status: "warn",
      exitCode: 0,
      summary: "3 finding(s), 2 high",
      findings: [
        { severity: "high", title: "3 controls share a label", evidence: "button \"Add to cart\" ×3", fix: "make names unique" },
        { severity: "medium", title: "2 controls are covered", evidence: "cookie banner", fix: "reserve space" },
      ],
    },
  };
}

export function runFixture(): RunReport {
  return {
    schemaVersion: 1,
    tool: { name: "agent-eye", version: "0.1.0" },
    generatedAt: "2026-11-22T00:00:00.000Z",
    spec: { name: "checkout acceptance", baseUrl: "https://example.com", steps: 2 },
    steps: [
      {
        index: 0,
        name: "add to cart",
        action: "click",
        target: 'button "Add to cart"',
        status: "passed",
        tokens: 980,
        durationMs: 300,
        changedLines: 3,
        ambiguous: 3,
        falseSuccess: false,
        expectations: [{ kind: "changed", expected: "the page changes", actual: "3 line(s) changed", passed: true }],
        finalUrl: "https://example.com/cart",
      },
      {
        index: 1,
        name: "open checkout",
        action: "click",
        target: 'button "Checkout"',
        status: "failed",
        tokens: 1010,
        durationMs: 280,
        changedLines: 0,
        ambiguous: 0,
        falseSuccess: true,
        expectations: [{ kind: "elementExists", expected: 'element button "Checkout" exists', actual: "0 match(es)", passed: false }],
        error: "target not found: button \"Checkout\"",
        candidates: ['button "Check out"', 'link "Checkout help"'],
        finalUrl: "https://example.com/cart",
      },
    ],
    totals: { steps: 2, passed: 1, failed: 1, tokens: 1990, avgTokensPerStep: 995, falseSuccess: 1, ambiguousSteps: 1 },
    churn: null,
    gates: [{ name: "all-steps-pass", threshold: "0 failed", actual: "1 failed", passed: false }],
    verdict: { status: "fail", exitCode: 1, summary: "gate failed: all-steps-pass (1 failed vs 0 failed)" },
  };
}

describe("terminal report", () => {
  it("renders the scorecard, findings and result", () => {
    const text = renderTerminalProfile(profileFixture());
    expect(text).toContain("Observation bill");
    expect(text).toContain("compact interactive refs");
    expect(text).toContain("noise");
    expect(text).toContain("false success");
    expect(text).toContain("3 controls share a label");
    expect(text).toContain("PASS  budget-tokens");
    expect(text).toContain("Result: WARN");
  });

  it("compares before and after", () => {
    const before = profileFixture();
    const after = profileFixture();
    after.scorecard.tokensPerStep = 490;
    after.scorecard.noisePct = 0;
    const text = renderComparison(before, after);
    expect(text).toContain("before");
    expect(text).toContain("-50.0%");
  });

  it("renders a failing run with candidates", () => {
    const text = renderTerminalRun(runFixture());
    expect(text).toContain("checkout acceptance");
    expect(text).toContain("false success");
    expect(text).toContain('closest candidates: button "Check out"');
    expect(text).toContain("Result: FAIL");
  });
});

describe("markdown report", () => {
  it("includes every section", () => {
    const text = renderMarkdownProfile(profileFixture());
    expect(text).toContain("# agent-eye report");
    expect(text).toContain("## Observation bill");
    expect(text).toContain("## Scorecard");
    expect(text).toContain("## Ambiguous labels");
    expect(text).toContain("## Findings");
    expect(text).toContain("**Result: WARN**");
  });

  it("renders run steps and failures", () => {
    const text = renderMarkdownRun(runFixture());
    expect(text).toContain("# agent-eye run — checkout acceptance");
    expect(text).toContain("### Step 2: open checkout");
    expect(text).toContain("**Result: FAIL**");
  });
});

describe("html report", () => {
  it("is a self-contained document with the scorecard", () => {
    const html = renderHtmlProfile(profileFixture());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("Observation bill");
    expect(html).toContain("agent-eye 0.1.0");
    expect(html).not.toContain("<script src=");
  });

  it("renders run detail", () => {
    const html = renderHtmlRun(runFixture());
    expect(html).toContain("open checkout");
    expect(html).toContain("closest:");
  });
});
