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

/** What to search for when driving the booking form. */
export interface SearchPlan {
  bookingUrl: string;
  consentSelector: string;
  /** Plain port names as the dropdown spells them, e.g. "Portsmouth". */
  routeFrom: string;
  routeTo: string;
  /** Departure date as YYYY-MM-DD. */
  date: string;
  pets: number;
  /** How long to let the results settle after submitting. */
  settleMs: number;
}

/** One action in the flow, and whether it worked. */
export interface SearchStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface SearchOutcome {
  steps: SearchStep[];
  captured: CapturedResponse[];
  requests: CapturedRequest[];
  finalUrl: string;
  title: string;
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
  /** Drives the booking form through to the cabin step, recording everything. */
  search(plan: SearchPlan): Promise<SearchOutcome>;
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
  click(selector: string, options: { timeout: number; force?: boolean }): Promise<void>;
  fill(selector: string, value: string, options: { timeout: number }): Promise<void>;
  press(selector: string, key: string, options: { timeout: number }): Promise<void>;
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


const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Picks a date through a Material datepicker's calendar.
 *
 * Needed because the input is often readonly, so no amount of typing will set
 * it. Opens the calendar, steps forward month by month until the header
 * matches the target, then clicks the day cell.
 */
async function pickFromCalendar(
  page: PlaywrightPage,
  testId: string,
  isoDate: string,
): Promise<string> {
  const [year, month, day] = isoDate.split("-");
  const wanted = `${MONTHS[Number(month) - 1]} ${year}`;
  const dayNumber = String(Number(day));

  const opened = await page
    .evaluate<string>(
      `(function(){
        var input = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
        if (!input) return 'no-input';
        var field = input.closest('mat-form-field') || input.parentElement;
        var toggle = field && field.querySelector('mat-datepicker-toggle button, button[aria-label*="calendar" i]');
        if (!toggle) return 'no-toggle';
        toggle.setAttribute('data-fw-cal','1');
        return 'ok';
      })()`,
    )
    .catch((error) => `error:${String(error).slice(0, 80)}`);
  if (opened !== "ok") return `toggle:${opened}`;

  await page.click('[data-fw-cal="1"]', { timeout: 8000 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 900));

  // Step forward a bounded number of months rather than looping forever.
  for (let hop = 0; hop < 18; hop += 1) {
    const label = await page
      .evaluate<string>(
        `(function(){
          var b = document.querySelector('.mat-calendar-period-button, [class*="period-button"]');
          return b ? (b.textContent||'').trim() : '';
        })()`,
      )
      .catch(() => "");
    if (!label) return "no-calendar";
    if (label.toUpperCase().includes(wanted.toUpperCase())) break;

    const advanced = await page
      .evaluate<string>(
        `(function(){
          var n = document.querySelector('.mat-calendar-next-button, button[aria-label*="Next month" i]');
          if (!n || n.disabled) return 'no-next';
          n.setAttribute('data-fw-next','1');
          return 'ok';
        })()`,
      )
      .catch(() => "err");
    if (advanced !== "ok") return `next:${advanced} at ${label}`;
    await page.click('[data-fw-next="1"]', { timeout: 5000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
  }

  const clicked = await page
    .evaluate<string>(
      `(function(){
        var cells = Array.from(document.querySelectorAll('.mat-calendar-body-cell, [role="gridcell"]'));
        var hit = cells.filter(function(c){
          return (c.textContent||'').trim() === ${JSON.stringify(dayNumber)} &&
                 !c.classList.contains('mat-calendar-body-disabled');
        })[0];
        if (!hit) return 'day-not-found|of ' + cells.length;
        hit.setAttribute('data-fw-day','1');
        return 'ok';
      })()`,
    )
    .catch((error) => `error:${String(error).slice(0, 80)}`);
  if (clicked !== "ok") return clicked;

  await page.click('[data-fw-day="1"]', { timeout: 5000 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 700));
  return `picked ${wanted} ${dayNumber}`;
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

    async search(plan) {
      const page = await context.newPage();
      const captured: CapturedResponse[] = [];
      const requests: CapturedRequest[] = [];
      const pending: Promise<void>[] = [];
      const steps: SearchStep[] = [];
      const note = (step: string, ok: boolean, detail: string) => {
        steps.push({ step, ok, detail });
      };

      page.on("request", (request) => {
        const url = request.url();
        if (!/\/api\/|graphql|avail|crossing|sailing/i.test(url)) return;
        requests.push({ url, method: request.method(), headers: request.headers() });
      });

      page.on("response", (response) => {
        if (!response.ok()) return;
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

      const countOptions = async (): Promise<number> => {
        const raw = await page.evaluate<string>(
          `String(document.querySelectorAll('.cdk-overlay-container mat-option').length)`,
        );
        return Number(raw) || 0;
      };

      const closeOverlay = async (): Promise<void> => {
        for (let i = 0; i < 5 && (await countOptions()) > 0; i += 1) {
          await page.keyboard.press("Escape").catch(() => undefined);
          await new Promise((r) => setTimeout(r, 350));
        }
      };

      /**
       * Opens a dropdown found by its form-field label, and clicks the option
       * containing every needle.
       *
       * Selection is by label rather than by mat-select id because choosing
       * "One way" re-renders the form and renumbers every id — an ordinal
       * selector silently points at the wrong control after that, whereas the
       * label keeps meaning the same thing.
       */
      const pickOption = async (
        labelPattern: string,
        needles: string[],
        label: string,
      ): Promise<boolean> => {
        await closeOverlay();

        // Resolve which select this is by its label, but do not click it from
        // inside the page: a synthetic click opens the panel without Angular
        // populating its options, which reads as an empty dropdown. Only a
        // real input event makes the options render.
        const found = await page
          .evaluate<string>(
            `(function(){
              var sels = Array.from(document.querySelectorAll('mat-select'));
              var hit = sels.filter(function(s){
                var f = s.closest('mat-form-field');
                return f && /${labelPattern}/i.test(f.textContent||'');
              })[0];
              if (!hit) return 'no-select-matching-label|' + sels.map(function(s){
                var f = s.closest('mat-form-field');
                return f ? (f.textContent||'').trim().slice(0,28) : '?';
              }).join(' ; ');
              hit.scrollIntoView({block:'center'});
              // Ids are regenerated as the form re-renders, so a lookup here
              // and a click a moment later can disagree. Tag the element and
              // click the tag, which cannot churn.
              hit.setAttribute('data-fw', ${JSON.stringify(labelPattern.slice(0, 12))});
              return 'id|' + (hit.id||'tagged');
            })()`,
          )
          .catch((e) => `error|${e}`);

        if (!found.startsWith("id|") || found === "id|") {
          note(label, false, found);
          return false;
        }
        const selectId = found.slice(3);
        const target = `[data-fw=${JSON.stringify(labelPattern.slice(0, 12))}]`;

        let clickNote = "";
        const tryClick = async (opts: { timeout: number; force?: boolean }) => {
          try {
            await page.click(target, opts);
            return "ok";
          } catch (error) {
            return `threw:${String(error).slice(0, 120)}`;
          }
        };

        clickNote = await tryClick({ timeout: 8000 });
        await new Promise((r) => setTimeout(r, 1200));

        // A re-render can leave the panel empty for a moment, and an element
        // Playwright judges unactionable needs forcing rather than retrying.
        if ((await countOptions()) === 0) {
          clickNote += ` | retry:${await tryClick({ timeout: 6000 })}`;
          await new Promise((r) => setTimeout(r, 1200));
        }
        if ((await countOptions()) === 0) {
          clickNote += ` | forced:${await tryClick({ timeout: 6000, force: true })}`;
          await new Promise((r) => setTimeout(r, 1200));
        }
        const opened = `${selectId} click=${clickNote}`;

        // The arrow icon is a text ligature inside the option, so strip it
        // before matching or "Portsmouth -> Santander" never matches.
        const result = await page
          .evaluate<string>(
            `(function(){
              var opts = Array.from(document.querySelectorAll('.cdk-overlay-container mat-option'));
              if (opts.length === 0) return 'no-options';
              var needles = ${JSON.stringify(needles.map((n) => n.toLowerCase()))};
              var hit = opts.filter(function(o){
                var t = (o.textContent||'').toLowerCase().replace(/arrow_right_alt/g,' ');
                return needles.every(function(n){ return t.indexOf(n) !== -1; });
              })[0];
              if (!hit) return 'not-found|of ' + opts.length + '|' + opts.slice(0,8).map(function(o){
                return (o.textContent||'').trim().slice(0,32);
              }).join(' ; ');
              hit.click();
              return 'clicked|' + (hit.textContent||'').trim().slice(0,60);
            })()`,
          )
          .catch((e) => `error|${e}`);

        await new Promise((r) => setTimeout(r, 800));
        const ok = result.startsWith("clicked");
        note(label, ok, `${opened} -> ${result}`);
        await closeOverlay();
        return ok;
      };

      await page.goto(plan.bookingUrl, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      note("goto", true, plan.bookingUrl);

      for (const candidate of [plan.consentSelector, "#onetrust-accept-btn-handler"]) {
        if (!candidate) continue;
        const clicked = await page
          .click(candidate, { timeout: 6000 })
          .then(() => true)
          .catch(() => false);
        if (clicked) {
          note("consent", true, candidate);
          break;
        }
        note("consent", false, `no match: ${candidate}`);
      }
      await new Promise((r) => setTimeout(r, 1200));

      // Report the trip-type radios rather than assuming which is one-way.
      const radios = await page
        .evaluate<string>(
          `JSON.stringify(Array.from(document.querySelectorAll('mat-radio-button')).map(function(el){return (el.textContent||'').trim().slice(0,30);}))`,
        )
        .catch(() => "[]");
      note("radio-labels", true, radios);

      // Deliberately NOT selecting "One way". Doing so removes the inbound
      // date field, and every dropdown opened after that re-render renders
      // zero options — reproduced across three runs, with the clicks
      // themselves reported as succeeding. The default return trip leaves the
      // form in the state where the dropdowns demonstrably work, and an
      // outbound pet cabin is listed either way.
      note("trip-type", true, "left as default (return) — one-way breaks the dropdowns");

      await pickOption("outbound route|route", [plan.routeFrom, plan.routeTo], "route");

      // The date format the field accepts is unknown, so try the plausible
      // ones and keep whichever the control actually retains.
      const [y, m, d] = plan.date.split("-");
      const formats = [`${d}/${m}/${y}`, plan.date, `${d}-${m}-${y}`, `${d}.${m}.${y}`];
      const readonly = await page
        .evaluate<string>(
          `(function(){
            var e = document.querySelector('[data-testid="outwardDate"]');
            if (!e) return 'missing';
            return 'readonly=' + e.hasAttribute('readonly') + ' disabled=' + e.disabled;
          })()`,
        )
        .catch(() => "unknown");
      note("date-field", true, readonly);

      let dateSet = "none";
      let fillError = "";
      for (const value of formats) {
        await page.click('[data-testid="outwardDate"]', { timeout: 6000 }).catch(() => undefined);
        try {
          await page.fill('[data-testid="outwardDate"]', value, { timeout: 6000 });
        } catch (error) {
          fillError = String(error).slice(0, 140);
        }
        // A Material datepicker keeps the typed text only once it is committed,
        // so blur the field before reading the value back.
        await page
          .press('[data-testid="outwardDate"]', "Tab", { timeout: 4000 })
          .catch(() => undefined);
        await new Promise((r) => setTimeout(r, 700));
        const got = await page
          .evaluate<string>(
            `(document.querySelector('[data-testid="outwardDate"]')||{}).value || ''`,
          )
          .catch(() => "");
        if (got.trim().length > 0) {
          dateSet = `${value} -> field shows "${got}"`;
          break;
        }
      }
      // A readonly Material datepicker cannot be typed into at all — the only
      // way in is the calendar it insists you use.
      if (dateSet === "none") {
        const picked = await pickFromCalendar(page, "outwardDate", plan.date);
        note("date-calendar", picked.startsWith("picked"), picked);
        const got = await page
          .evaluate<string>(
            `(document.querySelector('[data-testid="outwardDate"]')||{}).value || ''`,
          )
          .catch(() => "");
        if (got.trim().length > 0) dateSet = `calendar -> "${got}"`;
      }

      if (dateSet === "none") {
        const inputs = await page
          .evaluate<string>(
            `JSON.stringify(Array.from(document.querySelectorAll('input')).filter(function(i){
              return i.offsetParent !== null;
            }).map(function(i){
              return (i.getAttribute('data-testid')||i.id||'?') + ':' + (i.getAttribute('placeholder')||'');
            }))`,
          )
          .catch(() => "[]");
        note(
          "date",
          false,
          `no format accepted (${readonly}); fill error: ${fillError || "none"}; inputs: ${inputs}`,
        );
      } else {
        note("date", true, dateSet);
      }

      // A return trip requires an inbound date before it will search.
      const inbound = new Date(`${plan.date}T00:00:00Z`);
      inbound.setUTCDate(inbound.getUTCDate() + 7);
      const [iy, im, id] = inbound.toISOString().slice(0, 10).split("-");
      let inboundSet = "none";
      for (const value of [`${id}/${im}/${iy}`, `${iy}-${im}-${id}`]) {
        await page.click('[data-testid="inwardDate"]', { timeout: 6000 }).catch(() => undefined);
        await page
          .fill('[data-testid="inwardDate"]', value, { timeout: 6000 })
          .catch(() => undefined);
        await page
          .press('[data-testid="inwardDate"]', "Tab", { timeout: 4000 })
          .catch(() => undefined);
        await new Promise((r) => setTimeout(r, 700));
        const got = await page
          .evaluate<string>(
            `(document.querySelector('[data-testid="inwardDate"]')||{}).value || ''`,
          )
          .catch(() => "");
        if (got.trim().length > 0) {
          inboundSet = `${value} -> "${got}"`;
          break;
        }
      }
      if (inboundSet === "none") {
        const iso = inbound.toISOString().slice(0, 10);
        const picked = await pickFromCalendar(page, "inwardDate", iso);
        const got = await page
          .evaluate<string>(
            `(document.querySelector('[data-testid="inwardDate"]')||{}).value || ''`,
          )
          .catch(() => "");
        if (got.trim().length > 0) inboundSet = `calendar -> "${got}"`;
        else inboundSet = `none (${picked})`;
      }
      note("inbound-date", !inboundSet.startsWith("none"), inboundSet);

      await pickOption("pet", ["pet"], "pets");

      const submitted = await page
        .click('[data-testid="submit"]', { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      note("submit", submitted, submitted ? "clicked Search sailings" : "submit not clickable");

      await page
        .waitForLoadState("networkidle", { timeout: options.timeoutMs })
        .catch(() => undefined);
      await new Promise((r) => setTimeout(r, plan.settleMs));

      // Step 3 is where cabins, and therefore pet cabins, are listed.
      const toCabins = await page
        .click('[data-testid="bf-stepper-header-cell-2"]', { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      note("cabins-step", toCabins, toCabins ? "clicked CABINS & SEATS" : "step not reachable");
      await new Promise((r) => setTimeout(r, plan.settleMs));

      await Promise.all(pending);
      const title = await page.title().catch(() => "");

      // What the page actually shows at the end explains a dead end far
      // faster than the absence of a network call does.
      const visible = await page
        .evaluate<string>(
          `(document.body ? document.body.innerText : '').replace(/\\s+/g,' ').slice(0, 1200)`,
        )
        .catch(() => "");
      note("page-text", visible.length > 0, visible || "(no text)");

      return { steps, captured, requests, finalUrl: page.url(), title };
    },

    async pause(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },

    async close() {
      await browser.close();
    },
  };
}
