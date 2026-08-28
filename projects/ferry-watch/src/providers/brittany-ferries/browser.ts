/**
 * Thin wrapper over Playwright. Playwright is an optional dependency so that
 * installing and unit-testing ferry-watch stays fast; it is only required when
 * a real operator is actually polled.
 */

export interface CapturedResponse {
  url: string;
  body: unknown;
}

export interface BrowserOptions {
  headless: boolean;
  timeoutMs: number;
  /** JSON responses whose URL matches this regex source are captured. */
  responseUrlPattern: string;
}

export interface VisitOptions {
  consentSelector: string;
  readySelector: string;
}

export interface BrowserSession {
  visit(url: string, options: VisitOptions): Promise<CapturedResponse[]>;
  pause(ms: number): Promise<void>;
  close(): Promise<void>;
}

/** Minimal structural types, so Playwright is not needed at compile time. */
interface PlaywrightResponse {
  url(): string;
  ok(): boolean;
  headers(): Record<string, string>;
  json(): Promise<unknown>;
}

interface PlaywrightPage {
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  on(event: "response", handler: (response: PlaywrightResponse) => void): void;
  waitForLoadState(state: string, options: { timeout: number }): Promise<void>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  click(selector: string, options: { timeout: number }): Promise<void>;
  content(): Promise<string>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
}

interface PlaywrightBrowser {
  newContext(options: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function importPlaywright(): Promise<{
  chromium: { launch(options: Record<string, unknown>): Promise<PlaywrightBrowser> };
}> {
  try {
    return (await import("playwright")) as unknown as {
      chromium: { launch(options: Record<string, unknown>): Promise<PlaywrightBrowser> };
    };
  } catch {
    throw new Error(
      "Playwright is required to poll a live operator but is not installed. Run:\n" +
        "  pnpm add playwright && pnpm exec playwright install chromium",
    );
  }
}

export async function launchBrowser(
  options: BrowserOptions,
): Promise<BrowserSession> {
  const { chromium } = await importPlaywright();
  const pattern = new RegExp(options.responseUrlPattern, "i");
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-GB",
  });

  return {
    async visit(url, visitOptions) {
      const page = await context.newPage();
      const captured: CapturedResponse[] = [];
      const pending: Promise<void>[] = [];

      page.on("response", (response) => {
        if (!response.ok()) return;
        if (!pattern.test(response.url())) return;
        const type = response.headers()["content-type"] ?? "";
        if (!type.includes("json")) return;
        pending.push(
          response
            .json()
            .then((body) => {
              captured.push({ url: response.url(), body });
            })
            .catch(() => undefined),
        );
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

      if (visitOptions.consentSelector) {
        await page
          .click(visitOptions.consentSelector, { timeout: 5000 })
          .catch(() => undefined);
      }
      if (visitOptions.readySelector) {
        await page
          .waitForSelector(visitOptions.readySelector, { timeout: options.timeoutMs })
          .catch(() => undefined);
      }

      await page
        .waitForLoadState("networkidle", { timeout: options.timeoutMs })
        .catch(() => undefined);
      await Promise.all(pending);

      return captured;
    },

    async pause(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },

    async close() {
      await browser.close();
    },
  };
}
