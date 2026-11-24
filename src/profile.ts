import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { openSession, settle } from "./browser.js";
import { extractPageElements, INTERACTIVE_SELECTOR, pageSignature } from "./extract.js";
import { formatCompactInteractive } from "./format.js";
import { measureActionTruth } from "./metrics/action-truth.js";
import { measureBill } from "./metrics/bill.js";
import { measureChurn } from "./metrics/churn.js";
import { computeDelta, round } from "./metrics/delta.js";
import { analyzeNoise } from "./metrics/noise.js";
import { countTokens, pngSize, TOKENIZER_LABELS, TOKENIZER_NOTE } from "./tokens.js";
import { writeProfileReports, type ReportFormat, type ReportPaths } from "./report/write.js";
import type {
  ActionTruthReport,
  ChurnReport,
  DeltaReport,
  ExtractResult,
  Finding,
  GateResult,
  ModeBill,
  NoiseReport,
  ProfileReport,
  Scorecard,
  TokenizerName,
} from "./types.js";
import { TOOL_NAME, VERSION } from "./version.js";

export interface ProfileOptions {
  /** Collect a bounded set of main-frame links before probes, for crawl. */
  collectLinks?: boolean;
  url: string;
  outDir?: string;
  formats?: ReportFormat[];
  tokenizer?: TokenizerName;
  viewport?: { width: number; height: number };
  churnMs?: number;
  churnIntervalMs?: number;
  probes?: boolean;
  maxProbes?: number;
  maxElements?: number;
  freezeAnimations?: boolean;
  fullPageScreenshot?: boolean;
  storageState?: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  budgetTokens?: number;
  maxFalseSuccess?: number;
  maxChurnPct?: number;
  maxNoisePct?: number;
  headless?: boolean;
  executablePath?: string;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export interface ProfileOutcome {
  links?: string[];
  report: ProfileReport;
  paths: ReportPaths | null;
}

interface Screenshot {
  png: Buffer;
  jpeg: Buffer;
  width: number;
  height: number;
}

async function captureScreenshots(page: Page): Promise<Screenshot | null> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  try {
    const png = await page.screenshot({ fullPage: true, type: "png" });
    const jpeg = await page.screenshot({ fullPage: true, type: "jpeg", quality: 78 });
    const dims = pngSize(png);
    return { png, jpeg, width: dims.width || viewport.width, height: dims.height || viewport.height };
  } catch {
    try {
      const png = await page.screenshot({ type: "png" });
      const jpeg = await page.screenshot({ type: "jpeg", quality: 78 });
      const dims = pngSize(png);
      return { png, jpeg, width: dims.width || viewport.width, height: dims.height || viewport.height };
    } catch {
      return null;
    }
  }
}

async function countFrameInteractivity(page: Page): Promise<{ count: number; interactive: number }> {
  const frames = page.frames().slice(1);
  let interactive = 0;
  for (const frame of frames) {
    try {
      interactive += await frame.evaluate((selector) => document.querySelectorAll(selector).length, INTERACTIVE_SELECTOR);
    } catch {
      /* cross-origin or detached frame: counts stay unknown, which the report can say */
    }
  }
  return { count: frames.length, interactive };
}

function severityRank(finding: Finding): number {
  return finding.severity === "high" ? 0 : finding.severity === "medium" ? 1 : 2;
}

