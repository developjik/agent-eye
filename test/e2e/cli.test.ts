import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { withDemoServer } from "../helpers.js";

const run = promisify(execFile);
const CLI = join(process.cwd(), "dist", "bin", "agent-eye.js");
const OUT = join(process.cwd(), ".test-out", "cli");

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Spawn the built CLI as the user would. Kept async on purpose: the fixture
 * server lives in this process, so a blocking spawn would starve it.
 */
async function cli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { encoding: "utf8", env: process.env, timeout: 150_000 });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message ?? "", code: typeof failure.code === "number" ? failure.code : 1 };
  }
}

describe("cli", () => {
  it("prints version and help", async () => {
    expect((await cli(["--version"])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const help = (await cli(["--help"])).stdout;
    expect(help).toContain("agent-eye profile <url>");
    expect(help).toContain("agent-eye run <spec.yaml|json>");
    expect(help).toContain("agent-eye demo");
  });

  it("profiles a URL and writes reports", async () => {
    mkdirSync(OUT, { recursive: true });
    const result = await withDemoServer((baseUrl) =>
      cli(["profile", `${baseUrl}/checkout`, "--out", join(OUT, "profile"), "--format", "json,md", "--quiet", "--churn-ms", "0", "--no-probe"]),
    );
    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(join(OUT, "profile", "report.json"), "utf8")) as { bill: unknown[]; churn: unknown };
    expect(report.bill).toHaveLength(5);
    expect(report.churn).toBeNull();
    expect(existsSync(join(OUT, "profile", "report.md"))).toBe(true);
  }, 180_000);

  it("exits non-zero when a gate fails", async () => {
    const result = await withDemoServer((baseUrl) =>
      cli(["profile", `${baseUrl}/checkout`, "--quiet", "--churn-ms", "0", "--no-probe", "--budget-tokens", "1"]),
    );
    expect(result.code, result.stderr).toBe(1);
  }, 180_000);

  it("fails a requested click gate when probes are explicitly zero", async () => {
    const result = await withDemoServer(baseUrl =>
      cli(["profile", `${baseUrl}/checkout-clean`, "--churn-ms", "0", "--probes", "0", "--max-false-success", "0"]),
    );
    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout).toContain("not measured: probes disabled");
  }, 180_000);

  it("runs a spec file and reports the gate result", async () => {
    mkdirSync(OUT, { recursive: true });
    const result = await withDemoServer((baseUrl) => {
      const specPath = join(OUT, "acceptance.yml");
      writeFileSync(
        specPath,
        [
          "name: cli acceptance",
          `url: ${baseUrl}/checkout-clean`,
          "steps:",
          "  - name: find the headphones button",
          "    do: assert",
          "    expect:",
          "      - elementExists: { role: button, name: 'Add the Aria Headphones to cart' }",
          "",
        ].join("\n"),
        "utf8",
      );
      return cli(["run", specPath, "--quiet", "--out", join(OUT, "run")]);
    });
    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(join(OUT, "run", "report.json"), "utf8")) as { verdict: { status: string } };
    expect(report.verdict.status).toBe("pass");
  }, 180_000);

  it("rejects an invalid flag value with a usage error", async () => {
    const result = await cli(["run", "test/fixtures/spec-valid.yml", "--max-steps", "not-a-number"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--max-steps expects a number");
  });

  it("reports a missing spec argument", async () => {
    const result = await cli(["run"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("run needs a spec");
  });
});
