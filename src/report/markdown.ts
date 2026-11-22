import { formatBytes, formatTokens } from "../tokens.js";
import { pct } from "../format.js";
import type { ProfileReport } from "../types.js";
import type { RunReport } from "../run/types.js";

function mdEscape(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function renderMarkdownProfile(report: ProfileReport): string {
  const out: string[] = [];
  out.push(`# agent-eye report — ${report.target.title || report.target.finalUrl}`);
  out.push("");
  out.push(`- Target: ${report.target.finalUrl}`);
  out.push(`- Generated: ${report.generatedAt}`);
  out.push(`- Viewport: ${report.target.viewport.width}x${report.target.viewport.height}`);
  out.push(`- Tokenizer: ${report.tokenizer.label} (approximate)`);
  out.push("");
  out.push("## Observation bill (one step)");
  out.push("");
  out.push("| mode | bytes | tokens | note |");
  out.push("| --- | ---: | ---: | --- |");
  for (const mode of report.bill) {
    out.push(`| ${mdEscape(mode.label)} | ${formatBytes(mode.bytes)} | ${formatTokens(mode.tokens)}${mode.estimated ? " (est.)" : ""} | ${mdEscape(mode.note ?? "")} |`);
  }
  out.push("");
  out.push("## Scorecard");
  out.push("");
  out.push("| metric | value |");
  out.push("| --- | --- |");
  out.push(`| tokens / step (compact refs) | ${formatTokens(report.scorecard.tokensPerStep)} |`);
  out.push(`| noise | ${pct(report.scorecard.noisePct)} of ${report.noise.analyzed} interactive elements |`);
  out.push(`| unnamed controls | ${report.scorecard.unnamed} |`);
  out.push(`| duplicate-label clusters | ${report.scorecard.duplicateClusters} (${report.noise.duplicates.elements} elements) |`);
  out.push(`| hidden / clipped / off-screen | ${report.noise.hidden.count} / ${report.noise.hidden.clipped} / ${report.noise.offscreen.count} |`);
  out.push(`| occluded controls | ${report.scorecard.occluded} |`);
  out.push(
    `| idle churn | ${pct(report.scorecard.churnPct, 1)} of samples (${report.churn?.samples.filter((sample) => sample.changedVsPrevious > 0).length ?? 0}/${report.churn?.samples.length ?? 0}), ${pct(report.scorecard.churnMagnitudePct, 1)} of lines, ${formatTokens(report.churn?.tokensChurned ?? 0)} tokens rescanned, ${pct(report.churn?.refInvalidationPct ?? 0, 1)} refs invalidated |`,
  );
  out.push(`| delta headroom | ${pct(report.scorecard.deltaSavingsPct, 1)} |`);
  out.push(`| false success | ${pct(report.scorecard.falseSuccessPct, 1)} |`);
  out.push("");

  if (report.actionTruth) {
    out.push("## Probed controls");
    out.push("");
    out.push("| control | verdict | lines changed | requests | note |");
    out.push("| --- | --- | ---: | ---: | --- |");
    for (const control of report.actionTruth.controls) {
      out.push(`| ${mdEscape(`${control.role} "${control.name}"`)} | ${control.verdict} | ${control.linesChanged} | ${control.networkRequests} | ${mdEscape(control.error ?? "")} |`);
    }
    out.push("");
  }

  if (report.noise.duplicates.clusters.length > 0) {
    out.push("## Ambiguous labels");
    out.push("");
    for (const cluster of report.noise.duplicates.clusters) {
      out.push(`- ${cluster.role} "${mdEscape(cluster.name)}" appears ${cluster.count}x (${cluster.refs.join(", ")})`);
    }
    out.push("");
  }

  if (report.verdict.findings.length > 0) {
    out.push("## Findings");
    out.push("");
    for (const finding of report.verdict.findings) {
      out.push(`### [${finding.severity}] ${finding.title}`);
      out.push("");
      out.push(`**Evidence:** ${finding.evidence}`);
      out.push("");
      out.push(`**Fix:** ${finding.fix}`);
      out.push("");
    }
  }

  if (report.gates.length > 0) {
    out.push("## Gates");
    out.push("");
    for (const gate of report.gates) {
      out.push(`- ${gate.passed ? "PASS" : "FAIL"} — ${gate.name} ${gate.threshold} (actual ${gate.actual})`);
    }
    out.push("");
  }

  out.push("---");
  out.push("");
  out.push(`**Result: ${report.verdict.status.toUpperCase()}** — ${report.verdict.summary}`);
  out.push("");
  return out.join("\n");
}

export function renderMarkdownRun(report: RunReport): string {
  const out: string[] = [];
  out.push(`# agent-eye run — ${report.spec.name}`);
  out.push("");
  out.push(`- Generated: ${report.generatedAt}`);
  out.push(`- Steps: ${report.totals.steps} (${report.totals.passed} passed, ${report.totals.failed} failed)`);
  out.push(`- Tokens: ${formatTokens(report.totals.tokens)} total, ${formatTokens(report.totals.avgTokensPerStep)} average per step`);
  out.push("");
  out.push("| # | step | status | tokens | observations |");
  out.push("| ---: | --- | --- | ---: | --- |");
  for (const step of report.steps) {
    const notes: string[] = [];
    if (step.ambiguous > 1) notes.push(`ambiguous ×${step.ambiguous}`);
    if (step.falseSuccess) notes.push("false success");
    if (step.changedLines > 0) notes.push(`${step.changedLines} lines changed`);
    if (step.error) notes.push(mdEscape(step.error));
    out.push(`| ${step.index + 1} | ${mdEscape(step.name)} | ${step.status} | ${step.tokens} | ${notes.join("; ")} |`);
  }
  out.push("");
  for (const step of report.steps) {
    const failed = step.expectations.filter((expectation) => !expectation.passed);
    if (failed.length === 0 && step.status !== "failed") continue;
    out.push(`### Step ${step.index + 1}: ${step.name}`);
    out.push("");
    for (const expectation of step.expectations) {
      out.push(`- ${expectation.passed ? "PASS" : "FAIL"} — expected ${expectation.expected}; got ${expectation.actual}`);
    }
    if (step.candidates && step.candidates.length > 0) out.push(`- closest candidates: ${step.candidates.join(" · ")}`);
    out.push("");
  }
  if (report.gates.length > 0) {
    out.push("## Gates");
    out.push("");
    for (const gate of report.gates) out.push(`- ${gate.passed ? "PASS" : "FAIL"} — ${gate.name} ${gate.threshold} (actual ${gate.actual})`);
    out.push("");
  }
  out.push("---");
  out.push("");
  out.push(`**Result: ${report.verdict.status.toUpperCase()}** — ${report.verdict.summary}`);
  out.push("");
  return out.join("\n");
}
