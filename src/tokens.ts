import { encode as encodeCl100k } from "gpt-tokenizer/encoding/cl100k_base";
import { encode as encodeO200k } from "gpt-tokenizer/encoding/o200k_base";
import type { TokenizerName } from "./types.js";

export type { TokenizerName } from "./types.js";

/**
 * Token counts are approximations made locally with a BPE tokenizer that
 * matches the model family named below. They are meant for comparison
 * (before/after, mode vs mode), not as billing figures.
 */
export const TOKENIZER_LABELS: Record<TokenizerName, string> = {
  o200k_base: "o200k_base (GPT-4o / 4.1 / 5 family)",
  cl100k_base: "cl100k_base (GPT-3.5 / GPT-4 family)",
};

export const TOKENIZER_NOTE =
  "counted locally with gpt-tokenizer; expect a few percent drift versus a vendor tokenizer, so compare ratios rather than absolute numbers";

/** Above this many characters a text is tokenized once in a sample window and extrapolated. */
const SAMPLE_CHARS = 2_000_000;

export interface TokenCount {
  tokens: number;
  sampled: boolean;
}

export function countTokensDetailed(text: string, tokenizer: TokenizerName = "o200k_base"): TokenCount {
  if (!text) return { tokens: 0, sampled: false };
  const encode = tokenizer === "cl100k_base" ? encodeCl100k : encodeO200k;
  if (text.length <= SAMPLE_CHARS) {
    return { tokens: encode(text).length, sampled: false };
  }
  const head = encode(text.slice(0, SAMPLE_CHARS)).length;
  const ratio = head / SAMPLE_CHARS;
  return { tokens: Math.round(ratio * text.length), sampled: true };
}

export function countTokens(text: string, tokenizer: TokenizerName = "o200k_base"): number {
  return countTokensDetailed(text, tokenizer).tokens;
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * OpenAI vision token estimate for a "high" detail image, following the
 * documented tiling rule: fit inside 2048x2048, then scale the shortest side
 * to 768, then 512x512 tiles at 170 tokens each plus an 85 token base.
 * @see https://platform.openai.com/docs/guides/images-vision
 */
export function openAiImageTokens(width: number, height: number): number {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const fit = Math.min(1, 2048 / Math.max(w, h));
  let cw = w * fit;
  let ch = h * fit;
  const shrink = 768 / Math.min(cw, ch);
  if (shrink < 1) {
    cw *= shrink;
    ch *= shrink;
  }
  const tiles = Math.ceil(cw / 512) * Math.ceil(ch / 512);
  return 85 + 170 * tiles;
}

/**
 * Anthropic vision estimate: about one token per 750 pixels.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/vision
 */
export function claudeImageTokens(width: number, height: number): number {
  return Math.ceil((Math.max(1, width) * Math.max(1, height)) / 750);
}

/** PNG dimensions straight from the IHDR chunk. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.toString("latin1", 1, 4) !== "PNG") {
    return { width: 0, height: 0 };
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTokens(tokens: number): string {
  return Math.round(tokens).toLocaleString("en-US");
}
