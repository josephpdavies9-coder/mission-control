import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Watch } from "../../config.js";
import type { Config } from "../../config.js";
import { extractSailings } from "./parse.js";
import { buildUrl, resolveSelectors } from "./selectors.js";
import { createInterface } from "node:readline/promises";
import { launchBrowser, type RecordResult } from "./browser.js";
import { suggestSearchUrl } from "./suggest.js";

/**
 * Records what the booking site actually does for one search, so the selector
 * pack can be corrected without guesswork.
 *
 * This exists because the site is undocumented and moves: rather than shipping
 * brittle selectors and hoping, calibration captures every JSON endpoint the
 * page calls, reports which ones contained parseable pet availability, and
 * writes the payloads to disk for inspection.
 */
export async function calibrate(
  config: Config,
  watch: Watch,
  outputDir: string,
): Promise<void> {
  const selectors = resolveSelectors(config.browser.selectors);
  const url = buildUrl(selectors.searchUrl, {
    from: watch.routeFrom,
    to: watch.routeTo,
    date: watch.dateFrom,
    passengers: watch.passengers,
    pets: watch.pets,
    vehicle: watch.vehicle,
  });

  console.log(`Calibrating against: ${url}`);
  console.log(
    config.browser.headless
      ? "Running headless. Tip: set browser.headless=false to watch the flow.\n"
      : "Running headed — complete any interaction the page needs, then wait.\n",
  );

  // Capture everything during calibration, not just the usual pattern.
  const session = await launchBrowser({
    headless: config.browser.headless,
    timeoutMs: config.browser.timeoutSeconds * 1000,
    responseUrlPattern: ".",
    executablePath: config.browser.executablePath,
  });

  try {
    const captured = await session.visit(url, {
      consentSelector: selectors.consentSelector,
      readySelector: selectors.readySelector,
    });

    const dir = resolve(outputDir);
    await mkdir(dir, { recursive: true });

    console.log(`Captured ${captured.length} JSON response(s).\n`);
    const useful: string[] = [];

    for (const [index, response] of captured.entries()) {
      const sailings = extractSailings(response.body, {
        routeFrom: watch.routeFrom,
        routeTo: watch.routeTo,
        bookingUrl: url,
      });
      const marker = sailings.length > 0 ? "HIT " : "    ";
      console.log(`${marker}[${index}] ${sailings.length} sailing(s)  ${response.url}`);
      if (sailings.length > 0) useful.push(response.url);

      const file = resolve(dir, `response-${String(index).padStart(3, "0")}.json`);
      await writeFile(
        file,
        `${JSON.stringify({ url: response.url, sailings, body: response.body }, null, 2)}\n`,
        "utf8",
      );
    }

    console.log(`\nPayloads written to ${dir}`);

    if (useful.length === 0) {
      console.log(
        "\nNo response contained recognisable pet availability. Either the search\n" +
          "URL is wrong (check browser.selectors.searchUrl against what the site\n" +
          "puts in your address bar for a real search), or the results load behind\n" +
          "an interaction — re-run with browser.headless=false to see.",
      );
      return;
    }

    console.log("\nSuggested config — paste into browser.selectors:\n");
    console.log(
      JSON.stringify(
        { responseUrlPattern: suggestPattern(useful) },
        null,
        2,
      ),
    );
  } finally {
    await session.close();
  }
}

/** Builds a narrow regex from the URL paths that actually carried availability. */
export function suggestPattern(urls: string[]): string {
  const segments = new Set<string>();
  for (const url of urls) {
    try {
      const path = new URL(url).pathname;
      const last = path.split("/").filter(Boolean).pop();
      if (last) segments.add(last.replace(/[^a-zA-Z0-9-]/g, ""));
    } catch {
      // A malformed URL simply contributes nothing to the suggestion.
    }
  }
  return segments.size > 0 ? `(${[...segments].join("|")})` : ".";
}


/**
 * Interactive calibration: opens a real browser at the operator's home page and
 * records everything while the user performs a search by hand.
 *
 * This exists because automatic calibration can only start from a guessed
 * search URL. Letting the user drive removes the guess entirely — whatever URL
 * their search lands on is, by definition, the right one.
 */
/**
 * Shared analysis for both recording modes: writes payloads to disk and reports
 * what was found — which endpoints carried availability, and what the search
 * URL looks like as a reusable template.
 */
