import { describe, expect, it } from "vitest";
import { parseArgv } from "../../src/cli.js";

describe("argv parsing", () => {
  it("reads positional arguments and value flags", () => {
    const parsed = parseArgv(["profile", "https://example.com", "--out", "reports", "--format=json,html", "--budget-tokens", "8000"]);
    expect(parsed.positional).toEqual(["profile", "https://example.com"]);
    expect(parsed.flags.get("out")).toBe("reports");
    expect(parsed.flags.get("format")).toBe("json,html");
    expect(parsed.flags.get("budget-tokens")).toBe("8000");
  });

  it("turns --no-<flag> into false", () => {
    const parsed = parseArgv(["profile", "https://example.com", "--no-probe", "--no-screenshot", "--no-freeze"]);
    expect(parsed.flags.get("probe")).toBe(false);
    expect(parsed.flags.get("screenshot")).toBe(false);
    expect(parsed.flags.get("freeze")).toBe(false);
  });

  it("keeps boolean flags without a value", () => {
    const parsed = parseArgv(["demo", "--quiet", "--headed"]);
    expect(parsed.flags.get("quiet")).toBe(true);
    expect(parsed.flags.get("headed")).toBe(true);
  });

  it("supports short help and version flags", () => {
    expect(parseArgv(["-h"]).flags.get("help")).toBe(true);
    expect(parseArgv(["-v"]).flags.get("version")).toBe(true);
  });

  it("does not swallow a following flag as a value", () => {
    const parsed = parseArgv(["profile", "https://example.com", "--out", "--quiet"]);
    expect(parsed.flags.get("out")).toBe("");
    expect(parsed.flags.get("quiet")).toBe(true);
  });
});
