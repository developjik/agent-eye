import type { Locator, Page } from "playwright";
import { openSession, settle } from "../browser.js";
import { extractPageElements, pageSignature } from "../extract.js";
import { formatCompactInteractive } from "../format.js";
import { measureChurn } from "../metrics/churn.js";
import { diffLines, filterStable, round, toVolatileFilter } from "../metrics/delta.js";
import { analyzeNoise } from "../metrics/noise.js";
import { countTokens, type TokenizerName } from "../tokens.js";
import { writeRunReports, type ReportFormat, type ReportPaths } from "../report/write.js";
import type { ChurnReport, ExtractResult, GateResult, PageSignature } from "../types.js";
import { TOOL_NAME, VERSION } from "../version.js";
import { actionOf, type RunExpectation, type RunSpec, type RunStep, type RunTarget } from "./spec.js";
import type { RunExpectationResult, RunReport, RunStepResult } from "./types.js";

export interface RunOptions {
  specPath?: string;
  tokenizer?: TokenizerName;
  outDir?: string;
  formats?: ReportFormat[];
  maxSteps?: number;
  headless?: boolean;
  executablePath?: string;
  viewport?: { width: number; height: number };
  timeoutMs?: number;
  stepTimeoutMs?: number;
  settleMs?: number;
  churnMs?: number;
  budgetTokens?: number;
  maxFalseSuccess?: number;
  maxChurnPct?: number;
  maxNoisePct?: number;
  log?: (line: string) => void;
}

export interface RunOutcome {
  report: RunReport;
  paths: ReportPaths | null;
}

