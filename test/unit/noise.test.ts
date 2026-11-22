import { describe, expect, it } from "vitest";
import { analyzeNoise } from "../../src/metrics/noise.js";
import { element } from "../helpers.js";
import type { RawElement } from "../../src/types.js";

function analyze(elements: RawElement[], total = elements.length, extra: Partial<Parameters<typeof analyzeNoise>[0]> = {}) {
  return analyzeNoise({
    elements,
    totalInteractive: total,
    truncated: false,
    shadowRoots: 0,
    frameCount: 0,
    frameInteractive: 0,
    ...extra,
  });
}

describe("analyzeNoise", () => {
  it("finds unnamed, duplicated, clipped and off-screen controls", () => {
    const report = analyze([
      element({ ref: "@e1", name: "Add to cart" }),
      element({ ref: "@e2", name: "Add to cart" }),
      element({ ref: "@e3", name: "" }),
      element({ ref: "@e4", name: "Hidden action", clipped: true, hidden: true, focusable: true }),
      element({ ref: "@e5", name: "Far away", offscreen: true }),
      element({ ref: "@e6", name: "Clean control" }),
    ]);

    expect(report.interactive).toBe(6);
    expect(report.unnamed.count).toBe(1);
    expect(report.duplicates.count).toBe(1);
    expect(report.duplicates.elements).toBe(2);
    expect(report.hidden.count).toBe(1);
    expect(report.hidden.clipped).toBe(1);
    expect(report.hidden.focusable).toBe(1);
    expect(report.offscreen.count).toBe(1);
    // e2, e3, e4, e5 are noisy; e1 is part of the duplicate cluster too -> all six are
    expect(report.noisePct).toBeCloseTo(83.3, 1);
  });

  it("does not count a properly hidden panel as noise", () => {
    const report = analyze([
      element({ ref: "@e1", name: "Visible" }),
      element({ ref: "@e2", name: "In a closed panel", hidden: true, focusable: false, zeroSize: true }),
    ]);
    expect(report.hidden.count).toBe(1);
    expect(report.hidden.focusable).toBe(0);
    expect(report.noisePct).toBe(0);
  });

  it("reports occluded controls with their occluder", () => {
    const report = analyze([element({ ref: "@e1", name: "Place order", occluded: true, occluder: '<button role=button "Accept all">' })]);
    expect(report.occluded.count).toBe(1);
    expect(report.occluded.items[0]?.detail).toContain("Accept all");
  });

  it("keeps large clusters sorted and capped", () => {
    const elements = Array.from({ length: 30 }, (_, index) =>
      element({ ref: `@e${index + 1}`, name: index < 20 ? "Apply coupon" : `Unique ${index}` }),
    );
    const report = analyze(elements);
    expect(report.duplicates.count).toBe(1);
    expect(report.duplicates.clusters[0]?.count).toBe(20);
    expect(report.duplicates.clusters[0]?.refs).toHaveLength(20);
  });

  it("carries iframe and shadow coverage counts", () => {
    const report = analyzeNoise({
      elements: [element({ ref: "@e1", name: "Sync", shadow: true })],
      totalInteractive: 1,
      truncated: false,
      shadowRoots: 1,
      frameCount: 2,
      frameInteractive: 3,
    });
    expect(report.frames).toEqual({ count: 2, interactive: 3 });
    expect(report.shadow).toEqual({ roots: 1, interactive: 1 });
  });
});
