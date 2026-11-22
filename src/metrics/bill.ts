import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import { formatCompactInteractive } from "../format.js";
import {
  byteLength,
  claudeImageTokens,
  countTokensDetailed,
  openAiImageTokens,
  pngSize,
  type TokenizerName,
} from "../tokens.js";
import type { ModeBill, RawElement } from "../types.js";

const require = createRequire(import.meta.url);

let readabilitySource: string | null = null;

function getReadabilitySource(): string {
  if (!readabilitySource) {
    readabilitySource = readFileSync(require.resolve("@mozilla/readability/Readability.js"), "utf8");
  }
  return readabilitySource;
}

export interface BillInput {
  tokenizer: TokenizerName;
  elements: RawElement[];
  compactText: string;
  fullPageScreenshot: { png: Buffer; jpeg: Buffer; width: number; height: number } | null;
}

export interface BillResult {
  modes: ModeBill[];
  compactText: string;
}

function textMode(mode: string, label: string, text: string, tokenizer: TokenizerName, note?: string): ModeBill {
  const { tokens, sampled } = countTokensDetailed(text, tokenizer);
  return {
    mode,
    label,
    bytes: byteLength(text),
    tokens,
    estimated: sampled,
    note: sampled ? "2M-char sample extrapolated" : note,
  };
}

async function readabilityText(page: Page): Promise<{ text: string; note?: string }> {
  try {
    const alreadyLoaded = await page.evaluate(() => typeof (window as unknown as { Readability?: unknown }).Readability === "function");
    if (!alreadyLoaded) await page.addScriptTag({ content: getReadabilitySource() });
    const article = await page.evaluate(() => {
      type Reader = { parse: () => { title?: string; textContent?: string } | null };
      const Ctor = (window as unknown as { Readability: new (doc: Document) => Reader }).Readability;
      const clone = document.cloneNode(true) as Document;
      const parsed = new Ctor(clone).parse();
      if (!parsed || !parsed.textContent) return null;
      return { title: parsed.title ?? "", text: parsed.textContent };
    });
    if (!article) {
      const fallback = await page.evaluate(() => document.body?.innerText ?? "");
      return { text: fallback, note: "Readability found no article; fell back to body text" };
    }
    return { text: `${article.title}\n\n${article.text}`.trim() };
  } catch (error) {
    const fallback = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    return { text: fallback, note: `Readability failed (${(error as Error).message}); used body text` };
  }
}

export async function measureBill(page: Page, input: BillInput): Promise<BillResult> {
  const modes: ModeBill[] = [];

  const html = await page.content();
  modes.push(textMode("raw-html", "raw HTML (page.content())", html, input.tokenizer, "what fetch() + no parsing gives an agent"));

  const readable = await readabilityText(page);
  modes.push(textMode("readability-text", "readability text (article extraction)", readable.text, input.tokenizer, readable.note ?? "Mozilla Readability over a DOM clone"));

  let ariaText = "";
  try {
    ariaText = await page.locator("body").ariaSnapshot();
  } catch {
    ariaText = await page.locator("html").ariaSnapshot().catch(() => "");
  }
  modes.push(textMode("aria-snapshot", "ARIA snapshot (Playwright, full tree)", ariaText, input.tokenizer, "the YAML tree a driver hands an agent"));

  const compact = input.compactText || formatCompactInteractive(input.elements);
  modes.push(
    textMode(
      "interactive-refs",
      "compact interactive refs (names + states)",
      compact,
      input.tokenizer,
      `${input.elements.length} interactive elements, one line each`,
    ),
  );

  const shot = input.fullPageScreenshot;
  if (shot) {
    const openAi = openAiImageTokens(shot.width, shot.height);
    const claude = claudeImageTokens(shot.width, shot.height);
    modes.push({
      mode: "screenshot",
      label: `screenshot 1x ${shot.width}x${shot.height} (vision estimate)`,
      bytes: shot.png.length,
      tokens: openAi,
      estimated: true,
      note: `PNG ${(shot.png.length / 1024).toFixed(1)} KB, JPEG ${(shot.jpeg.length / 1024).toFixed(1)} KB, vision ≈ ${openAi} tok (OpenAI high) / ${claude} tok (Claude)`,
    });
  }

  return { modes, compactText: compact };
}

export function screenshotSize(buffer: Buffer): { width: number; height: number } {
  return pngSize(buffer);
}