class TargetError extends Error {
  constructor(
    message: string,
    readonly candidates: string[],
  ) {
    super(message);
    this.name = "TargetError";
  }
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

interface Match {
  locator: Locator | null;
  label: string;
  count: number;
  candidates: string[];
}

function suggest(extracted: ExtractResult, role: string | null, text: string | null): string[] {
  const pool = extracted.elements.filter((el) => !el.hidden);
  const query = normalize(text ?? "");
  const scored = pool
    .map((el) => {
      const name = normalize(el.name);
      let score = 0;
      if (role && normalize(el.role) === normalize(role)) score += 2;
      if (query && name.includes(query)) score += 3;
      if (query && name && (name.startsWith(query.slice(0, 3)) || query.startsWith(name.slice(0, 3)))) score += 1;
      return { el, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const fallback = pool.slice(0, 3);
  const picked = scored.length > 0 ? scored.map((entry) => entry.el) : fallback;
  const counts = new Map<string, { label: string; count: number }>();
  for (const el of picked) {
    const label = `${el.role} "${el.name || "(no name)"}"`;
    const existing = counts.get(label);
    counts.set(label, { label, count: (existing?.count ?? 0) + 1 });
  }
  return Array.from(counts.values())
    .slice(0, 3)
    .map((entry) => (entry.count > 1 ? `${entry.label} ×${entry.count}` : entry.label));
}

/**
 * Resolve a step target the way a deterministic agent would: from the compact
 * interactive view first (role + accessible name), then from a CSS selector.
 */
async function matchTarget(page: Page, target: RunTarget, extracted: ExtractResult): Promise<Match> {
  if (target.selector) {
    const locator = page.locator(target.selector);
    const count = await locator.count();
    return { locator: count > 0 ? locator.nth(target.nth ?? 0) : null, label: target.selector, count, candidates: count > 0 ? [] : suggest(extracted, null, null) };
  }

  const role = target.role ? normalize(target.role) : null;
  const text = target.name ?? target.text ?? null;
  const query = text ? normalize(text) : null;

  const matches = extracted.elements.filter((el) => {
    if (el.hidden) return false;
    if (role && normalize(el.role) !== role) return false;
    if (query && !normalize(el.name).includes(query) && !normalize(el.text).includes(query)) return false;
    return true;
  });

  if (matches.length > 0) {
    const chosen = matches[target.nth ?? 0];
    if (!chosen) {
      return { locator: null, label: `${target.role ?? "element"} "${text ?? ""}"`, count: matches.length, candidates: matches.map((el) => `${el.role} "${el.name}"`) };
    }
    const refId = chosen.ref.replace("@", "");
    return {
      locator: page.locator(`[data-agent-eye-ref="${refId}"]`).first(),
      label: `${chosen.role} "${chosen.name}"`,
      count: matches.length,
      candidates: [],
    };
  }

  // Fallback for pages cut off by the element cap: let Playwright compute the name.
  try {
    const fallback = role
      ? page.getByRole(role as Parameters<Page["getByRole"]>[0], text ? { name: text } : {})
      : text
        ? page.getByText(text)
        : null;
    const count = fallback ? await fallback.count() : 0;
    if (fallback && count > 0) {
      return { locator: fallback.nth(target.nth ?? 0), label: `${target.role ?? "text"} "${text ?? ""}"`, count, candidates: [] };
    }
  } catch {
    /* invalid role string: fall through to suggestions */
  }

  return {
    locator: null,
    label: `${target.role ?? "element"} "${text ?? ""}"`,
    count: 0,
    candidates: suggest(extracted, role, query),
  };
}

async function capture(page: Page): Promise<PageSignature> {
  return (await page.evaluate(pageSignature, { maxLines: 700 })) as PageSignature;
}

async function ariaText(page: Page): Promise<string> {
  try {
    return await page.locator("body").ariaSnapshot();
  } catch {
    return "";
  }
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? "");
}

async function countMatches(page: Page, query: { role?: string; name?: string; selector?: string }, extracted: ExtractResult): Promise<number> {
  if (query.selector) return page.locator(query.selector).count();
  const role = query.role ? normalize(query.role) : null;
  const name = query.name ? normalize(query.name) : null;
  return extracted.elements.filter((el) => {
    if (role && normalize(el.role) !== role) return false;
    if (name && !normalize(el.name).includes(name) && !normalize(el.text).includes(name)) return false;
    return true;
  }).length;
}

interface ExpectContext {
  before: PageSignature;
  after: PageSignature;
  beforeAria: string;
  afterAria: string;
  extracted: ExtractResult;
}

async function evaluateExpectations(page: Page, expectations: RunExpectation[], context: ExpectContext): Promise<RunExpectationResult[]> {
  const results: RunExpectationResult[] = [];
  const text = expectations.some((expectation) => expectation.textContains || expectation.textAbsent) ? await bodyText(page) : "";
  const url = page.url();
  const diff = diffLines(context.before.lines, context.after.lines);

  for (const expectation of expectations) {
    if (expectation.urlContains !== undefined) {
      results.push({ kind: "urlContains", expected: `url contains "${expectation.urlContains}"`, actual: url, passed: url.includes(expectation.urlContains) });
    }
    if (expectation.urlEquals !== undefined) {
      results.push({ kind: "urlEquals", expected: `url equals "${expectation.urlEquals}"`, actual: url, passed: url === expectation.urlEquals });
    }
    if (expectation.textContains !== undefined) {
      const found = text.includes(expectation.textContains);
      results.push({ kind: "textContains", expected: `page text contains "${expectation.textContains}"`, actual: found ? "found" : "not found", passed: found });
    }
    if (expectation.textAbsent !== undefined) {
      const found = text.includes(expectation.textAbsent);
      results.push({ kind: "textAbsent", expected: `page text does not contain "${expectation.textAbsent}"`, actual: found ? "found" : "not found", passed: !found });
    }
    if (expectation.elementExists) {
      const count = await countMatches(page, expectation.elementExists, context.extracted);
      results.push({
        kind: "elementExists",
        expected: `element ${expectation.elementExists.role ?? ""} "${expectation.elementExists.name ?? expectation.elementExists.selector ?? ""}" exists`,
        actual: `${count} match(es)`,
        passed: count > 0,
      });
    }
    if (expectation.elementAbsent) {
      const count = await countMatches(page, expectation.elementAbsent, context.extracted);
      results.push({
        kind: "elementAbsent",
        expected: `element ${expectation.elementAbsent.role ?? ""} "${expectation.elementAbsent.name ?? expectation.elementAbsent.selector ?? ""}" is absent`,
        actual: `${count} match(es)`,
        passed: count === 0,
      });
    }
    if (expectation.countAtLeast) {
      const count = await page.locator(expectation.countAtLeast.selector).count();
      results.push({
        kind: "countAtLeast",
        expected: `at least ${expectation.countAtLeast.n} × ${expectation.countAtLeast.selector}`,
        actual: `${count}`,
        passed: count >= expectation.countAtLeast.n,
      });
    }
    if (expectation.changed !== undefined) {
      results.push({
        kind: "changed",
        expected: expectation.changed ? "the page changes after the action" : "the page does not change",
        actual: `${diff.changed} line(s) changed`,
        passed: expectation.changed ? diff.changed > 0 : diff.changed === 0,
      });
    }
    if (expectation.ariaChanged !== undefined) {
      const changed = context.beforeAria !== context.afterAria;
      results.push({
        kind: "ariaChanged",
        expected: expectation.ariaChanged ? "the ARIA snapshot changes" : "the ARIA snapshot does not change",
        actual: changed ? "changed" : "unchanged",
        passed: expectation.ariaChanged ? changed : !changed,
      });
    }
  }
  return results;
}

function stepLabel(step: RunStep, action: string, targetLabel?: string): string {
  if (step.name) return step.name;
  if (action === "goto") return `goto ${step.url}`;
  if (targetLabel) return `${action} ${targetLabel}`;
  return action;
}

export async function runAcceptance(spec: RunSpec, options: RunOptions = {}): Promise<RunOutcome> {
  const log = options.log ?? (() => undefined);
  const tokenizer = options.tokenizer ?? "o200k_base";
  const session = await openSession({
    headless: options.headless,
    executablePath: options.executablePath,
    viewport: options.viewport,
    timeoutMs: options.timeoutMs,
  });
  const { page } = session;
  const stepTimeout = options.stepTimeoutMs ?? 5_000;
  const settleMs = options.settleMs ?? 350;
  const steps = options.maxSteps ? spec.steps.slice(0, options.maxSteps) : spec.steps;
  let churn: ChurnReport | null = null;

  try {
    const baseUrl = spec.url ?? "";
    if (baseUrl) {
      await page.goto(baseUrl, { waitUntil: "load", timeout: options.timeoutMs ?? 30_000 });
      await settle(page);
      log(`loaded ${page.url()}`);
    }

    const initialExtract = (await page.evaluate(extractPageElements, { maxElements: 400, markRefs: true })) as ExtractResult;
    const noise = analyzeNoise({
      elements: initialExtract.elements,
      totalInteractive: initialExtract.totalInteractive,
      truncated: initialExtract.truncated,
      shadowRoots: initialExtract.shadowRoots,
      frameCount: page.frames().length - 1,
      frameInteractive: 0,
    });

    const maxChurnPct = options.maxChurnPct ?? spec.budget?.maxChurnPct;
    // A short idle baseline gives the set of lines that move on their own, so a
    // ticker cannot be mistaken for the effect of a click.
    churn = await measureChurn(page, {
      durationMs: maxChurnPct !== undefined ? (options.churnMs ?? 1_500) : 600,
      intervalMs: 250,
      freezeAnimations: true,
      tokenizer,
    });
    const volatile = toVolatileFilter(churn);
    const stableLines = (signature: PageSignature): string[] => filterStable(signature.lines, signature.zones, volatile);

    const results: RunStepResult[] = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index] as RunStep;
      const action = actionOf(step);
      const startedAt = Date.now();
      const before = await capture(page);
      const beforeAria = await ariaText(page);
      const extracted = (await page.evaluate(extractPageElements, { maxElements: 400, markRefs: true })) as ExtractResult;
      const tokens = countTokens(formatCompactInteractive(extracted.elements), tokenizer);

      let error: string | undefined;
      let candidates: string[] = [];
      let ambiguous = 0;
      let targetLabel: string | undefined;

      try {
        if (action === "goto") {
          const url = step.url as string;
          const resolved = /^[a-z]+:\/\//i.test(url) ? url : new URL(url, page.url() || baseUrl || "http://127.0.0.1").toString();
          await page.goto(resolved, { waitUntil: "load", timeout: step.timeoutMs ?? 30_000 });
          targetLabel = resolved;
        } else if (action === "click" || action === "fill" || action === "press") {
          const match = await matchTarget(page, step.target as RunTarget, extracted);
          targetLabel = match.label;
          ambiguous = match.count;
          candidates = match.candidates;
          if (!match.locator) {
            throw new TargetError(`target not found: ${match.label}`, match.candidates);
          }
          if (action === "click") {
            await match.locator.click({ timeout: step.timeoutMs ?? stepTimeout });
          } else if (action === "fill") {
            await match.locator.fill(step.value as string, { timeout: step.timeoutMs ?? stepTimeout });
          } else {
            await match.locator.press(step.key as string, { timeout: step.timeoutMs ?? stepTimeout });
          }
        } else if (action === "wait") {
          await page.waitForTimeout(step.timeoutMs ?? 500);
        } else if (action === "assert") {
          // no page interaction
        } else if (action === "snapshot") {
          // measurement only
        }
      } catch (caught) {
        if (caught instanceof TargetError) {
          error = caught.message;
          candidates = caught.candidates;
        } else {
          error = ((caught as Error).message ?? "action failed").split("\n")[0];
        }
      }

      if (action !== "assert" && action !== "snapshot") await page.waitForTimeout(settleMs);
      const after = await capture(page);
      const afterAria = await ariaText(page);
      const afterExtract = (await page.evaluate(extractPageElements, { maxElements: 400, markRefs: true })) as ExtractResult;
      const beforeStable: PageSignature = { ...before, lines: stableLines(before) };
      const afterStable: PageSignature = { ...after, lines: stableLines(after) };
      const diff = diffLines(beforeStable.lines, afterStable.lines);

      const expectations = await evaluateExpectations(page, step.expect ?? [], {
        before: beforeStable,
        after: afterStable,
        beforeAria,
        afterAria,
        extracted: afterExtract,
      });

      const expectedChange = (step.expect ?? []).some((expectation) => expectation.changed === true || expectation.elementExists !== undefined);
      const falseSuccess = !error && (action === "click" || action === "fill" || action === "press") && expectedChange && diff.changed === 0;
      const failed = !!error || expectations.some((expectation) => !expectation.passed);

      results.push({
        index,
        name: stepLabel(step, action, targetLabel),
        action,
        ...(targetLabel ? { target: targetLabel } : {}),
        status: failed ? "failed" : "passed",
        tokens,
        durationMs: Date.now() - startedAt,
        changedLines: diff.changed,
        ambiguous,
        falseSuccess,
        expectations,
        ...(error ? { error } : {}),
        ...(candidates.length > 0 ? { candidates } : {}),
        finalUrl: page.url(),
      });
      log(`step ${index + 1}/${steps.length} ${failed ? "failed" : "passed"} — ${stepLabel(step, action, targetLabel)} (${tokens} tok)`);
    }

    const tokensBudget = options.budgetTokens ?? spec.budget?.tokensPerStep;
    const maxFalseSuccess = options.maxFalseSuccess ?? spec.budget?.maxFalseSuccess;
    const maxNoisePct = options.maxNoisePct ?? spec.budget?.maxNoisePct;
    const failedSteps = results.filter((result) => result.status === "failed").length;
    const falseSuccessCount = results.filter((result) => result.falseSuccess).length;
    const maxStepTokens = results.reduce((max, result) => Math.max(max, result.tokens), 0);
    const gates: GateResult[] = [
      { name: "all-steps-pass", threshold: "0 failed", actual: `${failedSteps} failed`, passed: failedSteps === 0 },
    ];
    if (tokensBudget !== undefined) {
      gates.push({ name: "tokens-per-step", threshold: `≤ ${tokensBudget}`, actual: `${maxStepTokens}`, passed: maxStepTokens <= tokensBudget });
    }
    if (maxFalseSuccess !== undefined) {
      gates.push({ name: "false-success", threshold: `≤ ${maxFalseSuccess}`, actual: `${falseSuccessCount}`, passed: falseSuccessCount <= maxFalseSuccess });
    }
    if (maxChurnPct !== undefined) {
      gates.push({
        name: "idle-churn",
        threshold: `≤ ${maxChurnPct}%`,
        actual: churn ? `${churn.unstableSamplePct}%` : "not measured",
        passed: churn ? churn.unstableSamplePct <= maxChurnPct : false,
      });
    }
    if (maxNoisePct !== undefined) {
      gates.push({ name: "noise", threshold: `≤ ${maxNoisePct}%`, actual: `${round(noise.noisePct, 1)}%`, passed: noise.noisePct <= maxNoisePct });
    }

    const failedGates = gates.filter((gate) => !gate.passed);
    const totalTokens = results.reduce((sum, result) => sum + result.tokens, 0);
    const report: RunReport = {
      schemaVersion: 1,
      tool: { name: TOOL_NAME, version: VERSION },
      generatedAt: new Date().toISOString(),
      spec: { name: spec.name ?? "acceptance run", ...(options.specPath ? { path: options.specPath } : {}), baseUrl: spec.url ?? "", steps: steps.length },
      steps: results,
      totals: {
        steps: results.length,
        passed: results.filter((result) => result.status === "passed").length,
        failed: failedSteps,
        tokens: totalTokens,
        avgTokensPerStep: results.length > 0 ? Math.round(totalTokens / results.length) : 0,
        falseSuccess: falseSuccessCount,
        ambiguousSteps: results.filter((result) => result.ambiguous > 1).length,
      },
      churn,
      gates,
      verdict: {
        status: failedGates.length === 0 ? "pass" : "fail",
        exitCode: failedGates.length === 0 ? 0 : 1,
        summary:
          failedGates.length === 0
            ? `${results.length} steps passed; ${Math.round(totalTokens / Math.max(1, results.length))} tokens/step`
            : `gate failed: ${failedGates.map((gate) => `${gate.name} (${gate.actual} vs ${gate.threshold})`).join(", ")}`,
      },
    };

    let paths: ReportPaths | null = null;
    if (options.outDir) paths = writeRunReports(report, options.outDir, options.formats ?? ["json", "md"]);
    return { report, paths };
  } finally {
    await session.close();
  }
}