function buildFindings(input: {
  bill: ModeBill[];
  noise: NoiseReport;
  churn: ChurnReport | null;
  delta: DeltaReport | null;
  actionTruth: ActionTruthReport | null;
  tokensPerStep: number;
}): Finding[] {
  const findings: Finding[] = [];
  const { bill, noise, churn, delta, actionTruth, tokensPerStep } = input;

  if (noise.duplicates.clusters.length > 0) {
    const top = noise.duplicates.clusters[0] as NoiseReport["duplicates"]["clusters"][number];
    findings.push({
      severity: "high",
      title: `${noise.duplicates.elements} controls share a label with another control`,
      evidence: `${noise.duplicates.count} (role, name) cluster(s); worst is ${top.role} "${top.name}" ×${top.count} (${top.refs.slice(0, 4).join(", ")}). An agent that targets by accessible name cannot pick the right one.`,
      fix: "Make each name unique and specific (\"Add Aria Headphones to cart\", not \"Add to cart\"), or scope it with a labelled region so the name plus context is unique.",
    });
  }

  if (noise.unnamed.count > 0) {
    findings.push({
      severity: noise.noisePct > 25 ? "high" : "medium",
      title: `${noise.unnamed.count} interactive controls have no accessible name`,
      evidence: `${noise.unnamed.items
        .slice(0, 3)
        .map((item) => `${item.ref} <${item.tag}> (${item.role})`)
        .join(", ")} appear to an agent as a role with no purpose.`,
      fix: "Add an aria-label that names the action, and a visible label or tooltip where a human needs it too.",
    });
  }

  if (noise.occluded.count > 0) {
    const first = noise.occluded.items[0];
    findings.push({
      severity: "high",
      title: `${noise.occluded.count} controls are covered at their click point`,
      evidence: `${first ? `${first.ref} ${first.role} "${first.name}" is covered by ${first.detail ?? "another element"}` : ""}. This is the cookie-banner failure: the driver clicks, the overlay receives it, and the run reports success.`,
      fix: "Keep persistent overlays from covering primary actions (reserve their space, or make the banner dismissible before the CTA is reachable).",
    });
  }

  if (noise.hidden.focusable > 0 || noise.hidden.clipped > 0) {
    findings.push({
      severity: "medium",
      title: `${noise.hidden.focusable} hidden or clipped controls remain reachable`,
      evidence: `${noise.hidden.clipped} are rendered at under 2px (the classic "visually hidden" clip). They stay in the tab order while an agent sees no target where the click lands.`,
      fix: "Use `hidden`/`display:none` and drop tabindex for controls that are not on screen, instead of clipping them to 1px.",
    });
  }

  if (noise.offscreen.count > 0) {
    findings.push({
      severity: "low",
      title: `${noise.offscreen.count} interactive elements sit at coordinates outside the document`,
      evidence: "An agent that clicks their box clicks nowhere, with no error.",
      fix: "Render them in flow, or remove them from the DOM until they are needed.",
    });
  }

  if (noise.frames.interactive > 0) {
    findings.push({
      severity: "low",
      title: `${noise.frames.interactive} interactive elements live inside ${noise.frames.count} iframe(s)`,
      evidence: "A main-frame snapshot misses them, and refs do not cross frame boundaries unless the harness knows to look.",
      fix: "Bring primary flows into the main document, or expose a stable labelled frame the agent can address.",
    });
  }

  if (churn && (churn.unstableSamplePct >= 25 || churn.avgChangedPct >= 5)) {
    findings.push({
      severity: churn.unstableSamplePct >= 75 || churn.avgChangedPct >= 20 ? "high" : "medium",
      title: `The snapshot changed in ${churn.unstableSamplePct}% of idle samples`,
      evidence: `${churn.lines} lines sampled over ${(churn.durationMs / 1000).toFixed(1)}s: ${churn.unstableSamplePct}% of samples differed from the previous one, an average of ${churn.avgChangedPct}% of lines per sample (up to ${churn.maxChangedPct}% against the first), and ${churn.refInvalidationPct}% of refs stopped being valid. Tickers, carousels, and live clocks make every step cost more and make "did my click work?" unanswerable.`,
      fix: "Stop timers and animation when nothing changed, mark volatile regions with aria-live only where needed, and freeze decorative motion for reduced-motion users.",
    });
  }

  if (actionTruth && actionTruth.noEffect > 0) {
    findings.push({
      severity: (actionTruth.falseSuccessPct ?? 0) >= 20 ? "high" : "medium",
      title: `${actionTruth.noEffect} of ${actionTruth.attempted} probed clicks changed nothing`,
      evidence: `${actionTruth.falseSuccessPct}% false success. ${actionTruth.controls
        .filter((control) => control.verdict === "no-effect")
        .slice(0, 3)
        .map((control) => `${control.role} "${control.name}"`)
        .join(", ")} accepted a click and left the page as it was.`,
      fix: "Make the state change observable (visible update, aria-expanded/checked, or a live region) and wire the control to it; disable controls that have no effect.",
    });
  }

  if (actionTruth && actionTruth.blocked > 0) {
    findings.push({
      severity: "medium",
      title: `${actionTruth.blocked} probed clicks could not reach their control`,
      evidence: "Playwright refused the click: another element received the pointer events, or the control had no clickable box (hidden, clipped, or off-screen). The driver reports a failure here only if it checks; many report success.",
      fix: "Check stacking order and pointer-events, and keep controls that are in the accessibility tree on screen.",
    });
  }

  if (delta && delta.avgSavingsPct >= 20) {
    findings.push({
      severity: "low",
      title: `Sending only changed lines would cut ${delta.avgSavingsPct}% of each step`,
      evidence: `${delta.avgUnchangedPct}% of the snapshot is unchanged between consecutive steps. A delta protocol (stable ids + changed lines) is a page-level fix that no driver can do alone.`,
      fix: "Expose stable ids for regions that repeat, and keep unrelated parts of the page from re-rendering between steps.",
    });
  }

  const screenshot = bill.find((mode) => mode.mode === "screenshot");
  const compact = bill.find((mode) => mode.mode === "interactive-refs");
  if (screenshot && compact && compact.tokens > 0 && screenshot.tokens > compact.tokens * 3) {
    findings.push({
      severity: "low",
      title: `A screenshot costs ${Math.round(screenshot.tokens / compact.tokens)}× the compact text view`,
      evidence: `${screenshot.tokens} vs ${compact.tokens} tokens per step. Vision is the expensive way to read this page.`,
      fix: "Make the accessible structure complete enough that an agent does not have to look at pixels: names, roles, and states on every interactive element.",
    });
  }

  if (tokensPerStep > 8000) {
    findings.push({
      severity: tokensPerStep > 20000 ? "high" : "medium",
      title: `One step costs ${Math.round(tokensPerStep).toLocaleString("en-US")} tokens of compact refs`,
      evidence: "Every step of every run pays this. Under a typical context window this is the difference between 30 steps and 3.",
      fix: "Cut the interactive set to what the task needs (progressive disclosure, no hidden duplicates), and keep long text out of the interactive view.",
    });
  }

  return findings.sort((a, b) => severityRank(a) - severityRank(b));
}

