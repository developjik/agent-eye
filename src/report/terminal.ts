import { formatBytes, formatTokens } from "../tokens.js";
import { pct, renderTable, truncate, type TableRow } from "../format.js";
import type { ProfileReport } from "../types.js";
import type { RunReport } from "../run/types.js";

const RULE = "─".repeat(74);

function billRows(report: ProfileReport): TableRow[] {
  const cheapest = Math.min(...report.bill.filter((mode) => !mode.mode.startsWith("screenshot")).map((mode) => mode.tokens).filter((value) => value > 0));
  return report.bill.map((mode) => {
    const ratio = cheapest > 0 ? `×${(mode.tokens / cheapest).toFixed(1)}` : "—";
    return {
      cells: [mode.label, formatBytes(mode.bytes), `${formatTokens(mode.tokens)} tok`, ratio],
    };
  });
}

export function renderTerminalProfile(report: ProfileReport): string {
  const lines: string[] = [];
  const target = report.target;
  lines.push(`agent-eye ${report.tool.version} · ${target.finalUrl}`);
  lines.push(`${target.title || "(no title)"} · HTTP ${target.status ?? "—"} · viewport ${target.viewport.width}x${target.viewport.height}`);
  lines.push(`${report.noise.interactive} interactive elements · tokenizer ${report.tokenizer.name} (approximate)`);
  lines.push("");
  lines.push("Observation bill (one step)");
  lines.push(renderTable(["mode", "bytes", "tokens", "vs cheapest"], billRows(report), ["left", "right", "right", "right"]));
  lines.push("");
  lines.push("Scorecard");
  const scorecard = report.scorecard;
  const scoreRows: TableRow[] = [
    { cells: ["tokens / step (compact refs)", `${formatTokens(scorecard.tokensPerStep)} tok`] },
    { cells: ["noise", `${pct(scorecard.noisePct)} of ${report.noise.analyzed} analyzed`] },
    { cells: ["  unnamed controls", String(scorecard.unnamed)] },
    {
      cells: [
        "  duplicate labels",
        `${report.noise.duplicates.elements} elements in ${scorecard.duplicateClusters} cluster(s)` +
          (report.noise.duplicates.clusters[0] ? ` — e.g. ${report.noise.duplicates.clusters[0].role} "${truncate(report.noise.duplicates.clusters[0].name, 28)}" ×${report.noise.duplicates.clusters[0].count}` : ""),
      ],
    },
    { cells: ["  hidden / clipped", `${report.noise.hidden.count} (${report.noise.hidden.focusable} still focusable, ${report.noise.hidden.clipped} under 2px)`] },
    { cells: ["  off-screen", String(report.noise.offscreen.count)] },
    { cells: ["occluded controls", `${scorecard.occluded} covered at their click point`] },
    {
      cells: [
        "idle churn",
        report.churn
          ? `${report.churn.avgChangedPct === 0 ? "0" : String(Math.round((report.churn.unstableSamplePct / 100) * report.churn.samples.length))}/${report.churn.samples.length} samples changed · ${pct(report.churn.avgChangedPct, 1)} of lines · ${pct(report.churn.refInvalidationPct, 1)} refs invalidated · ${formatTokens(report.churn.tokensChurned)} tok rescanned in ${(report.churn.durationMs / 1000).toFixed(1)}s`
          : "not measured",
      ],
    },
    { cells: ["delta headroom", report.delta ? `${pct(report.delta.avgSavingsPct, 1)} saved if only changed lines were sent` : "not measured"] },
    {
      cells: [
        "action truth",
        report.actionTruth
          ? `${report.actionTruth.effective}/${report.actionTruth.attempted} effective · ${report.actionTruth.noEffect} no-effect (${pct(report.actionTruth.falseSuccessPct, 1)} false success) · ${report.actionTruth.blocked} blocked · ${report.actionTruth.skipped} skipped`
          : "not measured",
      ],
    },
  ];
  lines.push(renderTable(["metric", "value"], scoreRows, ["left", "left"]));
  lines.push("");

  if (report.actionTruth && report.actionTruth.controls.length > 0) {
    lines.push("Probed controls (non-destructive allowlist)");
    for (const control of report.actionTruth.controls) {
      const mark = control.verdict === "effective" ? "✓" : control.verdict === "no-effect" ? "✗" : "!";
      const why =
        control.verdict === "no-effect"
          ? "clicked, nothing changed"
          : control.verdict === "blocked"
            ? `blocked: ${truncate(control.error ?? "", 48)}`
            : control.verdict === "error"
              ? `error: ${truncate(control.error ?? "", 48)}`
              : `${control.linesChanged} lines changed${control.urlChanged ? ", url changed" : ""}`;
      lines.push(`  ${mark} ${truncate(`${control.role} "${control.name}"`, 42).padEnd(44)} ${why}`);
    }
    lines.push("");
  }

  if (report.verdict.findings.length > 0) {
    lines.push("Findings");
    for (const finding of report.verdict.findings) {
      lines.push(`  [${finding.severity}] ${finding.title}`);
      lines.push(`      evidence: ${finding.evidence}`);
      lines.push(`      fix: ${finding.fix}`);
    }
    lines.push("");
  }

  if (report.gates.length > 0) {
    lines.push("Gates");
    for (const gate of report.gates) {
      lines.push(`  ${gate.passed ? "PASS" : "FAIL"}  ${gate.name} ${gate.threshold} (actual ${gate.actual})`);
    }
    lines.push("");
  }

  lines.push(RULE);
  lines.push(`Result: ${report.verdict.status.toUpperCase()} — ${report.verdict.summary}`);
  return lines.join("\n");
}

