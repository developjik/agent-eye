import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderHtmlProfile, renderHtmlRun } from "./html.js";
import { renderMarkdownProfile, renderMarkdownRun } from "./markdown.js";
import type { ProfileReport } from "../types.js";
import type { RunReport } from "../run/types.js";

export type ReportFormat = "json" | "md" | "html";

export interface ReportPaths {
  json?: string;
  md?: string;
  html?: string;
  screenshot?: string;
}

export function writeProfileReports(
  report: ProfileReport,
  outDir: string,
  formats: ReportFormat[] = ["json", "md"],
  screenshotPath?: string,
): ReportPaths {
  mkdirSync(outDir, { recursive: true });
  const paths: ReportPaths = {};
  if (formats.includes("json")) {
    paths.json = join(outDir, "report.json");
    writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (formats.includes("md")) {
    paths.md = join(outDir, "report.md");
    writeFileSync(paths.md, renderMarkdownProfile(report), "utf8");
  }
  if (formats.includes("html")) {
    paths.html = join(outDir, "report.html");
    writeFileSync(paths.html, renderHtmlProfile(report, screenshotPath), "utf8");
  }
  if (screenshotPath) paths.screenshot = screenshotPath;
  return paths;
}

export function writeRunReports(report: RunReport, outDir: string, formats: ReportFormat[] = ["json", "md"]): ReportPaths {
  mkdirSync(outDir, { recursive: true });
  const paths: ReportPaths = {};
  if (formats.includes("json")) {
    paths.json = join(outDir, "report.json");
    writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (formats.includes("md")) {
    paths.md = join(outDir, "report.md");
    writeFileSync(paths.md, renderMarkdownRun(report), "utf8");
  }
  if (formats.includes("html")) {
    paths.html = join(outDir, "report.html");
    writeFileSync(paths.html, renderHtmlRun(report), "utf8");
  }
  return paths;
}
