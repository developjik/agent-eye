import { countTokens, type TokenizerName } from "../tokens.js";
import type { DeltaReport, DeltaStep } from "../types.js";

export interface LineDiff {
  added: number;
  removed: number;
  unchanged: number;
  totalBefore: number;
  totalAfter: number;
  changed: number;
  unchangedPct: number;
}

/**
 * Line shape with numbers masked. Used to recognise a volatile region (a clock,
 * a counter, a price ticker) even though its value is different every time.
 */
export function maskLine(line: string): string {
  return line.replace(/\d+/g, "#");
}

export interface VolatileFilter {
  lines: Set<string>;
  zones: Set<string>;
}

export function toVolatileFilter(source: { volatileLines?: string[]; volatileZones?: string[] } | null | undefined): VolatileFilter {
  return {
    lines: new Set(source?.volatileLines ?? []),
    zones: new Set(source?.volatileZones ?? []),
  };
}

/** True when the line belongs to a region observed changing while idle. */
export function isVolatileLine(line: string, volatile: Set<string>): boolean {
  return volatile.has(line) || volatile.has(maskLine(line));
}

/** Drop lines that moved on their own, so a click effect is judged on the stable part. */
export function filterStable(lines: string[], zones: string[], volatile: VolatileFilter): string[] {
  if (volatile.lines.size === 0 && volatile.zones.size === 0) return lines;
  return lines.filter((line, index) => {
    const zone = zones[index] ?? "body";
    if (volatile.zones.has(zone)) return false;
    return !isVolatileLine(line, volatile.lines);
  });
}

/** Multiset diff over lines: how many lines survived, appeared, or disappeared. */
export function diffLines(before: string[], after: string[]): LineDiff {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  let unchanged = 0;
  let added = 0;
  for (const line of after) {
    const available = counts.get(line) ?? 0;
    if (available > 0) {
      unchanged += 1;
      counts.set(line, available - 1);
    } else {
      added += 1;
    }
  }
  let removed = 0;
  for (const remaining of counts.values()) removed += remaining;
  const totalAfter = after.length;
  const totalBefore = before.length;
  return {
    added,
    removed,
    unchanged,
    totalBefore,
    totalAfter,
    changed: added + removed,
    unchangedPct: totalAfter > 0 ? (unchanged / totalAfter) * 100 : 0,
  };
}

export interface SnapshotStep {
  label: string;
  lines: string[];
}

/**
 * Delta potential: if the harness sent only the changed lines between two
 * consecutive steps instead of the whole snapshot, how much would it save?
 */
export function computeDelta(steps: SnapshotStep[], tokenizer: TokenizerName = "o200k_base"): DeltaReport | null {
  if (steps.length < 2) return null;
  const out: DeltaStep[] = [];
  for (let i = 1; i < steps.length; i += 1) {
    const before = steps[i - 1] as SnapshotStep;
    const after = steps[i] as SnapshotStep;
    const diff = diffLines(before.lines, after.lines);
    const fullTokens = countTokens(after.lines.join("\n"), tokenizer);
    const addedLines = new Set(after.lines);
    for (const line of before.lines) addedLines.delete(line);
    const deltaTokens = Math.min(fullTokens, countTokens(Array.from(addedLines).join("\n"), tokenizer) + 6);
    out.push({
      from: before.label,
      to: after.label,
      linesBefore: diff.totalBefore,
      linesAfter: diff.totalAfter,
      added: diff.added,
      removed: diff.removed,
      unchangedPct: round(diff.unchangedPct, 1),
      fullTokens,
      deltaTokens,
      savingsPct: round(fullTokens > 0 ? (1 - deltaTokens / fullTokens) * 100 : 0, 1),
    });
  }
  const avg = (pick: (step: DeltaStep) => number): number =>
    round(out.reduce((sum, step) => sum + pick(step), 0) / Math.max(1, out.length), 1);
  return {
    steps: out,
    avgUnchangedPct: avg((step) => step.unchangedPct),
    avgSavingsPct: avg((step) => step.savingsPct),
    note:
      "line-set diff between consecutive snapshots; refs are renumbered each step, so this is an upper bound on what a delta protocol would save",
  };
}

export function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
