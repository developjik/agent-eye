import { describe, expect, it } from "vitest";
import { computeDelta, diffLines, filterStable, maskLine, toVolatileFilter } from "../../src/metrics/delta.js";

describe("diffLines", () => {
  it("reports no change for identical snapshots", () => {
    const diff = diffLines(["- a", "- b"], ["- a", "- b"]);
    expect(diff).toMatchObject({ added: 0, removed: 0, unchanged: 2, changed: 0, unchangedPct: 100 });
  });

  it("counts added and removed lines", () => {
    const diff = diffLines(["- a", "- b"], ["- b", "- c"]);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.unchanged).toBe(1);
    expect(diff.unchangedPct).toBeCloseTo(50);
  });

  it("treats repeated lines as a multiset", () => {
    const diff = diffLines(["- same", "- same"], ["- same"]);
    expect(diff.removed).toBe(1);
    expect(diff.unchanged).toBe(1);
  });

  it("handles an empty snapshot", () => {
    expect(diffLines([], ["- a"])).toMatchObject({ added: 1, removed: 0, unchangedPct: 0 });
  });
});

describe("delta potential", () => {
  const steps = [
    { label: "initial", lines: ["- h1", "- button add", "- text a", "- text b"] },
    { label: "after click", lines: ["- h1", "- button add", "- text a", "- text b", "- notice added"] },
  ];

  it("computes savings between consecutive steps", () => {
    const delta = computeDelta(steps);
    expect(delta).not.toBeNull();
    expect(delta?.steps).toHaveLength(1);
    expect(delta?.steps[0]?.unchangedPct).toBeCloseTo(80);
    expect(delta?.avgSavingsPct).toBeGreaterThan(50);
    expect(delta?.avgSavingsPct).toBeLessThanOrEqual(100);
  });

  it("returns null for a single snapshot", () => {
    expect(computeDelta([steps[0]!])).toBeNull();
  });
});

describe("volatile filtering", () => {
  it("masks numbers so a clock keeps the same shape", () => {
    expect(maskLine("- text: 10:23:45.123")).toBe("- text: #:#:#.#");
  });

  it("drops lines and zones that were changing while idle", () => {
    const lines = ["- heading A", "- text: 10:23:45", "- text: promo 1", "- button Pay"];
    const zones = ["#title", "#clock", "#promo", "main"];
    const filter = toVolatileFilter({ volatileLines: ["- text: promo 1"], volatileZones: ["#clock"] });
    expect(filterStable(lines, zones, filter)).toEqual(["- heading A", "- button Pay"]);
  });

  it("returns everything when nothing is volatile", () => {
    const lines = ["- a", "- b"];
    expect(filterStable(lines, ["body", "body"], toVolatileFilter(null))).toBe(lines);
  });
});