async function analyseRecording(
  result: RecordResult,
  watch: Watch,
  outputDir: string,
): Promise<void> {
  console.log(`\nPage title:  ${result.title || "(none)"}`);
  console.log(`Final URL:   ${result.finalUrl}`);
  console.log(`HTML size:   ${result.htmlLength} bytes`);
  console.log(`Pages seen:  ${result.pageUrls.length}`);
  console.log(`JSON responses captured: ${result.captured.length}`);
  console.log(`API requests observed:   ${result.requests.length}\n`);

  // The app's own call is what a bare curl cannot reproduce, so show it in
  // full: URL, method and headers.
  for (const request of result.requests) {
    console.log(`REQ  ${request.method} ${request.url}`);
    for (const [key, value] of Object.entries(request.headers)) {
      if (!/^(host|accept|content-type|authorization|x-|cookie|referer|origin)/i.test(key)) {
        continue;
      }
      // Anything that could carry a credential is reported by length only, so
      // the output is safe to paste into a chat or an issue.
      const secret = /cookie|authorization|token|auth|key|secret|session/i.test(key);
      const shown = secret ? `<redacted, ${value.length} bytes>` : value.slice(0, 160);
      console.log(`       ${key}: ${shown}`);
    }
  }
  if (result.requests.length > 0) console.log();

  if (/just a moment|access denied|are you a robot|checking your browser/i.test(result.title)) {
    console.log(
      "WARNING: that page title looks like a bot wall, not the booking site.\n" +
        "Availability cannot be read until that is passed.\n",
    );
  }

  const dir = resolve(outputDir);
  await mkdir(dir, { recursive: true });

  const hits: string[] = [];
  for (const [index, response] of result.captured.entries()) {
    const sailings = extractSailings(response.body, {
      routeFrom: watch.routeFrom,
      routeTo: watch.routeTo,
      bookingUrl: result.finalUrl,
    });
    const size = JSON.stringify(response.body).length;
    if (sailings.length > 0) {
      hits.push(response.url);
      console.log(`HIT  ${sailings.length} sailing(s)  ${response.url}`);
    } else {
      console.log(`     ${String(size).padStart(8)} bytes  ${response.url}`);
    }
    await writeFile(
      resolve(dir, `record-${String(index).padStart(3, "0")}.json`),
      `${JSON.stringify({ url: response.url, sailings, body: response.body }, null, 2)}\n`,
      "utf8",
    );
  }

  await writeFile(
    resolve(dir, "pages.json"),
    `${JSON.stringify(
      {
        title: result.title,
        finalUrl: result.finalUrl,
        htmlLength: result.htmlLength,
        pageUrls: result.pageUrls,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nPayloads written to ${dir}`);

  const suggestion = suggestSearchUrl([...result.pageUrls, result.finalUrl], watch);

  if (suggestion) {
    console.log("\nSearch URL derived from the observed navigation:");
    console.log(`  source: ${suggestion.sourceUrl}`);
    if (suggestion.missing.length > 0) {
      console.log(
        `  NOTE: could not locate ${suggestion.missing.join(", ")} — the site` +
          " probably uses internal codes for these.",
      );
      for (const [key, value] of suggestion.queryParams) {
        console.log(`    ${key} = ${value}`);
      }
    }
  } else {
    console.log(
      "\nCould not recognise a search URL among the pages visited. See pages.json.",
    );
  }

  if (hits.length === 0) {
    console.log(
      "\nNo response contained recognisable pet availability — either the sailing" +
        "\nlist had not loaded, or it lives behind a further step.",
    );
  }

  console.log("\nPaste into browser.selectors in your config:\n");
  console.log(
    JSON.stringify(
      {
        ...(suggestion ? { searchUrl: suggestion.template } : {}),
        ...(hits.length > 0 ? { responseUrlPattern: suggestPattern(hits) } : {}),
      },
      null,
      2,
    ),
  );
}

/**
 * Non-interactive calibration for CI, where nobody can press a key. Loads a URL,
 * lets the page settle for a fixed period, then reports everything it saw.
 */
export async function probeCalibration(
  config: Config,
  watch: Watch,
  outputDir: string,
  startUrl: string,
  waitSeconds: number,
): Promise<void> {
  console.log(`Probing ${startUrl}`);
  console.log(`Waiting ${waitSeconds}s for the page to settle.\n`);

  const session = await launchBrowser({
    headless: true,
    timeoutMs: config.browser.timeoutSeconds * 1000,
    responseUrlPattern: ".",
    executablePath: config.browser.executablePath,
  });

  try {
    const result = await session.record(startUrl, async () => {
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    });
    await analyseRecording(result, watch, outputDir);
  } finally {
    await session.close();
  }
}

