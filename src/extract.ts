import type { ExtractResult, PageSignature, RawElement } from "./types.js";

export interface ExtractOptions {
  maxElements: number;
  markRefs: boolean;
}

/** The same interactive selector used in the page, for counting inside child frames. */
export const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="treeitem"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Runs inside the page. Collects every interactive element (including inside
 * open shadow roots) with the information an agent would have to reason about:
 * role, accessible name, visibility, occlusion, and form context.
 */
export function extractPageElements(opts: ExtractOptions): ExtractResult {
  const INTERACTIVE = [
    "a[href]",
    "button",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="radio"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="combobox"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="treeitem"]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  const norm = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim();
  const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  const rootTagRole: Record<string, string> = {
    a: "link",
    button: "button",
    select: "combobox",
    textarea: "textbox",
    summary: "summary",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
  };

  function roleOf(el: Element): string {
    const explicit = norm(el.getAttribute("role")).split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      if (type === "submit" || type === "button" || type === "reset" || type === "image") return "button";
      return "textbox";
    }
    if (tag === "img") return "img";
    if (rootTagRole[tag]) return rootTagRole[tag];
    if ((el as HTMLElement).isContentEditable) return "textbox";
    if (el.hasAttribute("href")) return "link";
    return tag;
  }

  function isVisible(el: Element): boolean {
    const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
    if (typeof anyEl.checkVisibility === "function") {
      try {
        if (!anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      } catch {
        /* older engines */
      }
    } else {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") === 0) return false;
    }
    if (el.hasAttribute("hidden")) return false;
    return true;
  }

  function accessibleName(el: Element): { name: string; source: string | null } {
    const label = norm(el.getAttribute("aria-label"));
    if (label) return { name: clip(label, 120), source: "aria-label" };
    const labelledby = norm(el.getAttribute("aria-labelledby"));
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map((id) => {
          const target = el.ownerDocument.getElementById(id);
          return target ? norm(target.textContent) : "";
        })
        .join(" ");
      if (norm(text)) return { name: clip(norm(text), 120), source: "aria-labelledby" };
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") {
        const value = norm(el.getAttribute("value"));
        if (value) return { name: clip(value, 120), source: "value" };
      }
      if (type === "image") {
        const alt = norm(el.getAttribute("alt"));
        if (alt) return { name: clip(alt, 120), source: "alt" };
      }
      const id = el.getAttribute("id");
      if (id) {
        const labelEl = Array.from(el.ownerDocument.querySelectorAll("label[for]")).find(
          (candidate) => candidate.getAttribute("for") === id,
        );
        if (labelEl) {
          const text = norm(labelEl.textContent);
          if (text) return { name: clip(text, 120), source: "label" };
        }
      }
      const wrapping = el.closest("label");
      if (wrapping) {
        const text = norm(wrapping.textContent);
        if (text) return { name: clip(text, 120), source: "label" };
      }
      const placeholder = norm(el.getAttribute("placeholder"));
      if (placeholder) return { name: clip(placeholder, 120), source: "placeholder" };
      const title = norm(el.getAttribute("title"));
      if (title) return { name: clip(title, 120), source: "title" };
      return { name: "", source: null };
    }
    const text = norm((el as HTMLElement).innerText ?? el.textContent);
    if (text) return { name: clip(text, 120), source: "text" };
    const title = norm(el.getAttribute("title"));
    if (title) return { name: clip(title, 120), source: "title" };
    const img = el.querySelector("img[alt]");
    const alt = norm(img?.getAttribute("alt"));
    if (alt) return { name: clip(alt, 120), source: "img-alt" };
    return { name: "", source: null };
  }

  function describe(el: Element): string {
    const role = roleOf(el);
    const { name } = accessibleName(el);
    const tag = el.tagName.toLowerCase();
    const label = name ? ` "${clip(name, 40)}"` : "";
    return `<${tag} role=${role}${label}>`;
  }

  const elements: Element[] = [];
  const shadowRoots: ShadowRoot[] = [];
  const visit = (root: ParentNode): void => {
    const nodes = root.querySelectorAll("*");
    for (const el of Array.from(nodes)) {
      elements.push(el);
      if (opts.markRefs) el.removeAttribute("data-agent-eye-ref");
      const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
      if (shadow) {
        shadowRoots.push(shadow);
        visit(shadow);
      }
    }
  };
  visit(document);

  const matched: Element[] = [];
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === "html" || tag === "body") continue;
    if (!el.matches(INTERACTIVE)) continue;
    matched.push(el);
  }

  const docWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  const docHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const out: RawElement[] = [];
  const limit = Math.min(opts.maxElements, matched.length);
  for (let i = 0; i < limit; i += 1) {
    const el = matched[i] as Element;
    const tag = el.tagName.toLowerCase();
    const role = roleOf(el);
    const { name, source } = accessibleName(el);
    const box = el.getBoundingClientRect();
    const rendered = isVisible(el);
    const ariaHidden = !!el.closest('[aria-hidden="true"]');
    const zeroSize = box.width < 2 || box.height < 2;
    const clipped = rendered && zeroSize;
    const hidden = !rendered || clipped;
    const tabIndexAttr = el.getAttribute("tabindex");
    const naturallyFocusable = tag === "a" || tag === "button" || tag === "select" || tag === "textarea" || tag === "input";
    const focusable = !hidden || clipped
      ? naturallyFocusable
        ? !(el as HTMLInputElement).disabled
        : tabIndexAttr !== null && Number(tabIndexAttr) >= 0
      : false;

    const absTop = box.top + window.scrollY;
    const absLeft = box.left + window.scrollX;
    const offscreen =
      !hidden &&
      (absTop + box.height <= 0 || absLeft + box.width <= 0 || absTop >= docHeight + 1 || absLeft >= docWidth + 1);

    let occluded = false;
    let occluder: string | null = null;
    const inViewport =
      !hidden && !zeroSize && box.top < vh && box.bottom > 0 && box.left < vw && box.right > 0;
    if (inViewport) {
      const cx = Math.min(Math.max(box.left + box.width / 2, 0), vw - 1);
      const cy = Math.min(Math.max(box.top + box.height / 2, 0), vh - 1);
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit)) {
        occluded = true;
        occluder = describe(hit);
      }
    }

    const ref = `@e${i + 1}`;
    if (opts.markRefs) {
      el.setAttribute("data-agent-eye-ref", `e${i + 1}`);
    }

    out.push({
      ref,
      tag,
      role,
      name,
      nameSource: source,
      href: el.getAttribute("href"),
      type: el.getAttribute("type"),
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
      ariaHidden,
      hidden,
      zeroSize,
      clipped,
      focusable,
      offscreen,
      occluded,
      occluder,
      inForm: !!el.closest("form"),
      shadow: el.getRootNode() instanceof ShadowRoot,
      box: { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
      text: clip(norm((el as HTMLElement).innerText ?? el.textContent), 120),
    });
  }

  return {
    elements: out,
    totalInteractive: matched.length,
    truncated: matched.length > limit,
    shadowRoots: shadowRoots.length,
  };
}

