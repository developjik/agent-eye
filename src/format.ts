import type { RawElement } from "./types.js";

/** One-line descriptor per interactive element, the compact view an agent uses. */
export function formatCompactElement(el: RawElement): string {
  const state: string[] = [];
  if (el.disabled) state.push("disabled");
  if (el.hidden) state.push("hidden");
  if (el.occluded) state.push("occluded");
  if (el.ariaHidden) state.push("aria-hidden");
  const label = el.name ? `"${el.name}"` : "(no name)";
  const extra: string[] = [];
  if (el.role === "textbox" || el.role === "searchbox" || el.role === "combobox") {
    const value = el.text || "";
    if (value) extra.push(`= "${value}"`);
  } else if (el.role === "link" && el.href) {
    extra.push(`-> ${el.href}`);
  }
  const tags = state.length ? ` (${state.join(", ")})` : "";
  return `${el.ref} [${el.role}] ${label}${extra.length ? " " + extra.join(" ") : ""}${tags}`;
}

export function formatCompactInteractive(elements: RawElement[]): string {
  return elements.map(formatCompactElement).join("\n");
}

/** Display width that treats CJK and emoji as two columns, for terminal tables. */
export function visualWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) continue;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function padRight(text: string, width: number): string {
  const gap = width - visualWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

export function padLeft(text: string, width: number): string {
  const gap = width - visualWidth(text);
  return gap > 0 ? " ".repeat(gap) + text : text;
}

export function truncate(text: string, max: number): string {
  if (visualWidth(text) <= max) return text;
  let out = "";
  let width = 0;
  for (const char of text) {
    const w = visualWidth(char);
    if (width + w > max - 1) break;
    out += char;
    width += w;
  }
  return `${out}…`;
}

export interface TableRow {
  cells: string[];
  emphasis?: boolean;
}

export function renderTable(headers: string[], rows: TableRow[], align: ("left" | "right")[] = []): string {
  const widths = headers.map((header, index) => {
    const cellWidths = rows.map((row) => visualWidth(row.cells[index] ?? ""));
    return Math.max(visualWidth(header), ...cellWidths, 3);
  });
  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => ((align[index] ?? "left") === "right" ? padLeft(cell, widths[index]) : padRight(cell, widths[index])))
      .join("  ")
      .trimEnd();
  const out: string[] = [];
  out.push(line(headers));
  out.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) out.push(line(row.cells));
  return out.join("\n");
}

export function pct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}
