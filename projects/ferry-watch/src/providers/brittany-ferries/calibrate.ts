import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Watch } from "../../config.js";
import type { Config } from "../../config.js";
import { extractSailings } from "./parse.js";
import { buildUrl, resolveSelectors } from "./selectors.js";
import { createInterface } from "node:readline/promises";
import { launchBrowser } from "./browser.js";
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

    console.log(
      `\nRecorded ${result.captured.length} JSON response(s) across ` +
        `${result.pageUrls.length} page(s).\n`,
    );

    const dir = resolve(outputDir);
    await mkdir(dir, { recursive: true });

    const hits: string[] = [];
    for (const [index, response] of result.captured.entries()) {
      const sailings = extractSailings(response.body, {
        routeFrom: watch.routeFrom,
        routeTo: watch.routeTo,
        bookingUrl: result.finalUrl,
      });
      if (sailings.length > 0) {
        hits.push(response.url);
        console.log(`HIT  ${sailings.length} sailing(s)  ${response.url}`);
      }
      await writeFile(
        resolve(dir, `record-${String(index).padStart(3, "0")}.json`),
        `${JSON.stringify({ url: response.url, sailings, body: response.body }, null, 2)}\n`,
        "utf8",
      );
    }

    await writeFile(
      resolve(dir, "pages.json"),
      `${JSON.stringify({ pageUrls: result.pageUrls, finalUrl: result.finalUrl }, null, 2)}\n`,
      "utf8",
    );
    console.log(`\nEverything written to ${dir}`);

    const suggestion = suggestSearchUrl(
      [...result.pageUrls, result.finalUrl],
      watch,
    );

    if (!suggestion) {
      console.log(
        "\nCould not recognise a search URL. Look at pages.json and build\n" +
          "browser.selectors.searchUrl by hand, using {from} {to} {date}\n" +
          "{passengers} {pets} where those values appear.",
      );
    } else {
      console.log("\nSearch URL derived from your search:");
      console.log(`  source: ${suggestion.sourceUrl}`);
      if (suggestion.missing.length > 0) {
        console.log(
          `  NOTE: could not locate ${suggestion.missing.join(", ")} in the URL — ` +
            "the site probably uses internal codes for these.",
        );
        if (suggestion.queryParams.length > 0) {
          console.log("  Query parameters, so you can map them yourself:");
          for (const [key, value] of suggestion.queryParams) {
            console.log(`    ${key} = ${value}`);
          }
        }
      }
    }

    if (hits.length === 0) {
      console.log(
        "\nNo response contained recognisable pet availability. Either the sailing\n" +
          "list had not loaded when you pressed Enter, or the pet options live behind\n" +
          "a further step — re-run and go one page deeper.",
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
  } finally {
    await session.close();
  }
}
