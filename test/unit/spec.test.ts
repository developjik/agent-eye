import { describe, expect, it } from "vitest";
import { actionOf, loadSpec, parseSpecObject, SpecError } from "../../src/run/spec.js";

const valid = {
  name: "checkout",
  url: "https://example.com/cart",
  budget: { tokensPerStep: 8000, maxFalseSuccess: 0, maxChurnPct: 10 },
  steps: [
    { name: "goto cart", url: "https://example.com/cart" },
    { name: "add", target: { role: "button", name: "Add to cart" }, expect: [{ changed: true }] },
    { name: "search", target: { role: "searchbox", name: "Search" }, value: "shoes" },
    { name: "enter", do: "press", target: { role: "searchbox" }, key: "Enter" },
    { name: "check", do: "assert", expect: [{ elementExists: { role: "button", name: "Checkout" } }] },
  ],
};

describe("acceptance spec", () => {
  it("parses a full spec and infers actions", () => {
    const spec = parseSpecObject(valid);
    expect(spec.name).toBe("checkout");
    expect(spec.steps).toHaveLength(5);
    expect(spec.budget?.tokensPerStep).toBe(8000);
    expect(spec.steps.map((step) => actionOf(step))).toEqual(["goto", "click", "fill", "press", "assert"]);
  });

  it("defaults the name when missing", () => {
    const spec = parseSpecObject({ url: "https://example.com", steps: [{ url: "https://example.com" }] }, "my-spec");
    expect(spec.name).toBe("my-spec");
  });

  it("rejects a click without a target", () => {
    expect(() => parseSpecObject({ steps: [{ do: "click", expect: [{ changed: true }] }] })).toThrow(SpecError);
    try {
      parseSpecObject({ steps: [{ do: "click" }] });
    } catch (error) {
      expect((error as Error).message).toContain("click needs a `target`");
    }
  });

  it("rejects a fill without a value and a press without a key", () => {
    expect(() => parseSpecObject({ steps: [{ target: { role: "textbox" }, value: undefined, do: "fill" }] })).toThrow(/fill needs a `value`/);
    expect(() => parseSpecObject({ steps: [{ target: { role: "textbox" }, do: "press" }] })).toThrow(/press needs a `key`/);
  });

  it("rejects an empty expectation and an empty step list", () => {
    expect(() => parseSpecObject({ steps: [{ target: { role: "button" }, expect: [{}] }] })).toThrow(SpecError);
    expect(() => parseSpecObject({ steps: [] })).toThrow(SpecError);
  });

  it("loads YAML from disk and reports parse errors clearly", () => {
    const spec = loadSpec("test/fixtures/spec-valid.yml");
    expect(spec.name).toBe("fixture checkout");
    expect(spec.steps).toHaveLength(2);
    expect(() => loadSpec("test/fixtures/does-not-exist.yml")).toThrow();
  });
});
