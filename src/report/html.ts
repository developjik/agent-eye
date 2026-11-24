import { actionMeasurementReason } from "../format.js";
import { readFileSync } from "node:fs";
import { formatBytes, formatTokens } from "../tokens.js";
import { pct } from "../format.js";
import type { ProfileReport } from "../types.js";
import type { RunReport } from "../run/types.js";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STYLE = `
:root { color-scheme: light dark; --bg:#fff; --fg:#101418; --muted:#5a6570; --line:#e3e7ec; --accent:#0b62d6; --bad:#c02626; --warn:#a15c00; --good:#177245; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --fg:#e8ecf1; --muted:#98a2ae; --line:#242b33; --accent:#6ea8ff; --bad:#ff7b72; --warn:#e3a008; --good:#4ac486; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--fg); font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", "Helvetica Neue", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
main { max-width: 960px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 16px; margin: 32px 0 10px; }
p.sub { color: var(--muted); margin: 0 0 24px; font-size: 13px; word-break: break-all; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.verdict { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.verdict.pass { background: color-mix(in srgb, var(--good) 16%, transparent); color: var(--good); }
.verdict.warn { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
.verdict.fail { background: color-mix(in srgb, var(--bad) 16%, transparent); color: var(--bad); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 18px 0 8px; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.card b { display: block; font-size: 21px; font-variant-numeric: tabular-nums; }
.card span { color: var(--muted); font-size: 12px; }
.finding { border-left: 3px solid var(--line); padding: 4px 0 4px 14px; margin: 14px 0; }
.finding.high { border-color: var(--bad); }
.finding.medium { border-color: var(--warn); }
.finding.low { border-color: var(--accent); }
.finding strong { display: block; margin-bottom: 2px; }
.finding p { margin: 4px 0 0; font-size: 13.5px; color: var(--muted); }
.finding code { font-size: 12.5px; }
.tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.gate { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.gate.fail { color: var(--bad); }
.gate.pass { color: var(--good); }
img.shot { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; }
footer { margin-top: 40px; color: var(--muted); font-size: 12px; }
`;

