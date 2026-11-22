import type { DuplicateCluster, NoiseItem, NoiseReport, RawElement } from "../types.js";

export interface NoiseInput {
  elements: RawElement[];
  totalInteractive: number;
  truncated: boolean;
  shadowRoots: number;
  frameCount: number;
  frameInteractive: number;
}

function item(el: RawElement, reason: string, detail?: string): NoiseItem {
  return { ref: el.ref, role: el.role, tag: el.tag, name: el.name, reason, detail };
}

export function analyzeNoise(input: NoiseInput): NoiseReport {
  const elements = input.elements;
  const analyzed = elements.length;

  const unnamedItems = elements.filter((el) => !el.name && !el.hidden).map((el) => item(el, "no accessible name", `${el.tag} exposes only ${el.role} to an agent`));

  const byKey = new Map<string, RawElement[]>();
  for (const el of elements) {
    if (!el.name || el.hidden) continue;
    const key = `${el.role}|${el.name}`;
    const list = byKey.get(key) ?? [];
    list.push(el);
    byKey.set(key, list);
  }
  const clusters: DuplicateCluster[] = [];
  let ambiguousElements = 0;
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const [role, name] = key.split("|");
    clusters.push({ role: role ?? "", name: name ?? "", count: list.length, refs: list.map((el) => el.ref) });
    ambiguousElements += list.length;
  }
  clusters.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const hiddenElements = elements.filter((el) => el.hidden);
  const traps = hiddenElements.filter((el) => el.focusable || el.clipped);
  const offscreenElements = elements.filter((el) => !el.hidden && el.offscreen);
  const occludedElements = elements.filter((el) => el.occluded && !el.hidden);
  const inViewport = elements.filter((el) => !el.hidden && !el.zeroSize && !el.offscreen).length;

  const noisy = new Set<string>();
  for (const el of unnamedItems) noisy.add(el.ref);
  for (const cluster of clusters) for (const ref of cluster.refs) noisy.add(ref);
  for (const el of traps) noisy.add(el.ref);
  for (const el of offscreenElements) noisy.add(el.ref);

  const noisePct = analyzed > 0 ? (noisy.size / analyzed) * 100 : 0;
  const ambiguousPct = analyzed > 0 ? (ambiguousElements / analyzed) * 100 : 0;

  return {
    interactive: input.totalInteractive,
    analyzed,
    truncated: input.truncated,
    unnamed: { count: unnamedItems.length, items: unnamedItems.slice(0, 12) },
    duplicates: { count: clusters.length, elements: ambiguousElements, clusters: clusters.slice(0, 10) },
    hidden: {
      count: hiddenElements.length,
      focusable: hiddenElements.filter((el) => el.focusable).length,
      clipped: hiddenElements.filter((el) => el.clipped).length,
      items: hiddenElements
        .slice(0, 10)
        .map((el) =>
          item(
            el,
            el.clipped ? "rendered at under 2px (clipped)" : "present but not rendered",
            el.focusable ? "still focusable — agents and keyboards reach it" : undefined,
          ),
        ),
    },
    offscreen: {
      count: offscreenElements.length,
      items: offscreenElements.slice(0, 10).map((el) => item(el, "coordinates outside the document", "clicking its box lands nowhere")),
    },
    occluded: {
      count: occludedElements.length,
      inViewport,
      items: occludedElements
        .slice(0, 10)
        .map((el) => item(el, "covered at its click point", `topmost element is ${el.occluder ?? "an overlay"}`)),
    },
    frames: { count: input.frameCount, interactive: input.frameInteractive },
    shadow: { roots: input.shadowRoots, interactive: elements.filter((el) => el.shadow).length },
    noisePct,
    ambiguousPct,
  };
}
