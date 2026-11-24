import { crawlSite, renderCrawlTerminal } from "./crawl.js";
import { loadSpec } from "./run/spec.js";
import { runAcceptance } from "./run/runner.js";
import { profileUrl } from "./profile.js";
import { runDemo } from "./demo/demo.js";
import { renderTerminalProfile, renderTerminalRun } from "./report/terminal.js";
import type { ReportFormat } from "./report/write.js";
import type { TokenizerName } from "./types.js";
import { TOOL_NAME, VERSION } from "./version.js";

const VALUE_FLAGS = new Set([
  "sitemap", "max-pages", "concurrency",
  "out",
  "format",
  "churn-ms",
  "churn-interval",
  "probes",
  "max-elements",
  "viewport",
  "storage-state",
  "wait-until",
  "tokenizer",
  "budget-tokens",
  "max-false-success",
  "max-churn-pct",
  "max-noise-pct",
  "timeout",
  "chromium",
  "max-steps",
  "settle-ms",
]);

export class UsageError extends Error {}

interface Parsed {
  positional: string[];
  flags: Map<string, string | boolean>;
}

export function parseArgv(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "-h") {
      flags.set("help", true);
      continue;
    }
    if (arg === "-v") {
      flags.set("version", true);
      continue;
    }
    if (arg.startsWith("--no-")) {
      flags.set(arg.slice(5), false);
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 0) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
        continue;
      }
      const name = arg.slice(2);
      if (VALUE_FLAGS.has(name)) {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("-")) {
          flags.set(name, "");
        } else {
          flags.set(name, next);
          index += 1;
        }
      } else {
        flags.set(name, true);
      }
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags };
}

const HELP = `agent-eye ${VERSION} — what an AI agent actually sees on your page

Usage
  agent-eye <url>                 profile a page (same as \`agent-eye profile <url>\`)
  agent-eye crawl <url>           same-origin sitemap or BFS site profiles
  agent-eye profile <url>         observation bill, noise, churn, delta headroom, action truth
  agent-eye run <spec.yaml|json>  run a deterministic acceptance spec and gate the result
  agent-eye demo                  profile and test the built-in demo storefront
  agent-eye --help | --version

Profile options
  --out <dir>                 write reports (default: no files, terminal only)
  --format <json,md,html>     report formats for --out (default: json,md)
  --budget-tokens <n>         fail (exit 1) when compact tokens per step exceed n
  --max-false-success <pct>   fail when probed clicks that changed nothing exceed pct
  --max-churn-pct <pct>       fail when idle churn exceeds pct
  --max-noise-pct <pct>       fail when the noisy share of controls exceeds pct
  --churn-ms <n>              idle sampling window in ms (default 1500, 0 disables)
  --churn-interval <n>        ms between idle samples (default 250)
  --probes <n>                non-destructive controls to click (default 5, 0 disables)
  --max-elements <n>          interactive elements analyzed in detail (default 400)
  --tokenizer <name>          o200k_base (default) or cl100k_base
  --viewport <wxh>            viewport, e.g. 1280x900
  --storage-state <file>      Playwright storage state for logged-in pages
  --wait-until <state>        load (default) | domcontentloaded | networkidle
  --no-freeze                 do not pause CSS animations during the churn sample
  --no-screenshot             skip the full-page screenshot mode
  --headed                    show the browser window
  --chromium <path>           use a specific Chromium binary (or AGENT_EYE_CHROMIUM)
  --timeout <ms>              navigation timeout
  --quiet                     no terminal report (exit code and files only)

Crawl options (plus profile budgets/measurement options)
  --sitemap <url>             explicit same-origin sitemap/index (optional)
  --max-pages <n>             1..1000, default100
  --concurrency <n>           1..4, default2
  Probes/screenshots default off for crawl. Partial/error/truncated crawl exits1.

Run options
  --out <dir> --format <...>  same as profile
  --budget-tokens <n>         per-step token budget (overrides the spec)
  --max-false-success <n>     allowed false-success steps (overrides the spec)
  --max-churn-pct <pct>       idle churn gate (measures once before the steps)
  --max-noise-pct <pct>       noise gate on the start page
  --max-steps <n>             run only the first n steps
  --settle-ms <n>             wait after each action (default 350)
  --quiet

Demo options
  --out <dir>                 where reports go (default agent-eye-report)
  --format <...>              default json,md,html
  --quiet

Spec format (YAML or JSON)
  name: checkout acceptance
  url: https://example.com/cart
  budget: { tokensPerStep: 8000, maxFalseSuccess: 0, maxChurnPct: 15 }
  steps:
    - name: add to cart
      target: { role: button, name: "Add to cart" }   # or selector / text / nth
      expect:
        - changed: true
        - textContains: "Added"
        - elementExists: { role: button, name: "Checkout" }
`;

