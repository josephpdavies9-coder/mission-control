import type { Watch } from "../../config.js";
import type { Sailing } from "../../types.js";
import type { AvailabilityProvider, ProviderContext } from "../types.js";
import { extractSailings } from "./parse.js";
import { buildUrl, datesInRange, resolveSelectors } from "./selectors.js";
import { launchBrowser, type CapturedResponse } from "./browser.js";

/**
 * Reads pet-accommodation availability from the Brittany Ferries booking site
 * by driving a real browser and reading the JSON their own pages fetch.
 *
 * This is what dog.boats did in effect: there is no API to call, so we make the
 * same requests a person clicking through the booking form would make. One
 * page load per departure date, at a polite cadence.
 */
export class BrittanyFerriesProvider implements AvailabilityProvider {
  readonly id = "brittany-ferries";

  async check(watch: Watch, context: ProviderContext): Promise<Sailing[]> {
    const selectors = resolveSelectors(context.browser.selectors);
    const dates = datesInRange(watch.dateFrom, watch.dateTo);
    if (dates.length === 0) return [];

    const session = await launchBrowser({
      headless: context.browser.headless,
      timeoutMs: context.browser.timeoutSeconds * 1000,
      responseUrlPattern: selectors.responseUrlPattern,
    });

    const sailings = new Map<string, Sailing>();
    try {
      for (const date of dates) {
        const url = buildUrl(selectors.searchUrl, {
          from: watch.routeFrom,
          to: watch.routeTo,
          date,
          passengers: watch.passengers,
          pets: watch.pets,
          vehicle: watch.vehicle,
        });

        context.log(`  fetching ${date}`);
        const captured = await session.visit(url, {
          consentSelector: selectors.consentSelector,
          readySelector: selectors.readySelector,
        });

        for (const sailing of parseCaptured(captured, watch, url)) {
          const existing = sailings.get(sailing.id);
          if (!existing || sailing.petOptions.length > existing.petOptions.length) {
            sailings.set(sailing.id, sailing);
          }
        }

        // Be a considerate guest on someone else's website.
        await session.pause(1500 + Math.floor(Math.random() * 1500));
      }
    } finally {
      await session.close();
    }

    if (sailings.size === 0) {
      throw new Error(
        "No sailings could be read from the booking site. This usually means the " +
          "page layout or its internal endpoints have changed. Run `pnpm calibrate` " +
          "to capture the current requests and update browser.selectors in your config.",
      );
    }

    return [...sailings.values()];
  }
}

function parseCaptured(
  captured: CapturedResponse[],
  watch: Watch,
  bookingUrl: string,
): Sailing[] {
  return captured.flatMap((response) =>
    extractSailings(response.body, {
      routeFrom: watch.routeFrom,
      routeTo: watch.routeTo,
      bookingUrl,
    }),
  );
}
