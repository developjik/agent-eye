import { describe, expect, it } from "vitest";
import { cleanAcceptanceSpec, noisyAcceptanceSpec } from "../../src/demo/demo.js";
import { parseSpecObject } from "../../src/run/spec.js";
import { runAcceptance } from "../../src/run/runner.js";
import { withDemoServer } from "../helpers.js";

describe("run: deterministic acceptance", () => {
  it("passes every step on the clean page", async () => {
    const { report } = await withDemoServer((baseUrl) => runAcceptance(cleanAcceptanceSpec(baseUrl)));

    expect(report.totals.steps).toBe(4);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.falseSuccess).toBe(0);
    expect(report.verdict.exitCode).toBe(0);
    expect(report.verdict.status).toBe("pass");
    expect(report.totals.tokens).toBeGreaterThan(0);
    for (const step of report.steps) {
      expect(step.expectations.every((expectation) => expectation.passed)).toBe(true);
    }
  }, 180_000);

  it("fails the noisy page and explains what the agent could not address", async () => {
    const { report } = await withDemoServer((baseUrl) => runAcceptance(noisyAcceptanceSpec(baseUrl)));

    expect(report.verdict.exitCode).toBe(1);
    const [first, second] = report.steps;
    expect(first?.status).toBe("failed");
    expect(first?.error).toContain("target not found");
    expect(first?.candidates?.length).toBeGreaterThan(0);
    expect(first?.candidates?.some((candidate) => candidate.includes("Add to cart"))).toBe(true);
    expect(second?.name).toBe("open shipping details");
    expect(second?.status).toBe("failed");
    expect(second?.falseSuccess).toBe(true);
    expect(report.gates.find((gate) => gate.name === "all-steps-pass")?.passed).toBe(false);
  }, 180_000);

  it("fails the token budget gate without failing the steps", async () => {
    const spec = parseSpecObject({
      name: "tight budget",
      url: "",
      steps: [{ name: "assert the button", do: "assert", expect: [{ elementExists: { role: "button", name: "Apply gift card" } }] }],
    });
    const { report } = await withDemoServer((baseUrl) =>
      runAcceptance({ ...spec, url: `${baseUrl}/checkout-clean` }, { budgetTokens: 10 }),
    );

    expect(report.totals.failed).toBe(0);
    const gate = report.gates.find((item) => item.name === "tokens-per-step");
    expect(gate?.passed).toBe(false);
    expect(report.verdict.exitCode).toBe(1);
  }, 180_000);
});
