import type { Page } from "playwright";
import { extractPageElements, pageSignature } from "../extract.js";
import type { PageMonitor } from "../browser.js";
import { settle } from "../browser.js";
import type { ActionTruthReport, ActionVerdict, ExtractResult, PageSignature, ProbedControl, RawElement } from "../types.js";
import { diffLines, filterStable, round, toVolatileFilter } from "./delta.js";
import type { SnapshotStep } from "./delta.js";

export interface ProbeResult {
  report: ActionTruthReport;
  snapshots: SnapshotStep[];
}

export interface ProbeOptions {
  maxProbes: number;
  settleMs: number;
  /** Lines and regions that change on their own; excluded so idle churn cannot look like a click effect. */
  volatileLines?: string[];
  volatileZones?: string[];
  maxElements?: number;
}

const ALLOWED_ROLES = new Set(["button", "tab", "checkbox", "switch", "radio", "summary", "menuitem", "menuitemcheckbox", "menuitemradio"]);

/**
 * Labels that commit money, remove data, or end a session. agent-eye never
 * clicks these; they are counted as skipped and left to a human.
 */
const DESTRUCTIVE = new RegExp(
  [
    "delete|remove|discard|destroy|trash|clear all|reset|drop",
    "pay|buy|purchase|checkout|order now|place order|subscribe|donate|withdraw|transfer",
    "submit|send|publish|post|share|report|block|ban|deactivate|unsubscribe",
    "log ?out|sign ?out|log ?off|sign ?off|close account|leave",
    "cancel|confirm|apply now|book|reserve|schedule|approve|decline|refund|retry payment",
    "삭제|제거|초기화|결제|구매|주문|송금|이체|후원|구독|해지|탈퇴|신고|차단",
    "보내기|전송|제출|게시|공유|로그아웃|로그아웃|예약|취소|확인|승인|거절|환불",
  ].join("|"),
  "i",
);

export function isDestructiveName(name: string): boolean {
  return DESTRUCTIVE.test(name);
}

/** The allowlist: only non-destructive, in-page toggles and buttons. */
export function isSafeProbeTarget(el: RawElement): boolean {
  if (el.hidden || el.clipped || el.disabled) return false;
  if (!el.name) return false;
  if (!ALLOWED_ROLES.has(el.role)) return false;
  if (el.tag === "a" || el.href) return false;
  if (el.inForm) return false;
  if (el.type === "submit" || el.type === "image" || el.type === "reset") return false;
  if (el.role === "button" && el.nameSource === "value") return false;
  return !isDestructiveName(el.name);
}

function keyOf(el: RawElement): string {
  return `${el.role}|${el.name}|${el.tag}`;
}

function classifyClickError(message: string | null): { verdict: ActionVerdict; reason?: string } | null {
  if (!message) return null;
  const blocked =
    /intercepts pointer events/i.test(message)
      ? "another element receives the click at that point"
      : /outside of the viewport/i.test(message)
        ? "the control is outside the viewport"
        : /not visible/i.test(message)
          ? "the control is not visible"
          : /not stable/i.test(message)
            ? "the control never stopped moving"
            : /not attached|detached/i.test(message)
              ? "the control detached during the click"
              : /Timeout \d+ms exceeded|waiting for locator/i.test(message)
                ? "no clickable point within the timeout"
                : null;
  if (blocked) return { verdict: "blocked", reason: blocked };
  return { verdict: "error" };
}

async function captureSignature(page: Page): Promise<PageSignature> {
  return (await page.evaluate(pageSignature, { maxLines: 600 })) as PageSignature;
}

export async function measureActionTruth(page: Page, monitor: PageMonitor, options: ProbeOptions): Promise<ProbeResult> {
  const maxElements = options.maxElements ?? 400;
  const controls: ProbedControl[] = [];
  const probed = new Set<string>();
  let effective = 0;
  let noEffect = 0;
  let blocked = 0;
  let errored = 0;
  let skipped = 0;
  const baseUrl = page.url();
  const volatile = toVolatileFilter(options);
  const stable = (signature: PageSignature): string[] => filterStable(signature.lines, signature.zones, volatile);
  const snapshots: SnapshotStep[] = [];
  const initial = await captureSignature(page).catch(() => null);
  if (initial) snapshots.push({ label: "initial", lines: initial.lines });

  page.on("popup", (popup) => {
    void popup.close().catch(() => undefined);
  });

  for (let i = 0; i < options.maxProbes; i += 1) {
    const extracted = (await page.evaluate(extractPageElements, { maxElements, markRefs: true })) as ExtractResult;
    if (i === 0) skipped = extracted.elements.filter((el) => !isSafeProbeTarget(el)).length;
    const candidate = extracted.elements.find((el) => isSafeProbeTarget(el) && !probed.has(keyOf(el)));
    if (!candidate) break;
    probed.add(keyOf(candidate));

    const refId = candidate.ref.replace("@", "");
    const beforeSignature = await captureSignature(page);
    const beforeUrl = page.url();
    const beforeCounters = monitor.snapshot();

    let clickError: string | null = null;
    try {
      const locator = page.locator(`[data-agent-eye-ref="${refId}"]`).first();
      await locator.click({ timeout: 2_500 });
    } catch (error) {
      clickError = (error as Error).message || "unknown click error";
    }

    await page.waitForTimeout(options.settleMs);
    const afterUrl = page.url();
    let afterSignature: PageSignature = { lines: [], zones: [], interactive: [], truncated: false };
    try {
      afterSignature = await captureSignature(page);
    } catch {
      /* page may be mid-navigation */
    }
    const counters = monitor.diff(beforeCounters);
    const diff = diffLines(stable(beforeSignature), stable(afterSignature));
    const urlChanged = beforeUrl !== afterUrl;

    let verdict: ActionVerdict;
    const errorVerdict = classifyClickError(clickError);
    const failureReason = errorVerdict?.reason;
    if (errorVerdict) {
      verdict = errorVerdict.verdict;
    } else if (urlChanged || diff.changed > 0) {
      // A click that changed anything in the stable part of the snapshot worked.
      // Network-only activity is reported but not used: a page can poll on its own.
      verdict = "effective";
    } else {
      verdict = "no-effect";
    }

    if (verdict === "effective") effective += 1;
    else if (verdict === "no-effect") noEffect += 1;
    else if (verdict === "blocked") blocked += 1;
    else errored += 1;

    controls.push({
      ref: candidate.ref,
      role: candidate.role,
      name: candidate.name,
      verdict,
      urlChanged,
      linesChanged: diff.added + diff.removed,
      networkRequests: counters.requests,
      consoleErrors: counters.consoleErrors + counters.pageErrors,
      navigatedAway: urlChanged,
      ...(clickError ? { error: failureReason ?? clickError.split("\n")[0] } : {}),
    });

    if (afterSignature.lines.length > 0) {
      snapshots.push({ label: `${candidate.role} "${candidate.name}"`, lines: afterSignature.lines });
    }

    if (urlChanged && afterUrl !== baseUrl) {
      await page.goto(baseUrl, { waitUntil: "load" }).catch(() => undefined);
      await settle(page);
    }
  }

  const attempted = controls.length;
  return {
    report: {
      attempted,
      effective,
      noEffect,
      blocked,
      errored,
      skipped,
      falseSuccessPct: attempted > 0 ? round((noEffect / attempted) * 100, 1) : null,
      controls,
      volatileLines: volatile.lines.size,
    },
    snapshots,
  };
}
