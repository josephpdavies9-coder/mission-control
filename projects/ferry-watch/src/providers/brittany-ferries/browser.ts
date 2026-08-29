/**
 * Thin wrapper over Playwright. Playwright is an optional dependency so that
 * installing and unit-testing ferry-watch stays fast; it is only required when
 * a real operator is actually polled.
 */

export interface CapturedResponse {
  url: string;
  body: unknown;
}

/** An outgoing request, so the call the app makes can be replayed. */
export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** A dropdown and the options it offers, for working out what to pick. */
export interface SelectInfo {
  id: string;
  testId: string;
  label: string;
  options: string[];
}

/** One interactive control on a page, for working out how to drive a form. */
export interface ControlInfo {
  tag: string;
  type: string;
  id: string;
  name: string;
  placeholder: string;
  ariaLabel: string;
  testId: string;
  text: string;
  visible: boolean;
}

export interface BrowserOptions {
  headless: boolean;
  timeoutMs: number;
  /** JSON responses whose URL matches this regex source are captured. */
  responseUrlPattern: string;
  /** Explicit Chromium binary, when the bundled one is not the right build. */
  executablePath?: string | null;
}

export interface VisitOptions {
  consentSelector: string;
  readySelector: string;
}

/** Everything observed while the user drove the site by hand. */
export interface RecordResult {
  captured: CapturedResponse[];
  /** Requests to anything API-shaped, with headers. */
  requests: CapturedRequest[];
  /** HTML page URLs navigated through, in order — the search URL is among these. */
  pageUrls: string[];
  /** Where the browser ended up when recording stopped. */
  finalUrl: string;
  /** Page title — reveals bot walls ("Just a moment...") at a glance. */
  title: string;
  /** Size of the final page's HTML, as a crude "did we get a real page" signal. */
  htmlLength: number;
}

export interface BrowserSession {
  visit(url: string, options: VisitOptions): Promise<CapturedResponse[]>;
  /**
   * Opens a page and records every JSON response and page navigation until
   * `stop` resolves, so a human can click the booking flow themselves.
   */
  record(startUrl: string, stop: () => Promise<void>): Promise<RecordResult>;
  /** Lists the interactive controls on a page, to work out how to drive it. */
  inspect(url: string, consentSelector: string): Promise<ControlInfo[]>;
  /** Opens each dropdown in turn and reports the options it offers. */
  enumerateSelects(url: string, consentSelector: string): Promise<SelectInfo[]>;
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

interface PlaywrightRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
}

