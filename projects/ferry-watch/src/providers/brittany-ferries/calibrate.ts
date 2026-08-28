import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Watch } from "../../config.js";
import type { Config } from "../../config.js";
import { extractSailings } from "./parse.js";
import { buildUrl, resolveSelectors } from "./selectors.js";
import { launchBrowser } from "./browser.js";

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
