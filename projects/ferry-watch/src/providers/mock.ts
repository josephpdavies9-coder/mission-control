import type { AvailabilityProvider } from "./types.js";
import type { Sailing } from "../types.js";
import type { Watch } from "../config.js";

/**
 * Deterministic provider used by `--provider mock` so the whole pipeline —
 * matching, de-duplication, templating, delivery — can be exercised end to end
 * without touching an operator's website.
 */
export class MockProvider implements AvailabilityProvider {
  readonly id = "mock";

  async check(watch: Watch): Promise<Sailing[]> {
    return [
      {
        id: `mock-${watch.id}-1`,
        routeFrom: watch.routeFrom,
        routeTo: watch.routeTo,
        departAt: `${watch.dateFrom}T20:30:00`,
        arriveAt: null,
        shipName: "Galicia",
        bookingUrl: "https://www.brittany-ferries.co.uk/",
        petOptions: [
          {
            code: "PETCAB4",
            label: "4-berth pet-friendly cabin",
            kind: "pet-friendly-cabin",
            available: true,
            remaining: 2,
            price: 24500,
            currency: "GBP",
          },
        ],
      },
    ];
  }
}