/**
 * Runs inside the page. Produces a line-oriented signature of what an agent's
 * accessibility snapshot would contain: interactive descriptors plus visible
 * text. Kept deliberately cheap so it can be sampled several times a second.
 */
export function pageSignature(opts: { maxLines: number }): PageSignature {
  const norm = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim();
  const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  const INTERACTIVE = [
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='tab']",
    "[role='checkbox']",
    "[role='switch']",
    "[role='radio']",
    "[role='menuitem']",
    "[role='option']",
    "[role='combobox']",
    "[role='textbox']",
    "[role='searchbox']",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  function visible(el: Element): boolean {
    const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
    if (typeof anyEl.checkVisibility === "function") {
      try {
        return anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch {
        return true;
      }
    }
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity || "1") > 0;
  }

  function roleOf(el: Element): string {
    const explicit = norm(el.getAttribute("role")).split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    return tag;
  }

  function nameOf(el: Element): string {
    const label = norm(el.getAttribute("aria-label"));
    if (label) return label;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") {
        const value = norm(el.getAttribute("value"));
        if (value) return value;
      }
      const placeholder = norm(el.getAttribute("placeholder"));
      if (placeholder) return placeholder;
    }
    const text = norm((el as HTMLElement).innerText ?? el.textContent);
    if (text) return clip(text, 80);
    return norm(el.getAttribute("title"));
  }

  function zoneOf(el: Element): string {
    const withId = el.closest("[id]");
    const id = withId?.getAttribute("id");
    if (id) return `#${id}`;
    const live = el.closest("[aria-live]");
    if (live) return `aria-live=${live.getAttribute("aria-live") ?? "polite"}`;
    const landmark = el.closest("main,header,footer,nav,section,article,aside,dialog,form");
    return landmark ? landmark.tagName.toLowerCase() : "body";
  }

  const lines: string[] = [];
  const zones: string[] = [];
  const interactive: { ref: string; desc: string }[] = [];
  let truncated = false;

  const all: Element[] = [];
  const visit = (root: ParentNode): void => {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      all.push(el);
      const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
      if (shadow) visit(shadow);
    }
  };
  visit(document);

  const marked = (el: Element): string | null => el.getAttribute("data-agent-eye-ref");

  for (const el of all) {
    if (lines.length >= opts.maxLines) {
      truncated = true;
      break;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template" || tag === "svg") continue;
    if (!visible(el)) continue;

    if (el.matches(INTERACTIVE)) {
      const role = roleOf(el);
      const name = nameOf(el);
      const state: string[] = [];
      if ((el as HTMLButtonElement).disabled) state.push("disabled");
      if (el.getAttribute("aria-expanded")) state.push(`expanded=${el.getAttribute("aria-expanded")}`);
      if (el.getAttribute("aria-checked")) state.push(`checked=${el.getAttribute("aria-checked")}`);
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        state.push(el.checked ? "checked" : "unchecked");
      }
      const ref = marked(el);
      const desc = `${role} "${name}"${state.length ? ` ${state.join(" ")}` : ""}`;
      if (ref) interactive.push({ ref, desc });
      lines.push(`- ${desc}`);
      zones.push(zoneOf(el));
      continue;
    }

    const text = norm((el as HTMLElement).innerText ?? "");
    const hasElementChild = el.children.length > 0;
    if (text && !hasElementChild) {
      const role = /^h[1-6]$/.test(tag) ? `heading(${tag})` : tag === "img" ? "img" : "text";
      const alt = tag === "img" ? norm(el.getAttribute("alt")) : "";
      lines.push(`- ${role}: ${clip(alt || text, 100)}`);
      zones.push(zoneOf(el));
    }
  }

  return { lines, zones, interactive, truncated };
}