export async function recordCalibration(
  config: Config,
  watch: Watch,
  outputDir: string,
  startUrl: string,
): Promise<void> {
  console.log("Recording calibration.\n");
  console.log("A browser window will open. In it, please:");
  console.log(`  1. Search ${watch.routeFrom} -> ${watch.routeTo} departing ${watch.dateFrom}`);
  console.log(`  2. Say you are travelling with ${watch.pets} pet(s) and ${watch.passengers} passenger(s)`);
  console.log("  3. Go as far as the page that lists sailings and cabin options");
  console.log("  4. Come back here and press Enter\n");
  console.log("The whole flow is recorded, so go as deep as the pet cabin options");
  console.log("actually being listed — that is the call we need to see.\n");

  const session = await launchBrowser({
    // Recording is inherently manual, so the window must be visible.
    headless: false,
    timeoutMs: config.browser.timeoutSeconds * 1000,
    responseUrlPattern: ".",
    executablePath: config.browser.executablePath,
  });

  try {
    const result = await session.record(startUrl, async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question("Press Enter when the sailing list is on screen... ");
      rl.close();
    });
    await analyseRecording(result, watch, outputDir);
  } finally {
    await session.close();
  }
}


/**
 * Lists the interactive controls on the booking page. Driving a form blind is
 * what wasted time before; this reports what is actually there so the search
 * can be automated against real selectors.
 */
export async function inspectForm(
  config: Config,
  url: string,
): Promise<void> {
  const selectors = resolveSelectors(config.browser.selectors);
  console.log(`Inspecting controls on ${url}\n`);

  const session = await launchBrowser({
    headless: true,
    timeoutMs: config.browser.timeoutSeconds * 1000,
    responseUrlPattern: ".",
    executablePath: config.browser.executablePath,
  });

  try {
    const controls = await session.inspect(url, selectors.consentSelector);
    const visible = controls.filter((control) => control.visible);
    console.log(`${controls.length} controls, ${visible.length} visible.\n`);

    const selects = await session.enumerateSelects(url, selectors.consentSelector);
    if (selects.length > 0) {
      console.log("Dropdowns and their options:\n");
      for (const select of selects) {
        console.log(`  #${select.id}  ${select.testId}  label="${select.label}"`);
        for (const option of select.options.slice(0, 25)) {
          console.log(`      - ${option}`);
        }
        if (select.options.length > 25) {
          console.log(`      ... ${select.options.length - 25} more`);
        }
        if (select.options.length === 0) console.log("      (no options rendered)");
      }
      console.log();
    }

    for (const control of visible) {
      const parts = [
        control.tag + (control.type ? `[${control.type}]` : ""),
        control.id && `#${control.id}`,
        control.name && `name=${control.name}`,
        control.testId && `testid=${control.testId}`,
        control.placeholder && `placeholder="${control.placeholder}"`,
        control.ariaLabel && `aria="${control.ariaLabel}"`,
        control.text && `text="${control.text}"`,
      ].filter(Boolean);
      console.log(`  ${parts.join("  ")}`);
    }
  } finally {
    await session.close();
  }
}


/**
 * Drives the booking form end to end and reports what happened at each step.
 *
 * The point is the request the site's own JavaScript makes once a real search
 * has been performed — a bare call to /crossing is refused, so the search has
 * to actually happen. Every step reports success or failure so a run that
 * breaks says where, rather than only that it did.
 */
export async function driveSearch(
  config: Config,
  watch: Watch,
  outputDir: string,
  bookingUrl: string,
): Promise<void> {
  const selectors = resolveSelectors(config.browser.selectors);
  console.log(`Driving a search: ${watch.routeFrom} -> ${watch.routeTo}, ${watch.dateFrom}\n`);

  const session = await launchBrowser({
    headless: true,
    timeoutMs: config.browser.timeoutSeconds * 1000,
    responseUrlPattern: ".",
    executablePath: config.browser.executablePath,
  });

  try {
    const outcome = await session.search({
      bookingUrl,
      consentSelector: selectors.consentSelector,
      routeFrom: watch.routeFrom,
      routeTo: watch.routeTo,
      date: watch.dateFrom,
      pets: watch.pets,
      settleMs: 6000,
    });

    console.log("Steps:");
    for (const step of outcome.steps) {
      console.log(`  ${step.ok ? "ok  " : "FAIL"} ${step.step}: ${step.detail}`);
    }

    console.log(`\nFinal URL: ${outcome.finalUrl}`);
    console.log(`Title:     ${outcome.title}\n`);

    await analyseRecording(
      {
        captured: outcome.captured,
        requests: outcome.requests,
        pageUrls: [outcome.finalUrl],
        finalUrl: outcome.finalUrl,
        title: outcome.title,
        htmlLength: 0,
      },
      watch,
      outputDir,
    );
  } finally {
    await session.close();
  }
}