function buildGates(options: ProfileOptions, scorecard: Scorecard, churn: ChurnReport | null): GateResult[] {
  const gates: GateResult[] = [];
  if (options.budgetTokens !== undefined) {
    gates.push({
      name: "budget-tokens",
      threshold: `≤ ${options.budgetTokens}`,
      actual: `${Math.round(scorecard.tokensPerStep)}`,
      passed: scorecard.tokensPerStep <= options.budgetTokens,
    });
  }
  if (options.maxFalseSuccess !== undefined) {
    gates.push({
      name: "max-false-success",
      threshold: `≤ ${options.maxFalseSuccess}%`,
      actual: scorecard.falseSuccessPct === null ? ((options.probes === false || options.maxProbes === 0) ? "not measured: probes disabled" : "not measured: no safe controls attempted") : `${scorecard.falseSuccessPct}%`,
      passed: scorecard.falseSuccessPct !== null && scorecard.falseSuccessPct <= options.maxFalseSuccess,
    });
  }
  if (options.maxChurnPct !== undefined) {
    gates.push({
      name: "max-churn",
      threshold: `≤ ${options.maxChurnPct}%`,
      actual: churn ? `${churn.unstableSamplePct}%` : "not measured",
      passed: churn ? churn.unstableSamplePct <= options.maxChurnPct : false,
    });
  }
  if (options.maxNoisePct !== undefined) {
    gates.push({
      name: "max-noise",
      threshold: `≤ ${options.maxNoisePct}%`,
      actual: `${scorecard.noisePct}%`,
      passed: scorecard.noisePct <= options.maxNoisePct,
    });
  }
  return gates;
}