function needs<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new UsageError(message);
  return value;
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv);
  const { flags, positional } = parsed;
  const stdout = process.stdout;
  const stderr = process.stderr;
  const quiet = flags.get("quiet") !== undefined && flags.get("quiet") !== false;

  const stringFlag = (name: string): string | undefined => {
    const value = flags.get(name);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const boolFlag = (name: string, fallback: boolean): boolean => {
    const value = flags.get(name);
    if (value === undefined) return fallback;
    return value !== false;
  };
  const numberFlag = (name: string): number | undefined => {
    const raw = stringFlag(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new UsageError(`--${name} expects a number, got "${raw}"`);
    return value;
  };
  const formats = (fallback: ReportFormat[]): ReportFormat[] => {
    const raw = stringFlag("format");
    const picked = new Set<ReportFormat>(fallback);
    if (raw) {
      picked.clear();
      for (const part of raw.split(",")) {
        const format = part.trim();
        if (format === "json" || format === "md" || format === "html") picked.add(format);
        else if (format) throw new UsageError(`unknown report format "${format}" (use json, md, html)`);
      }
    }
    if (boolFlag("json", false)) picked.add("json");
    if (boolFlag("md", false)) picked.add("md");
    if (boolFlag("html", false)) picked.add("html");
    return picked.size > 0 ? Array.from(picked) : fallback;
  };
  const tokenizer = (): TokenizerName => {
    const raw = stringFlag("tokenizer") ?? "o200k_base";
    if (raw !== "o200k_base" && raw !== "cl100k_base") throw new UsageError(`unknown tokenizer "${raw}" (use o200k_base or cl100k_base)`);
    return raw;
  };
  const viewport = (): { width: number; height: number } | undefined => {
    const raw = stringFlag("viewport");
    if (!raw) return undefined;
    const match = /^(\d+)x(\d+)$/i.exec(raw);
    if (!match) throw new UsageError(`--viewport expects WxH, e.g. 1280x900 (got "${raw}")`);
    return { width: Number(match[1]), height: Number(match[2]) };
  };

  let command = positional[0] ?? "";
  let args = positional.slice(1);

  if (flags.get("version") === true) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flags.get("help") === true || command === "help" || command === "") {
    stdout.write(HELP);
    return command === "" && flags.get("help") === undefined && positional.length === 0 && argv.length > 0 ? 2 : 0;
  }

  // `agent-eye https://example.com` is shorthand for `agent-eye profile <url>`.
  if (/^https?:\/\//i.test(command)) {
    args = [command, ...args];
    command = "profile";
  }

  try {
    if (command === "crawl") {
      const url = needs(args[0], "crawl needs a URL: agent-eye crawl <url>");
      if (!/^https?:\/\//i.test(url)) throw new UsageError(`profile needs an http(s) URL, got "${url}"`);
      const outDir = stringFlag("out");
      const probes = numberFlag("probes");
      const probesDisabled = flags.get("probes") === false;
      const { report, paths } = await crawlSite({
        url,
        sitemap: stringFlag("sitemap"), maxPages: numberFlag("max-pages"), concurrency: numberFlag("concurrency"),
        ...(outDir ? { outDir, formats: formats(["json", "md"]) } : {}),
        tokenizer: tokenizer(),
        ...(viewport() ? { viewport: viewport() } : {}),
        churnMs: numberFlag("churn-ms") ?? 1_500,
        churnIntervalMs: numberFlag("churn-interval") ?? 250,
        probes: probesDisabled ? false : probes === undefined ? false : probes > 0,
        maxProbes: probes ?? 5,
        maxElements: numberFlag("max-elements") ?? 400,
        freezeAnimations: boolFlag("freeze", true),
        fullPageScreenshot: boolFlag("screenshot", false),
        ...(stringFlag("storage-state") ? { storageState: stringFlag("storage-state") } : {}),
        waitUntil: (stringFlag("wait-until") as "load" | "domcontentloaded" | "networkidle" | undefined) ?? "load",
        ...(numberFlag("budget-tokens") !== undefined ? { budgetTokens: numberFlag("budget-tokens") } : {}),
        ...(numberFlag("max-false-success") !== undefined ? { maxFalseSuccess: numberFlag("max-false-success") } : {}),
        ...(numberFlag("max-churn-pct") !== undefined ? { maxChurnPct: numberFlag("max-churn-pct") } : {}),
        ...(numberFlag("max-noise-pct") !== undefined ? { maxNoisePct: numberFlag("max-noise-pct") } : {}),
        headless: !boolFlag("headed", false),
        ...(stringFlag("chromium") ? { executablePath: stringFlag("chromium") } : {}),
        ...(numberFlag("timeout") !== undefined ? { timeoutMs: numberFlag("timeout") } : {}),
        ...(quiet ? {} : { log: (line: string) => stderr.write(`· ${line}\n`) }),
      });
      if (!quiet) stdout.write(`${renderCrawlTerminal(report)}\n`);
      if (paths) {
        for (const [kind, filePath] of Object.entries(paths)) {
          if (filePath) stdout.write(`${kind}: ${filePath}\n`);
        }
      }
      return report.exitCode;
    }

    if (command === "profile") {
      const url = needs(args[0], "profile needs a URL: agent-eye profile <url>");
      if (!/^https?:\/\//i.test(url)) throw new UsageError(`profile needs an http(s) URL, got "${url}"`);
      const outDir = stringFlag("out");
      const probes = numberFlag("probes");
      const probesDisabled = flags.get("probes") === false;
      const { report, paths } = await profileUrl({
        url,
        ...(outDir ? { outDir, formats: formats(["json", "md"]) } : {}),
        tokenizer: tokenizer(),
        ...(viewport() ? { viewport: viewport() } : {}),
        churnMs: numberFlag("churn-ms") ?? 1_500,
        churnIntervalMs: numberFlag("churn-interval") ?? 250,
        probes: probesDisabled ? false : probes === undefined ? true : probes > 0,
        maxProbes: probes ?? 5,
        maxElements: numberFlag("max-elements") ?? 400,
        freezeAnimations: boolFlag("freeze", true),
        fullPageScreenshot: boolFlag("screenshot", true),
        ...(stringFlag("storage-state") ? { storageState: stringFlag("storage-state") } : {}),
        waitUntil: (stringFlag("wait-until") as "load" | "domcontentloaded" | "networkidle" | undefined) ?? "load",
        ...(numberFlag("budget-tokens") !== undefined ? { budgetTokens: numberFlag("budget-tokens") } : {}),
        ...(numberFlag("max-false-success") !== undefined ? { maxFalseSuccess: numberFlag("max-false-success") } : {}),
        ...(numberFlag("max-churn-pct") !== undefined ? { maxChurnPct: numberFlag("max-churn-pct") } : {}),
        ...(numberFlag("max-noise-pct") !== undefined ? { maxNoisePct: numberFlag("max-noise-pct") } : {}),
        headless: !boolFlag("headed", false),
        ...(stringFlag("chromium") ? { executablePath: stringFlag("chromium") } : {}),
        ...(numberFlag("timeout") !== undefined ? { timeoutMs: numberFlag("timeout") } : {}),
        ...(quiet ? {} : { log: (line: string) => stderr.write(`· ${line}\n`) }),
      });
      if (!quiet) stdout.write(`${renderTerminalProfile(report)}\n`);
      if (paths) {
        for (const [kind, filePath] of Object.entries(paths)) {
          if (filePath) stdout.write(`${kind}: ${filePath}\n`);
        }
      }
      return report.verdict.exitCode;
    }

    if (command === "run") {
      const specPath = needs(args[0], "run needs a spec: agent-eye run <spec.yaml|json>");
      const spec = loadSpec(specPath);
      const outDir = stringFlag("out");
      const { report, paths } = await runAcceptance(spec, {
        specPath,
        ...(outDir ? { outDir, formats: formats(["json", "md"]) } : {}),
        tokenizer: tokenizer(),
        ...(viewport() ? { viewport: viewport() } : {}),
        ...(numberFlag("budget-tokens") !== undefined ? { budgetTokens: numberFlag("budget-tokens") } : {}),
        ...(numberFlag("max-false-success") !== undefined ? { maxFalseSuccess: numberFlag("max-false-success") } : {}),
        ...(numberFlag("max-churn-pct") !== undefined ? { maxChurnPct: numberFlag("max-churn-pct") } : {}),
        ...(numberFlag("max-noise-pct") !== undefined ? { maxNoisePct: numberFlag("max-noise-pct") } : {}),
        ...(numberFlag("max-steps") !== undefined ? { maxSteps: numberFlag("max-steps") } : {}),
        ...(numberFlag("settle-ms") !== undefined ? { settleMs: numberFlag("settle-ms") } : {}),
        headless: !boolFlag("headed", false),
        ...(stringFlag("chromium") ? { executablePath: stringFlag("chromium") } : {}),
        ...(numberFlag("timeout") !== undefined ? { timeoutMs: numberFlag("timeout") } : {}),
        ...(quiet ? {} : { log: (line: string) => stderr.write(`· ${line}\n`) }),
      });
      if (!quiet) stdout.write(`${renderTerminalRun(report)}\n`);
      if (paths) {
        for (const [kind, filePath] of Object.entries(paths)) {
          if (filePath) stdout.write(`${kind}: ${filePath}\n`);
        }
      }
      return report.verdict.exitCode;
    }

    if (command === "demo") {
      const outDir = stringFlag("out") ?? "agent-eye-report";
      await runDemo({
        outDir,
        formats: formats(["json", "md", "html"]),
        headless: !boolFlag("headed", false),
        ...(stringFlag("chromium") ? { executablePath: stringFlag("chromium") } : {}),
        quiet,
        ...(quiet ? {} : { log: (line: string) => stderr.write(`· ${line}\n`) }),
      });
      return 0;
    }

    stderr.write(`unknown command "${command}"\n\n${HELP}`);
    return 2;
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`${error.message}\n`);
      return 2;
    }
    stderr.write(`${TOOL_NAME}: ${(error as Error).message}\n`);
    return 1;
  }
}
