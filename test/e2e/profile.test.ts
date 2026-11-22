import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { profileUrl } from "../../src/profile.js";
import { withDemoServer } from "../helpers.js";

const OUT = join(process.cwd(), ".test-out", "profile");

describe("profile: noisy checkout", () => {
  it("measures the bill, noise, churn, delta headroom and false-success clicks", async () => {
    const outcome = await withDemoServer((baseUrl) =>
      profileUrl({
        url: `${baseUrl}/checkout`,
        outDir: join(OUT, "before"),
        formats: ["json", "md", "html"],
        churnMs: 1_200,
        churnIntervalMs: 200,
        maxProbes: 5,
        budgetTokens: 100,
      }),
    );
    const { report, paths } = outcome;

    expect(report.target.status).toBe(200);
    expect(report.target.title).toContain("Aria Store");

    // 1. observation bill: five modes, text modes cheaper than raw HTML
    const modes = report.bill.map((mode) => mode.mode);
    expect(modes).toEqual(["raw-html", "readability-text", "aria-snapshot", "interactive-refs", "screenshot"]);
    const raw = report.bill.find((mode) => mode.mode === "raw-html")!;
    const compact = report.bill.find((mode) => mode.mode === "interactive-refs")!;
    const screenshot = report.bill.find((mode) => mode.mode === "screenshot")!;
    expect(raw.tokens).toBeGreaterThan(compact.tokens);
    expect(compact.bytes).toBeLessThan(raw.bytes);
    expect(screenshot.estimated).toBe(true);
    expect(screenshot.tokens).toBeGreaterThan(0);
    expect(report.scorecard.tokensPerStep).toBe(compact.tokens);

    // 2. noise and ambiguity
    expect(report.noise.duplicates.count).toBe(1);
    expect(report.noise.duplicates.clusters[0]?.name).toBe("Add to cart");
    expect(report.noise.duplicates.clusters[0]?.count).toBe(3);
    expect(report.noise.unnamed.count).toBe(2);
    expect(report.noise.occluded.count).toBeGreaterThanOrEqual(1);
    expect(report.noise.occluded.items.some((item) => item.name === "Apply gift card")).toBe(true);
    expect(report.noise.hidden.focusable).toBeGreaterThanOrEqual(1);
    expect(report.noise.frames.interactive).toBeGreaterThanOrEqual(2);
    expect(report.noise.noisePct).toBeGreaterThan(20);

    // 3. idle churn, with the ticking region identified
    expect(report.churn).not.toBeNull();
    expect(report.churn!.unstableSamplePct).toBeGreaterThan(50);
    expect(report.churn!.volatileZones).toContain("#clock");
    expect(report.churn!.tokensChurned).toBeGreaterThan(0);

    // 4. delta headroom from consecutive step snapshots
    expect(report.delta).not.toBeNull();
    expect(report.delta!.steps.length).toBeGreaterThanOrEqual(2);
    expect(report.delta!.avgUnchangedPct).toBeGreaterThan(50);
    expect(report.delta!.avgSavingsPct).toBeGreaterThan(0);

    // 5. action truth: the dead toggle and the covered button are caught
    expect(report.actionTruth).not.toBeNull();
    const controls = report.actionTruth!.controls;
    expect(report.actionTruth!.attempted).toBe(5);
    const deadToggle = controls.find((control) => control.name === "Shipping details");
    expect(deadToggle?.verdict).toBe("no-effect");
    expect(report.actionTruth!.noEffect).toBeGreaterThanOrEqual(1);
    expect(report.actionTruth!.falseSuccessPct).toBeGreaterThan(0);
    expect(controls.some((control) => control.verdict === "blocked")).toBe(true);

    // findings and gate
    expect(report.verdict.findings.length).toBeGreaterThan(0);
    expect(report.verdict.findings.some((finding) => finding.severity === "high")).toBe(true);
    expect(report.gates[0]).toMatchObject({ name: "budget-tokens", passed: false });
    expect(report.verdict.exitCode).toBe(1);

    // artifacts
    expect(paths?.json && existsSync(paths.json)).toBe(true);
    expect(paths?.md && existsSync(paths.md)).toBe(true);
    expect(paths?.html && existsSync(paths.html)).toBe(true);
    expect(paths?.screenshot && existsSync(paths.screenshot)).toBe(true);
  }, 180_000);
});

describe("profile: clean checkout", () => {
  it("shows far less noise, no churn and no false success", async () => {
    const { report } = await withDemoServer((baseUrl) =>
      profileUrl({
        url: `${baseUrl}/checkout-clean`,
        churnMs: 800,
        churnIntervalMs: 200,
        maxProbes: 4,
      }),
    );

    expect(report.noise.noisePct).toBeLessThan(15);
    expect(report.noise.duplicates.count).toBe(0);
    expect(report.noise.unnamed.count).toBe(0);
    expect(report.noise.occluded.count).toBe(0);
    expect(report.churn?.unstableSamplePct).toBe(0);
    expect(report.actionTruth?.falseSuccessPct).toBe(0);
    expect(report.actionTruth?.effective).toBeGreaterThanOrEqual(3);
    expect(report.verdict.exitCode).toBe(0);
    expect(["pass", "warn"]).toContain(report.verdict.status);
  }, 180_000);
});