export async function profileUrl(options: ProfileOptions): Promise<ProfileOutcome> {
  const log = options.log ?? (() => undefined);
  const tokenizer = options.tokenizer ?? "o200k_base";
  const session = await openSession({
    headless: options.headless,
    executablePath: options.executablePath,
    viewport: options.viewport,
    storageState: options.storageState,
    timeoutMs: options.timeoutMs,
  });
  const { page, monitor } = session;

  try {
    let navigationStatus: number | null = null;
    if (options.collectLinks !== undefined) page.on('response', response => { if (response.request().isNavigationRequest() && response.frame() === page.mainFrame() && ![204, 205].includes(response.status()) && !(response.status() >= 300 && response.status() < 400)) navigationStatus = response.status(); });
    const response = await page.goto(options.url, { waitUntil: options.waitUntil ?? "load", timeout: options.timeoutMs ?? 30_000 });
    let httpStatus = response?.status() ?? null;
    await settle(page);
    if (options.collectLinks !== undefined) httpStatus = navigationStatus ?? httpStatus;
    const finalUrl = page.url();
    const title = await page.title();
    const links = options.collectLinks ? await page.locator("a[href]").evaluateAll(nodes => nodes.slice(0, 2001).map(node => { try { return new URL(node.getAttribute("href") ?? "", node.baseURI).href; } catch { return ""; } })) : undefined;
    log(`settled on ${finalUrl}`);

    const extracted = (await page.evaluate(extractPageElements, {
      maxElements: options.maxElements ?? 400,
      markRefs: true,
    })) as ExtractResult;
    const compactText = formatCompactInteractive(extracted.elements);
    log(`${extracted.totalInteractive} interactive elements (${extracted.elements.length} analyzed)`);

    const shot = options.fullPageScreenshot === false ? null : await captureScreenshots(page);
    const bill = await measureBill(page, { tokenizer, elements: extracted.elements, compactText, fullPageScreenshot: shot });
    log(`observation bill measured over ${bill.modes.length} modes`);

    const frames = await countFrameInteractivity(page);
    const noise = analyzeNoise({
      elements: extracted.elements,
      totalInteractive: extracted.totalInteractive,
      truncated: extracted.truncated,
      shadowRoots: extracted.shadowRoots,
      frameCount: frames.count,
      frameInteractive: frames.interactive,
    });

    const churn = await measureChurn(page, {
      durationMs: options.churnMs ?? 1_500,
      intervalMs: options.churnIntervalMs ?? 250,
      freezeAnimations: options.freezeAnimations ?? true,
      tokenizer,
      maxLines: 600,
    });
    if (churn) log(`idle churn: ${churn.avgChangedPct}% (${churn.refInvalidationPct}% refs invalidated)`);

    let actionTruth: ActionTruthReport | null = null;
    let delta: DeltaReport | null = null;
    const probeCount = options.probes === false ? 0 : (options.maxProbes ?? 5);
    if (probeCount > 0) {
      const probeResult = await measureActionTruth(page, monitor, {
        maxProbes: probeCount,
        settleMs: 450,
        volatileLines: churn?.volatileLines ?? [],
        volatileZones: churn?.volatileZones ?? [],
        maxElements: options.maxElements ?? 400,
      });
      actionTruth = probeResult.report;
      delta = computeDelta(probeResult.snapshots, tokenizer);
      log(`action truth: ${actionTruth.effective}/${actionTruth.attempted} effective, ${actionTruth.noEffect} no-effect`);
    }

    const tokensPerStep = bill.modes.find((mode) => mode.mode === "interactive-refs")?.tokens ?? countTokens(compactText, tokenizer);
    const scorecard: Scorecard = {
      tokensPerStep,
      noisePct: round(noise.noisePct, 1),
      churnPct: churn ? churn.unstableSamplePct : 0,
      churnMagnitudePct: churn ? churn.avgChangedPct : 0,
      deltaSavingsPct: delta ? delta.avgSavingsPct : 0,
      falseSuccessPct: actionTruth ? actionTruth.falseSuccessPct : null,
      occluded: noise.occluded.count,
      duplicateClusters: noise.duplicates.count,
      unnamed: noise.unnamed.count,
    };

    const findings = buildFindings({ bill: bill.modes, noise, churn, delta, actionTruth, tokensPerStep });
    const gates = buildGates(options, scorecard, churn);
    const failedGates = gates.filter((gate) => !gate.passed);
    const highCount = findings.filter((finding) => finding.severity === "high").length;
    const verdictStatus: "pass" | "warn" | "fail" = failedGates.length > 0 ? "fail" : findings.some((finding) => finding.severity !== "low") ? "warn" : "pass";
    const summary =
      failedGates.length > 0
        ? `gate failed: ${failedGates.map((gate) => `${gate.name} (${gate.actual} vs ${gate.threshold})`).join(", ")}`
        : findings.length === 0
          ? "no findings; the page is agent-readable as measured"
          : `${findings.length} finding(s), ${highCount} high — ${Math.round(tokensPerStep).toLocaleString("en-US")} tokens/step, ${scorecard.noisePct}% noise`;

    const report: ProfileReport = {
      schemaVersion: 2,
      tool: { name: TOOL_NAME, version: VERSION },
      generatedAt: new Date().toISOString(),
      target: {
        url: options.url,
        finalUrl,
        title,
        status: httpStatus,
        viewport: page.viewportSize() ?? options.viewport ?? { width: 1280, height: 900 },
        bytes: bill.modes.find((mode) => mode.mode === "raw-html")?.bytes ?? 0,
        ...(shot ? { screenshot: { path: "", width: shot.width, height: shot.height, pngBytes: shot.png.length, jpegBytes: shot.jpeg.length } } : {}),
      },
      tokenizer: { name: tokenizer, label: TOKENIZER_LABELS[tokenizer], note: TOKENIZER_NOTE },
      bill: bill.modes,
      interactiveText: compactText,
      noise,
      churn,
      delta,
      actionTruth,
      scorecard,
      gates,
      verdict: { status: verdictStatus, exitCode: failedGates.length > 0 ? 1 : 0, summary, findings },
    };

    let paths: ReportPaths | null = null;
    if (options.outDir) {
      mkdirSync(options.outDir, { recursive: true });
      let screenshotPath: string | undefined;
      if (shot) {
        screenshotPath = join(options.outDir, "screenshot.png");
        writeFileSync(screenshotPath, shot.png);
        if (report.target.screenshot) report.target.screenshot.path = screenshotPath;
      }
      paths = writeProfileReports(report, options.outDir, options.formats ?? ["json", "md"], screenshotPath);
    }

    return { report, paths, ...(links ? { links } : {}) };
  } finally {
    await session.close();
  }
}