export function renderHtmlProfile(report: ProfileReport, screenshotPath?: string): string {
  const cheapest = Math.min(...report.bill.filter((mode) => !mode.mode.startsWith("screenshot")).map((mode) => mode.tokens).filter((value) => value > 0));
  const billRows = report.bill
    .map((mode) => {
      const ratio = cheapest > 0 ? `×${(mode.tokens / cheapest).toFixed(1)}` : "—";
      return `<tr><td>${esc(mode.label)}${mode.estimated ? ' <span class="tag">est.</span>' : ""}<br><span class="tag">${esc(mode.note ?? "")}</span></td><td class="num">${formatBytes(mode.bytes)}</td><td class="num">${formatTokens(mode.tokens)}</td><td class="num">${ratio}</td></tr>`;
    })
    .join("\n");

  const controls = report.actionTruth
    ? `<h2>Probed controls</h2><table><thead><tr><th>control</th><th>verdict</th><th class="num">lines changed</th><th class="num">requests</th></tr></thead><tbody>${report.actionTruth.controls
        .map(
          (control) =>
            `<tr><td>${esc(`${control.role} "${control.name}"`)}</td><td>${control.verdict}${control.error ? `<br><span class="tag">${esc(control.error)}</span>` : ""}</td><td class="num">${control.linesChanged}</td><td class="num">${control.networkRequests}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "";

  const findings = report.verdict.findings
    .map(
      (finding) =>
        `<div class="finding ${finding.severity}"><strong>[${finding.severity}] ${esc(finding.title)}</strong><p>${esc(finding.evidence)}</p><p><b>Fix:</b> ${esc(finding.fix)}</p></div>`,
    )
    .join("\n");

  let screenshotTag = "";
  if (screenshotPath) {
    try {
      const bytes = readFileSync(screenshotPath);
      if (bytes.length <= 900_000) {
        screenshotTag = `<img class="shot" alt="full page screenshot" src="data:image/png;base64,${bytes.toString("base64")}">`;
      }
    } catch {
      /* screenshot is optional */
    }
  }

  const gates = report.gates
    .map((gate) => `<div class="gate ${gate.passed ? "pass" : "fail"}">${gate.passed ? "PASS" : "FAIL"} ${esc(gate.name)} ${esc(gate.threshold)} (actual ${esc(gate.actual)})</div>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-eye report — ${esc(report.target.title || report.target.finalUrl)}</title><style>${STYLE}</style></head>
<body><main>
<h1>${esc(report.target.title || report.target.finalUrl)}</h1>
<p class="sub">${esc(report.target.finalUrl)} · ${esc(report.generatedAt)} · tokenizer ${esc(report.tokenizer.name)} (approximate) · viewport ${report.target.viewport.width}x${report.target.viewport.height}</p>
<p><span class="verdict ${report.verdict.status}">${report.verdict.status}</span> ${esc(report.verdict.summary)}</p>
<div class="cards">
  <div class="card"><b>${formatTokens(report.scorecard.tokensPerStep)}</b><span>tokens / step (compact refs)</span></div>
  <div class="card"><b>${pct(report.scorecard.noisePct)}</b><span>noise of ${report.noise.analyzed} elements</span></div>
  <div class="card"><b>${pct(report.scorecard.churnPct, 1)}</b><span>idle samples changed (${pct(report.scorecard.churnMagnitudePct, 1)} of lines)</span></div>
  <div class="card"><b>${pct(report.scorecard.deltaSavingsPct, 1)}</b><span>delta headroom</span></div>
  <div class="card"><b>${report.scorecard.falseSuccessPct === null ? `not measured: ${actionMeasurementReason(report)}` : pct(report.scorecard.falseSuccessPct, 1)}</b><span>false success</span></div>
</div>
<h2>Observation bill</h2>
<table><thead><tr><th>mode</th><th class="num">bytes</th><th class="num">tokens</th><th class="num">vs cheapest text</th></tr></thead><tbody>${billRows}</tbody></table>
<h2>Noise &amp; ambiguity</h2>
<table><tbody>
<tr><td>unnamed controls</td><td class="num">${report.noise.unnamed.count}</td></tr>
<tr><td>duplicate (role, name) clusters</td><td class="num">${report.noise.duplicates.count} (${report.noise.duplicates.elements} elements)</td></tr>
<tr><td>hidden / clipped (focusable)</td><td class="num">${report.noise.hidden.count} / ${report.noise.hidden.clipped} (${report.noise.hidden.focusable})</td></tr>
<tr><td>off-screen</td><td class="num">${report.noise.offscreen.count}</td></tr>
<tr><td>occluded at click point</td><td class="num">${report.noise.occluded.count} of ${report.noise.occluded.inViewport} in viewport</td></tr>
<tr><td>iframes / interactive inside</td><td class="num">${report.noise.frames.count} / ${report.noise.frames.interactive}</td></tr>
</tbody></table>
${controls}
<h2>Findings</h2>
${findings || "<p>No findings.</p>"}
${gates ? `<h2>Gates</h2>${gates}` : ""}
${screenshotTag}
<footer>agent-eye ${esc(report.tool.version)} · local, deterministic, no LLM calls · token counts are estimates for comparison</footer>
</main></body></html>`;
}

export function renderHtmlRun(report: RunReport): string {
  const rows = report.steps
    .map(
      (step) => `<tr><td class="num">${step.index + 1}</td><td>${esc(step.name)}<br><span class="tag">${esc(step.action)}${step.target ? ` → ${esc(step.target)}` : ""}</span></td><td>${step.status}${step.falseSuccess ? ' <span class="tag">false success</span>' : ""}${step.ambiguous > 1 ? ` <span class="tag">ambiguous ×${step.ambiguous}</span>` : ""}</td><td class="num">${step.tokens}</td><td class="num">${step.changedLines}</td></tr>`,
    )
    .join("");
  const detail = report.steps
    .filter((step) => step.status === "failed" || step.expectations.some((expectation) => !expectation.passed))
    .map(
      (step) =>
        `<div class="finding high"><strong>Step ${step.index + 1}: ${esc(step.name)}</strong>${step.error ? `<p>${esc(step.error)}</p>` : ""}${step.expectations
          .filter((expectation) => !expectation.passed)
          .map((expectation) => `<p>expected ${esc(expectation.expected)} — got ${esc(expectation.actual)}</p>`)
          .join("")}${step.candidates && step.candidates.length ? `<p>closest: ${esc(step.candidates.join(" · "))}</p>` : ""}</div>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-eye run — ${esc(report.spec.name)}</title><style>${STYLE}</style></head>
<body><main>
<h1>${esc(report.spec.name)}</h1>
<p class="sub">${esc(report.generatedAt)} · ${report.totals.steps} steps · ${formatTokens(report.totals.tokens)} tokens (${formatTokens(report.totals.avgTokensPerStep)} / step)</p>
<p><span class="verdict ${report.verdict.status}">${report.verdict.status}</span> ${esc(report.verdict.summary)}</p>
<table><thead><tr><th class="num">#</th><th>step</th><th>status</th><th class="num">tokens</th><th class="num">lines changed</th></tr></thead><tbody>${rows}</tbody></table>
${detail ? `<h2>Failures</h2>${detail}` : ""}
${report.gates.length ? `<h2>Gates</h2>${report.gates.map((gate) => `<div class="gate ${gate.passed ? "pass" : "fail"}">${gate.passed ? "PASS" : "FAIL"} ${esc(gate.name)} ${esc(gate.threshold)} (actual ${esc(gate.actual)})</div>`).join("")}` : ""}
<footer>agent-eye ${esc(report.tool.version)} · deterministic acceptance run, no LLM calls</footer>
</main></body></html>`;
}
