import type { Offer, WatchDelta } from "./types.js";
import type { WatchState } from "./store.js";
import { emptyWatchState } from "./store.js";
import { sortOffers } from "./match.js";

export interface DiffOptions {
  /** Suppress a repeat alert for the same offer within this many hours. */
  renotifyAfterHours: number;
  /** Report offers that were alerted on and have since sold out. */
  notifyOnDisappear: boolean;
}

export interface DiffOutcome {
  delta: WatchDelta;
  /** The watch state to persist, with seen/notified timestamps rolled forward. */
  nextState: WatchState;
}

function hoursBetween(laterIso: string, earlierIso: string): number {
  return (Date.parse(laterIso) - Date.parse(earlierIso)) / 3_600_000;
}

/**
 * Decides what is worth emailing about.
 *
 * An offer is reported as `appeared` when it is available now and either we
 * have never alerted on it, or the last alert is older than the re-notify
 * window. Offers that simply persist between sweeps stay silent — that is the
 * whole point of the state file.
 */
export function diffWatch(
  watchId: string,
  watchLabel: string,
  previous: WatchState | undefined,
  currentOffers: Offer[],
  now: string,
  options: DiffOptions,
): DiffOutcome {
  const prior = previous ?? emptyWatchState();
  const appeared: Offer[] = [];
  const nextOffers: WatchState["offers"] = {};
  const currentKeys = new Set(currentOffers.map((offer) => offer.key));

  for (const offer of currentOffers) {
    const seen = prior.offers[offer.key];
    const lastNotifiedAt = seen?.lastNotifiedAt ?? null;

    // Never alerted, or alerted long enough ago to be worth repeating.
    const shouldNotify =
      lastNotifiedAt === null ||
      hoursBetween(now, lastNotifiedAt) >= options.renotifyAfterHours;

    if (shouldNotify) appeared.push(offer);

    nextOffers[offer.key] = {
      firstSeenAt: seen?.firstSeenAt ?? now,
      lastSeenAt: now,
      lastNotifiedAt: shouldNotify ? now : (seen?.lastNotifiedAt ?? null),
    };
  }

  const disappeared: Offer[] = [];
  if (options.notifyOnDisappear) {
    for (const [key, seen] of Object.entries(prior.offers)) {
      if (currentKeys.has(key)) continue;
      // Only worth reporting a loss for something we told them about.
      if (seen.lastNotifiedAt === null) continue;
      disappeared.push(placeholderOffer(key, seen.lastSeenAt));
    }
  }

  return {
    delta: {
      watchId,
      watchLabel,
      appeared: sortOffers(appeared),
      disappeared,
    },
    nextState: {
      lastCheckedAt: now,
      consecutiveFailures: 0,
      failureNotifiedAt: null,
      offers: nextOffers,
    },
  };
}

/**
 * A gone offer is no longer in the provider's response, so all we can
 * reconstruct is what its key encodes.
 */
function placeholderOffer(key: string, lastSeenAt: string): Offer {
  const [sailingId = key, code = "unknown"] = key.split("::");
  return {
    key,
    sailingId,
    routeFrom: "",
    routeTo: "",
    departAt: lastSeenAt,
    arriveAt: null,
    shipName: null,
    option: {
      code,
      label: code,
      kind: "pet-friendly-cabin",
      available: false,
      remaining: 0,
      price: null,
      currency: null,
    },
    bookingUrl: null,
  };
}

/** Rolls a failed sweep into the watch state without discarding what we knew. */
export function recordFailure(
  previous: WatchState | undefined,
  now: string,
): WatchState {
  const prior = previous ?? emptyWatchState();
  return {
    ...prior,
    lastCheckedAt: now,
    consecutiveFailures: prior.consecutiveFailures + 1,
  };
}
