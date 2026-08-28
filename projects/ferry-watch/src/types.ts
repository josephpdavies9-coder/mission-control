/** Core domain types shared across providers, matching, storage and notification. */

/** The kinds of pet accommodation a ferry operator can sell. */
export type PetAccommodationKind =
  | "pet-friendly-cabin"
  | "kennel"
  | "pet-in-vehicle"
  | "pet-deck";

/** One bookable pet-accommodation option on a specific sailing. */
export interface PetOption {
  /** Operator's own code where known, else a slug derived from the label. */
  code: string;
  /** Human label exactly as the operator presents it. */
  label: string;
  kind: PetAccommodationKind;
  available: boolean;
  /** Units left, when the operator discloses it. */
  remaining: number | null;
  /** Price in minor units of `currency` (e.g. pence), when known. */
  price: number | null;
  currency: string | null;
}

/** A single sailing returned by a provider, with its pet options. */
export interface Sailing {
  /** Stable per-provider identifier for this sailing. */
  id: string;
  routeFrom: string;
  routeTo: string;
  /** ISO 8601 local departure timestamp as advertised by the operator. */
  departAt: string;
  arriveAt: string | null;
  shipName: string | null;
  petOptions: PetOption[];
  /** Deep link back to the operator so a hit can be booked immediately. */
  bookingUrl: string | null;
}

/** A pet option on a sailing, flattened — the unit alerts are raised about. */
export interface Offer {
  /** Stable key used for de-duplication across runs: `${sailing.id}::${option.code}`. */
  key: string;
  sailingId: string;
  routeFrom: string;
  routeTo: string;
  departAt: string;
  arriveAt: string | null;
  shipName: string | null;
  option: PetOption;
  bookingUrl: string | null;
}

/** Outcome of checking one watch. */
export interface WatchResult {
  watchId: string;
  watchLabel: string;
  checkedAt: string;
  /** Offers that matched the watch's filters and are currently available. */
  matched: Offer[];
  /** Populated instead of `matched` when the provider failed. */
  error: string | null;
}

/** What changed for a watch since the previous run. */
export interface WatchDelta {
  watchId: string;
  watchLabel: string;
  /** Newly available, or available again after a cooldown. */
  appeared: Offer[];
  /** Previously notified as available and now gone. */
  disappeared: Offer[];
}