interface PlaywrightPage {
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  on(event: "response", handler: (response: PlaywrightResponse) => void): void;
  on(event: "request", handler: (request: PlaywrightRequest) => void): void;
  evaluate<T>(fn: string): Promise<T>;
  waitForLoadState(state: string, options: { timeout: number }): Promise<void>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  click(selector: string, options: { timeout: number }): Promise<void>;
  content(): Promise<string>;
  url(): string;
  title(): Promise<string>;
  keyboard: { press(key: string): Promise<void> };
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
  const browser = await chromium.launch({
    headless: options.headless,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
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

    async record(startUrl, stop) {
      const page = await context.newPage();
      const captured: CapturedResponse[] = [];
      const requests: CapturedRequest[] = [];
      const pageUrls: string[] = [];
      const pending: Promise<void>[] = [];

      // The headers on the app's own availability call are the thing a bare
      // curl is missing, so record them.
      page.on("request", (request) => {
        const url = request.url();
        if (!/\/api\/|graphql|avail|crossing|sailing/i.test(url)) return;
        requests.push({
          url,
          method: request.method(),
          headers: request.headers(),
        });
      });

      page.on("response", (response) => {
        if (!response.ok()) return;
        const type = response.headers()["content-type"] ?? "";

        // Page loads tell us the shape of the real search URL.
        if (type.includes("text/html")) {
          const url = response.url();
          if (pageUrls[pageUrls.length - 1] !== url) pageUrls.push(url);
          return;
        }

        // Recording captures every JSON response, not just the usual pattern —
        // the whole point is to discover which endpoint carries availability.
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

      await page.goto(startUrl, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });

      await stop();
      await Promise.all(pending);

      const title = await page.title().catch(() => "");
      const html = await page.content().catch(() => "");

      return {
        captured,
        requests,
        pageUrls,
        finalUrl: page.url(),
        title,
        htmlLength: html.length,
      };
    },

    async inspect(url, consentSelector) {
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      if (consentSelector) {
        await page.click(consentSelector, { timeout: 8000 }).catch(() => undefined);
      }
      await page
        .waitForLoadState("networkidle", { timeout: options.timeoutMs })
        .catch(() => undefined);

      // Serialised as a string so no bundler transform is needed, and read
      // back as JSON rather than trusting structured cloning of DOM nodes.
      const json = await page.evaluate<string>(`
        JSON.stringify(
          Array.from(
            document.querySelectorAll('input, select, button, [role="button"], [role="combobox"], a[href*="book"]')
          ).map(function (el) {
            var r = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute('type') || '',
              id: el.id || '',
              name: el.getAttribute('name') || '',
              placeholder: el.getAttribute('placeholder') || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
              text: (el.textContent || '').trim().slice(0, 60),
              visible: r.width > 0 && r.height > 0
            };
          })
        )
      `);

      try {
        return JSON.parse(json) as ControlInfo[];
      } catch {
        return [];
      }
    },

    async enumerateSelects(url, consentSelector) {
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });

      // A consent banner that is still up swallows every subsequent click, so
      // report whether it was actually dismissed rather than assuming.
      let consent = "not attempted";
      const consentCandidates = [
        consentSelector,
        "#onetrust-accept-btn-handler",
        "button#onetrust-accept-btn-handler",
        '[aria-label="Accept all"]',
        'button:has-text("Accept")',
      ].filter(Boolean);

      for (const candidate of consentCandidates) {
        const clicked = await page
          .click(candidate, { timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        if (clicked) {
          consent = `clicked ${candidate}`;
          break;
        }
        consent = "no consent button matched";
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await page
        .waitForLoadState("networkidle", { timeout: options.timeoutMs })
        .catch(() => undefined);

      const idsJson = await page.evaluate<string>(`
        JSON.stringify(
          Array.from(document.querySelectorAll('mat-select')).map(function (el) {
            var field = el.closest('mat-form-field');
            return {
              id: el.id || '',
              testId: el.getAttribute('data-testid') || '',
              label: field ? (field.textContent || '').trim().slice(0, 60) : ''
            };
          })
        )
      `);

      let selects: { id: string; testId: string; label: string }[] = [];
      try {
        selects = JSON.parse(idsJson);
      } catch {
        return [];
      }

      const readOptions = async (): Promise<string[]> => {
        const json = await page.evaluate<string>(`
          JSON.stringify(
            Array.from(document.querySelectorAll('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"]'))
              .map(function (el) { return (el.textContent || '').trim().slice(0, 70); })
          )
        `);
        try {
          return JSON.parse(json) as string[];
        } catch {
          return [];
        }
      };

      const countOptions = async (): Promise<number> => {
        const raw = await page.evaluate<string>(
          `String(document.querySelectorAll('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"]').length)`,
        );
        return Number(raw) || 0;
      };

      /**
       * Closes any open dropdown and waits for its options to actually leave
       * the DOM. Without this the next dropdown reads the previous one's
       * options — every select then looks identical, which is exactly the
       * false result this replaces.
       */
      const closeOverlay = async (): Promise<boolean> => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          if ((await countOptions()) === 0) return true;
          await page.keyboard.press("Escape").catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 400));
          if ((await countOptions()) === 0) return true;
          await page
            .click(".cdk-overlay-backdrop", { timeout: 2000 })
            .catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        return (await countOptions()) === 0;
      };

      const results: SelectInfo[] = [
        { id: "(consent)", testId: "", label: consent, options: [] },
      ];

      for (const select of selects) {
        if (!select.id) continue;

        // Refuse to report anything unless we start from a clean overlay,
        // otherwise the result is the previous dropdown's options.
        if (!(await closeOverlay())) {
          results.push({
            ...select,
            label: `${select.label}  [SKIPPED: previous overlay would not close]`,
            options: [],
          });
          continue;
        }

        // Angular Material puts the click target on an inner trigger, and a
        // real click can still be intercepted, so escalate through three ways
        // of opening the same dropdown and report which one worked.
        const attempts: [string, () => Promise<unknown>][] = [
          ["host", () => page.click(`#${select.id}`, { timeout: 6000 })],
          [
            "trigger",
            () =>
              page.click(`#${select.id} .mat-mdc-select-trigger`, { timeout: 6000 }),
          ],
          [
            "dispatch",
            () =>
              page.evaluate<string>(
                `(function(){var e=document.querySelector('#${select.id}');if(!e)return 'missing';e.scrollIntoView();e.click();return 'ok';})()`,
              ),
          ],
        ];

        let optionTexts: string[] = [];
        let how = "none";
        for (const [name, run] of attempts) {
          await run().catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 900));
          optionTexts = await readOptions();
          if (optionTexts.length > 0) {
            how = name;
            break;
          }
        }

        results.push({
          ...select,
          label: `${select.label}  [opened via: ${how}]`,
          options: optionTexts,
        });

        await closeOverlay();
      }

      return results;
    },

    async pause(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },

    async close() {
      await browser.close();
    },
  };
}
