import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claudeImageTokens,
  countTokens,
  countTokensDetailed,
  formatBytes,
  formatTokens,
  openAiImageTokens,
  pngSize,
} from "../../src/tokens.js";
import { TOOL_NAME, VERSION } from "../../src/version.js";
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

describe("token estimation", () => {
  it("counts text with the requested encoding", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens("hello world")).toBeGreaterThan(0);
    expect(countTokens("안녕하세요", "o200k_base")).toBeGreaterThan(0);
  });

  it("keeps the two encodings distinct", () => {
    // Korean is packed more densely in o200k_base than in cl100k_base.
    const text = "안녕하세요 세계";
    expect(countTokens(text, "cl100k_base")).toBeGreaterThan(countTokens(text, "o200k_base"));
  });

  it("marks extrapolated counts", () => {
    const small = countTokensDetailed("short text");
    expect(small.sampled).toBe(false);
    const long = "word ".repeat(600_000);
    const result = countTokensDetailed(long);
    expect(result.sampled).toBe(true);
    expect(result.tokens).toBeGreaterThan(100_000);
  });
});

describe("vision token estimates", () => {
  it("follows the OpenAI tiling rule", () => {
    // 1280x720 fits in 2048, shortest side stays above 768 -> 3x2 tiles of 512.
    expect(openAiImageTokens(1280, 720)).toBe(85 + 170 * 6);
    // A 2048px square is scaled down until its shortest side is 768 -> 2x2 tiles.
    expect(openAiImageTokens(2048, 2048)).toBe(85 + 170 * 4);
    expect(openAiImageTokens(1, 1)).toBe(85 + 170);
  });

  it("uses one token per 750 pixels for Claude", () => {
    expect(claudeImageTokens(750, 1000)).toBe(1000);
    expect(claudeImageTokens(1000, 1000)).toBe(1334);
  });
});

describe("formatting and PNG parsing", () => {
  it("formats bytes and tokens", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatTokens(12345)).toBe("12,345");
  });

  it("reads width and height from a PNG header", () => {
    const buffer = Buffer.alloc(24);
    buffer.write("\x89PNG\r\n\x1a\n", 0, "latin1");
    buffer.write("IHDR", 12, "latin1");
    buffer.writeUInt32BE(1280, 16);
    buffer.writeUInt32BE(1164, 20);
    expect(pngSize(buffer)).toEqual({ width: 1280, height: 1164 });
    expect(pngSize(Buffer.from("nope"))).toEqual({ width: 0, height: 0 });
  });
});

describe("package metadata", () => {
  it("keeps the version constant in sync with package.json", () => {
    expect(VERSION).toBe(pkg.version);
    expect(TOOL_NAME).toBe("agent-eye");
  });
});
