import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface LaunchOptions {
  headless?: boolean;
  executablePath?: string;
  viewport?: { width: number; height: number };
  storageState?: string;
  timeoutMs?: number;
  locale?: string;
}

export interface Counters {
  requests: number;
  failedRequests: number;
  consoleErrors: number;
  pageErrors: number;
  dialogs: number;
}

/** Counts the signals an action can leave behind, without changing the page. */
export class PageMonitor {
  private counters: Counters = { requests: 0, failedRequests: 0, consoleErrors: 0, pageErrors: 0, dialogs: 0 };

  constructor(page: Page) {
    page.on("request", () => {
      this.counters.requests += 1;
    });
    page.on("requestfailed", () => {
      this.counters.failedRequests += 1;
    });
    page.on("console", (message) => {
      if (message.type() === "error") this.counters.consoleErrors += 1;
    });
    page.on("pageerror", () => {
      this.counters.pageErrors += 1;
    });
    page.on("dialog", (dialog) => {
      this.counters.dialogs += 1;
      void dialog.dismiss().catch(() => undefined);
    });
  }

  snapshot(): Counters {
    return { ...this.counters };
  }

  diff(since: Counters): Counters {
    return {
      requests: this.counters.requests - since.requests,
      failedRequests: this.counters.failedRequests - since.failedRequests,
      consoleErrors: this.counters.consoleErrors - since.consoleErrors,
      pageErrors: this.counters.pageErrors - since.pageErrors,
      dialogs: this.counters.dialogs - since.dialogs,
    };
  }
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  monitor: PageMonitor;
  close: () => Promise<void>;
}

export function resolveExecutablePath(explicit?: string): string | undefined {
  const fromEnv = process.env.AGENT_EYE_CHROMIUM;
  return explicit || fromEnv || undefined;
}

export async function openSession(options: LaunchOptions = {}): Promise<BrowserSession> {
  const executablePath = resolveExecutablePath(options.executablePath);
  const browser = await chromium.launch({
    headless: options.headless ?? true,
    executablePath,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  try {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    storageState: options.storageState,
    locale: options.locale ?? "en-US",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs ?? 20_000);
  page.setDefaultNavigationTimeout(options.timeoutMs ?? 30_000);
  const monitor = new PageMonitor(page);
  return {
    browser,
    context,
    page,
    monitor,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
  } catch (error) { await browser.close().catch(() => undefined); throw error; }
}

/** Wait until the page looks settled: load, quiet network for a moment, small pause. */
export async function settle(page: Page, timeoutMs = 3_000): Promise<void> {
  await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForTimeout(250);
}
