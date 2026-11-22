import type { Page } from "playwright";
import { pageSignature } from "../extract.js";
import { countTokens, type TokenizerName } from "../tokens.js";
import type { ChurnReport, ChurnSample, PageSignature } from "../types.js";
import { diffLines, maskLine, round } from "./delta.js";

export interface ChurnOptions {
  durationMs: number;
  intervalMs: number;
  freezeAnimations: boolean;
  tokenizer: TokenizerName;
  maxLines?: number;
}

const FREEZE_CSS = `*, *::before, *::after { animation-play-state: paused !important; animation-duration: 0s !important; transition: none !important; caret-color: transparent !important; }`;

async function signature(page: Page, maxLines: number): Promise<PageSignature> {
  return (await page.evaluate(pageSignature, { maxLines })) as PageSignature;
}

/** Map each text line to the region ids it appears in (a line can repeat). */
function zonesByLine(sig: PageSignature): Map<string, string[]> {
  const map = new Map<string, string[]>();
  sig.lines.forEach((line, index) => {
    const zone = sig.zones[index] ?? "body";
    const list = map.get(line) ?? [];
    list.push(zone);
    map.set(line, list);
  });
  return map;
}

function isSpecificZone(zone: string): boolean {
  return zone.startsWith("#") || zone.startsWith("aria-live=");
}

/**
 * Idle churn: sample the snapshot several times without touching the page and
 * see how much of it changes on its own (tickers, carousels, live clocks) and
 * how many refs stop being valid. The lines and regions that move are returned
 * so later action measurements can ignore them.
 */
export async function measureChurn(page: Page, options: ChurnOptions): Promise<ChurnReport | null> {
  if (options.durationMs <= 0) return null;
  const interval = Math.max(100, options.intervalMs);
  const maxLines = options.maxLines ?? 600;

  if (options.freezeAnimations) {
    await page.addStyleTag({ content: FREEZE_CSS }).catch(() => undefined);
  }

  const baseline = await signature(page, maxLines);
  const baselineRefs = new Map(baseline.interactive.map((entry) => [entry.ref, entry.desc]));
  const samples: ChurnSample[] = [];
  let previous = baseline;
  let tokensChurned = 0;
  let maxChangedPct = 0;
  let changedPctSum = 0;
  const volatileLines = new Set<string>();
  const volatileZones = new Set<string>();
  const startedAt = Date.now();

  const markVolatile = (line: string, zoneMap: Map<string, string[]>, side: PageSignature, index: number): void => {
    const zone = side.zones[index] ?? "body";
    if (isSpecificZone(zone)) {
      volatileZones.add(zone);
      return;
    }
    volatileLines.add(line);
    volatileLines.add(maskLine(line));
    for (const candidate of zoneMap.get(line) ?? []) {
      if (isSpecificZone(candidate)) volatileZones.add(candidate);
    }
  };

  while (Date.now() - startedAt < options.durationMs) {
    await page.waitForTimeout(interval);
    const current = await signature(page, maxLines);
    const vsPrevious = diffLines(previous.lines, current.lines);
    const vsBaseline = diffLines(baseline.lines, current.lines);

    if (vsPrevious.changed > 0) {
      const beforeZones = zonesByLine(previous);
      const afterZones = zonesByLine(current);
      const afterSet = new Set(current.lines);
      const beforeSet = new Set(previous.lines);
      previous.lines.forEach((line, index) => {
        if (!afterSet.has(line)) markVolatile(line, beforeZones, previous, index);
      });
      current.lines.forEach((line, index) => {
        if (!beforeSet.has(line)) markVolatile(line, afterZones, current, index);
      });
    }

    const refsNow = new Map(current.interactive.map((entry) => [entry.ref, entry.desc]));
    let invalidated = 0;
    for (const [ref, desc] of baselineRefs) {
      if (refsNow.get(ref) !== desc) invalidated += 1;
    }
    const changedPct = Math.min(100, vsPrevious.totalAfter > 0 ? (vsPrevious.changed / vsPrevious.totalAfter) * 100 : 0);
    changedPctSum += changedPct;
    maxChangedPct = Math.min(100, Math.max(maxChangedPct, (vsBaseline.changed / Math.max(1, vsBaseline.totalAfter)) * 100));
    const tokens = countTokens(current.lines.join("\n"), options.tokenizer);
    tokensChurned += tokens;
    samples.push({
      tMs: Date.now() - startedAt,
      lines: current.lines.length,
      changedVsPrevious: vsPrevious.changed,
      changedVsBaseline: vsBaseline.changed,
      changedPct: round(changedPct, 1),
      refsInvalidated: invalidated,
      tokens,
    });
    previous = current;
  }

  const avgChangedPct = samples.length > 0 ? changedPctSum / samples.length : 0;
  const unstableSamples = samples.filter((sample) => sample.changedVsPrevious > 0).length;
  const unstableSamplePct = samples.length > 0 ? (unstableSamples / samples.length) * 100 : 0;
  const refInvalidationPct =
    samples.length > 0 && baselineRefs.size > 0
      ? (samples.reduce((sum, sample) => sum + sample.refsInvalidated, 0) / samples.length / baselineRefs.size) * 100
      : 0;

  return {
    durationMs: options.durationMs,
    intervalMs: interval,
    samples,
    lines: baseline.lines.length,
    unstableSamplePct: round(unstableSamplePct, 1),
    avgChangedPct: round(avgChangedPct, 1),
    maxChangedPct: round(maxChangedPct, 1),
    refInvalidationPct: round(refInvalidationPct, 1),
    tokensChurned,
    volatileLines: Array.from(volatileLines).slice(0, 400),
    volatileZones: Array.from(volatileZones).slice(0, 40),
    stable: unstableSamplePct === 0 && refInvalidationPct < 5,
    frozenAnimations: options.freezeAnimations,
  };
}
