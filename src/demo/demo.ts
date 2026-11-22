import { parseSpecObject, type RunSpec } from "../run/spec.js";
import type { ReportFormat } from "../report/write.js";
import { renderComparison, renderTerminalProfile, renderTerminalRun } from "../report/terminal.js";
import { profileUrl, type ProfileOutcome } from "../profile.js";
import { runAcceptance, type RunOutcome } from "../run/runner.js";
import { startDemoServer } from "./server.js";

export interface DemoOptions {
  outDir?: string;
  formats?: ReportFormat[];
  headless?: boolean;
  executablePath?: string;
  quiet?: boolean;
  log?: (line: string) => void;
}

export interface DemoResult {
  before: ProfileOutcome;
  after: ProfileOutcome;
  cleanRun: RunOutcome;
  noisyRun: RunOutcome;
  comparison: string;
  serverUrl: string;
}

export function cleanAcceptanceSpec(baseUrl: string): RunSpec {
  return parseSpecObject(
    {
      name: "Clean checkout — acceptance",
      url: `${baseUrl}/checkout-clean`,
      budget: { tokensPerStep: 8000, maxFalseSuccess: 0 },
      steps: [
        {
          name: "find the headphones button",
          do: "assert",
          expect: [{ elementExists: { role: "button", name: "Add the Aria Headphones to cart" } }],
        },
        {
          name: "add the headphones",
          target: { role: "button", name: "Add the Aria Headphones to cart" },
          expect: [{ changed: true }, { textContains: "Added to your cart." }],
        },
        {
          name: "open shipping details",
          target: { role: "button", name: "Shipping details" },
          expect: [{ changed: true }, { textContains: "Ships in 2 business days" }],
        },
        {
          name: "open the search field",
          target: { role: "button", name: "Search products" },
          expect: [{ changed: true }],
        },
      ],
    },
    "Clean checkout — acceptance",
  );
}

export function noisyAcceptanceSpec(baseUrl: string): RunSpec {
  return parseSpecObject(
    {
      name: "Noisy checkout — acceptance",
      url: `${baseUrl}/checkout`,
      budget: { tokensPerStep: 8000, maxFalseSuccess: 0 },
      steps: [
        {
          name: "add the headphones by name",
          target: { role: "button", name: "Add the Aria Headphones to cart" },
          expect: [{ changed: true }],
        },
        {
          name: "open shipping details",
          target: { role: "button", name: "Shipping details" },
          expect: [{ changed: true }],
        },
      ],
    },
    "Noisy checkout — acceptance",
  );
}

export async function runDemo(options: DemoOptions = {}): Promise<DemoResult> {
  const log = options.log ?? (() => undefined);
  const outDir = options.outDir ?? "agent-eye-report";
  const formats = options.formats ?? ["json", "md", "html"];
  const server = await startDemoServer();
  log(`demo app on ${server.url}`);

  try {
    const before = await profileUrl({
      url: `${server.url}/checkout`,
      outDir: `${outDir}/before`,
      formats,
      churnMs: 1_500,
      maxProbes: 6,
      headless: options.headless,
      executablePath: options.executablePath,
      log,
    });
    const after = await profileUrl({
      url: `${server.url}/checkout-clean`,
      outDir: `${outDir}/after`,
      formats,
      churnMs: 1_500,
      maxProbes: 6,
      headless: options.headless,
      executablePath: options.executablePath,
      log,
    });

    const cleanRun = await runAcceptance(cleanAcceptanceSpec(server.url), {
      outDir: `${outDir}/run-clean`,
      formats,
      headless: options.headless,
      executablePath: options.executablePath,
      log,
    });
    const noisyRun = await runAcceptance(noisyAcceptanceSpec(server.url), {
      outDir: `${outDir}/run-noisy`,
      formats,
      headless: options.headless,
      executablePath: options.executablePath,
      log,
    });

    const comparison = renderComparison(before.report, after.report);

    if (!options.quiet) {
      const out = process.stdout;
      out.write("\n=== BEFORE: /checkout ===\n\n");
      out.write(`${renderTerminalProfile(before.report)}\n\n`);
      out.write("=== AFTER: /checkout-clean ===\n\n");
      out.write(`${renderTerminalProfile(after.report)}\n\n`);
      out.write("=== BEFORE vs AFTER ===\n\n");
      out.write(`${comparison}\n\n`);
      out.write("=== ACCEPTANCE RUN: clean page ===\n\n");
      out.write(`${renderTerminalRun(cleanRun.report)}\n\n`);
      out.write("=== ACCEPTANCE RUN: noisy page ===\n\n");
      out.write(`${renderTerminalRun(noisyRun.report)}\n\n`);
      out.write(`Reports written to ${outDir}/{before,after,run-clean,run-noisy}\n`);
    }

    return { before, after, cleanRun, noisyRun, comparison, serverUrl: server.url };
  } finally {
    await server.close();
  }
}
