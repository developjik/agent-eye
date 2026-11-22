import { describe, expect, it } from "vitest";
import { isDestructiveName, isSafeProbeTarget } from "../../src/metrics/action-truth.js";
import { element } from "../helpers.js";

describe("action probe safety", () => {
  it("treats money, deletion and session-ending labels as destructive", () => {
    for (const name of ["Delete account", "Pay now", "Place order", "Submit", "Log out", "Cancel subscription", "예약하기", "결제하기", "삭제"]) {
      expect(isDestructiveName(name), name).toBe(true);
    }
  });

  it("allows ordinary, reversible labels", () => {
    for (const name of ["Shipping details", "Apply gift card", "Add to cart", "Returns", "Search products", "Next slide"]) {
      expect(isDestructiveName(name), name).toBe(false);
    }
  });

  it("only clicks named, enabled, non-destructive in-page controls", () => {
    expect(isSafeProbeTarget(element({ name: "Shipping details" }))).toBe(true);
    expect(isSafeProbeTarget(element({ role: "tab", name: "Reviews", tag: "button" }))).toBe(true);
    expect(isSafeProbeTarget(element({ role: "checkbox", name: "Gift wrap", tag: "input" }))).toBe(true);
  });

  it("refuses unnamed, disabled and hidden controls", () => {
    expect(isSafeProbeTarget(element({ name: "" }))).toBe(false);
    expect(isSafeProbeTarget(element({ name: "More", disabled: true }))).toBe(false);
    expect(isSafeProbeTarget(element({ name: "More", hidden: true }))).toBe(false);
    expect(isSafeProbeTarget(element({ name: "More", clipped: true }))).toBe(false);
  });

  it("refuses links, form controls and form submissions", () => {
    expect(isSafeProbeTarget(element({ name: "Home", tag: "a", role: "link", href: "/" }))).toBe(false);
    expect(isSafeProbeTarget(element({ name: "Search", role: "searchbox", tag: "input" }))).toBe(false);
    expect(isSafeProbeTarget(element({ name: "Subscribe", inForm: true }))).toBe(false);
    expect(isSafeProbeTarget(element({ name: "Continue", type: "submit", tag: "input" }))).toBe(false);
  });

  it("refuses a destructive label even when the role is otherwise eligible", () => {
    expect(isSafeProbeTarget(element({ name: "Delete item", role: "button" }))).toBe(false);
  });
});