export function renderComparison(before: ProfileReport, after: ProfileReport): string {
  const rows: TableRow[] = [];
  const metric = (label: string, pick: (report: ProfileReport) => number, unit: string): void => {
    const a = pick(before);
    const b = pick(after);
    const delta = a > 0 ? ((b - a) / a) * 100 : 0;
    rows.push({
      cells: [label, `${formatTokens(a)}${unit}`, `${formatTokens(b)}${unit}`, `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`],
    });
  };
  metric("tokens / step (compact refs)", (report) => report.scorecard.tokensPerStep, " tok");
  metric("noise", (report) => report.scorecard.noisePct, "%");
  metric("idle churn", (report) => report.scorecard.churnPct, "%");
  metric("false success", (report) => report.scorecard.falseSuccessPct, "%");
  metric("occluded controls", (report) => report.scorecard.occluded, "");
  return renderTable(["metric", "before", "after", "change"], rows, ["left", "right", "right", "right"]);
}

export function renderTerminalRun(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`agent-eye run ${report.tool.version} · ${report.spec.name}`);
  lines.push(`${report.totals.steps} steps · ${report.totals.passed} passed · ${report.totals.failed} failed · ${formatTokens(report.totals.tokens)} tok total`);
  lines.push("");
  for (const step of report.steps) {
    const mark = step.status === "passed" ? "✓" : step.status === "failed" ? "✗" : "·";
    const flags: string[] = [];
    if (step.ambiguous > 1) flags.push(`ambiguous ×${step.ambiguous}`);
    if (step.falseSuccess) flags.push("false success");
    if (step.changedLines > 0) flags.push(`${step.changedLines} line${step.changedLines === 1 ? "" : "s"} changed`);
    lines.push(
      `  ${String(step.index + 1).padStart(2)} ${mark} ${truncate(step.name, 34).padEnd(36)} ${String(step.tokens).padStart(6)} tok  ${flags.join(", ")}`,
    );
    if (step.status === "failed") {
      if (step.error) lines.push(`       error: ${truncate(step.error, 100)}`);
      for (const expectation of step.expectations.filter((item) => !item.passed)) {
        lines.push(`       expected ${expectation.expected} — got ${truncate(expectation.actual, 80)}`);
      }
      if (step.candidates && step.candidates.length > 0) lines.push(`       closest candidates: ${step.candidates.join(" · ")}`);
    }
  }
  lines.push("");
  if (report.churn) {
    lines.push(`idle churn: ${pct(report.churn.avgChangedPct, 1)} of ${report.churn.lines} lines changed in ${(report.churn.durationMs / 1000).toFixed(1)}s`);
  }
  if (report.gates.length > 0) {
    lines.push("");
    lines.push("Gates");
    for (const gate of report.gates) lines.push(`  ${gate.passed ? "PASS" : "FAIL"}  ${gate.name} ${gate.threshold} (actual ${gate.actual})`);
  }
  lines.push(RULE);
  lines.push(`Result: ${report.verdict.status.toUpperCase()} — ${report.verdict.summary}`);
  return lines.join("\n");
}
