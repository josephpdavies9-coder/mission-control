import type { Watch } from "./config.js";
import type { Offer, Sailing } from "./types.js";

/** `YYYY-MM-DD` portion of an ISO local timestamp. */
function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** `HH:MM` portion of an ISO local timestamp. */
function timeOf(iso: string): string {
  return iso.slice(11, 16);
}

/** Flattens sailings into one offer per pet option. */
export function toOffers(sailings: Sailing[]): Offer[] {
  return sailings.flatMap((sailing) =>
    sailing.petOptions.map((option) => ({
      key: `${sailing.id}::${option.code}`,
      sailingId: sailing.id,
      routeFrom: sailing.routeFrom,
      routeTo: sailing.routeTo,
      departAt: sailing.departAt,
      arriveAt: sailing.arriveAt,
      shipName: sailing.shipName,
      option,
      bookingUrl: sailing.bookingUrl,
    })),
  );
}

/**
 * Keeps only the offers this watch actually wants: available, of a wanted
 * kind, inside the date window, inside the time-of-day window, under the
 * price ceiling.
 */
export function matchOffers(watch: Watch, offers: Offer[]): Offer[] {
  return offers.filter((offer) => {
    if (!offer.option.available) return false;
    if (!watch.wantKinds.includes(offer.option.kind)) return false;

    const date = dateOf(offer.departAt);
    if (date < watch.dateFrom || date > watch.dateTo) return false;

    const time = timeOf(offer.departAt);
    if (watch.departAfter && time < watch.departAfter) return false;
    if (watch.departBefore && time > watch.departBefore) return false;

    if (watch.maxPrice !== null) {
      // An undisclosed price can't be ruled out, so let it through and let the
      // email show "price not shown" rather than silently dropping a hit.
      if (offer.option.price !== null && offer.option.price > watch.maxPrice) {
        return false;
      }
    }

    return true;
  });
}

/** Chronological, then by price, then stable by key. */
export function sortOffers(offers: Offer[]): Offer[] {
  return [...offers].sort((a, b) => {
    if (a.departAt !== b.departAt) return a.departAt < b.departAt ? -1 : 1;
    const ap = a.option.price ?? Number.MAX_SAFE_INTEGER;
    const bp = b.option.price ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
