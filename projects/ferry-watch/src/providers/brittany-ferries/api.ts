import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Watch } from "../../config.js";
import type { PetOption, Sailing } from "../../types.js";
import { toPortCode } from "./ports.js";

/**
 * Reads availability from Brittany Ferries' internal JSON API.
 *
 * These endpoints need no cookies, no session and no browser — the earlier
 * conclusion that they did was wrong. A bare POST to /crossing returns 405,
 * which is true of that path but says nothing about its children: the real
 * endpoints are /crossing/prices and /crossing/accommodations, and both are
 * POST. Sequence discovered by Codex.
 */

const BASE = "https://www.brittany-ferries.co.uk/api/bebop/v1";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Pets split by the categories the operator prices separately. */
export interface PetParty {
  smallDogs: number;
  largeDogs: number;
  cats: number;
}

interface Vehicle {
  type: string;
  registrations: string[];
  height: number;
  length: number;
  extras: { rearMountedBikeCarrier: null };
}

function vehicleFor(watch: Watch): Vehicle {
  return {
    type: (watch.vehicle ?? "CAR").toUpperCase(),
    registrations: ["TBC"],
    height: 183,
    length: 500,
    extras: { rearMountedBikeCarrier: null },
  };
}

function petsFor(watch: Watch): PetParty {
  return { smallDogs: watch.pets, largeDogs: 0, cats: 0 };
}

async function postJson(
  path: string,
  body: unknown,
  attempt = 0,
): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      "accept-language": "en-GB",
      "user-agent": UA,
    },
    body: JSON.stringify(body),
  });

  // Rate limiting and transient server errors are worth one backed-off retry;
  // anything else is a real answer and should surface.
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1500));
    return postJson(path, body, attempt + 1);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${path} returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  const payload: unknown = await response.json();
  dump(path, body, payload);
  return payload;
}

/**
 * Writes the exact request and response to FERRY_WATCH_DUMP_DIR when set.
 *
 * A run that finds nothing is ambiguous: the operator may genuinely have no
 * pet cabins, or the parser may be looking in the wrong place. Only the raw
 * payload separates the two, and mirroring the request in a separate curl
 * drifts out of step with the code. Off unless the variable is set.
 */
let dumpSeq = 0;
function dump(path: string, request: unknown, response: unknown): void {
  const dir = process.env.FERRY_WATCH_DUMP_DIR;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const name = `${String(++dumpSeq).padStart(3, "0")}${path.replace(/\//g, "-")}.json`;
    writeFileSync(
      join(dir, name),
      JSON.stringify({ path, request, response }, null, 2),
    );
  } catch {
    // Diagnostics must never break a live sweep.
  }
}

/** Inclusive `YYYY-MM-DD` range split into windows of at most `days`. */
export function dateWindows(
  from: string,
  to: string,
  days = 7,
): { fromDate: string; toDate: string }[] {
  const windows: { fromDate: string; toDate: string }[] = [];
  let cursor = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(end)) return windows;

  while (cursor <= end && windows.length < 20) {
    const stop = Math.min(cursor + (days - 1) * 86_400_000, end);
    windows.push({
      fromDate: `${new Date(cursor).toISOString().slice(0, 10)}T00:00:00`,
      toDate: `${new Date(stop).toISOString().slice(0, 10)}T23:59:59`,
    });
    cursor = stop + 86_400_000;
  }
  return windows;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Walks a payload for objects that look like sailings with pet availability. */
export function extractCandidates(payload: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    // Presence of the key is not enough. The petAvailabilities object itself
    // contains a boolean named petAvailability, so a key test matches it too
    // and reports one sailing as two. A sailing is a record whose pet
    // availability is itself structured.
    const pets = record.petAvailabilities ?? record.petAvailability;
    if (asRecord(pets) !== null || Array.isArray(pets)) {
      found.push(record);
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return found;
}

/** True when the sailing advertises a pet cabin as available. */
export function petCabinAvailable(sailing: Record<string, unknown>): boolean {
  const raw = sailing.petAvailabilities ?? sailing.petAvailability;
  const record = asRecord(raw);
  if (record) return record.petCabinAvailable === true;
  if (Array.isArray(raw)) {
    return raw.some((entry) => asRecord(entry)?.petCabinAvailable === true);
  }
  return false;
}

const PET_CABIN = /pet\s*friendly\s*cabin/i;

/** Keeps only accommodations that are pet cabins with stock. */
export function petCabinsFrom(payload: unknown): PetOption[] {
  const options: PetOption[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = asRecord(node);
    if (!record) return;

    const description = String(record.description ?? record.name ?? "");
    const quantity = Number(record.quantityAvailable ?? record.quantity ?? 0);
    if (PET_CABIN.test(description) && quantity > 0) {
      const price = Number(record.price ?? record.totalPrice ?? NaN);
      options.push({
        code: String(record.code ?? record.accommodationCode ?? description),
        label: description,
        kind: "pet-friendly-cabin",
        available: true,
        remaining: Math.trunc(quantity),
        price: Number.isFinite(price) ? Math.round(price * 100) : null,
        currency: typeof record.currency === "string" ? record.currency : "GBP",
      });
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return options;
}

export async function fetchPrices(
  watch: Watch,
  window: { fromDate: string; toDate: string },
): Promise<unknown> {
  return postJson("/crossing/prices", {
    bookingReference: null,
    pets: petsFor(watch),
    passengers: { adults: watch.passengers, children: 0, infants: 0 },
    vehicle: vehicleFor(watch),
    departurePort: toPortCode(watch.routeFrom),
    arrivalPort: toPortCode(watch.routeTo),
    disability: null,
    direction: "outbound",
    fromDate: window.fromDate,
    toDate: window.toDate,
  });
}

export async function fetchAccommodations(
  watch: Watch,
  /** The sailing's exact departure instant, ISO with Z. Nothing else parses. */
  departureDate: string,
  shipName: string,
  ticketTier: string,
): Promise<unknown> {
  return postJson("/crossing/accommodations", {
    bookingReference: null,
    departurePort: toPortCode(watch.routeFrom),
    arrivalPort: toPortCode(watch.routeTo),
    departureDate,
    passengers: { adults: watch.passengers, children: 0, infants: 0 },
    vehicle: vehicleFor(watch),
    disability: null,
    petCabinsNeeded: true,
    ticketTier,
    pets: petsFor(watch),
    shipName,
    direction: "outbound",
  });
}

/** Reads a string or number field from a sailing under any of several names. */
function pick(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/**
 * Reads a timestamp that the operator sends as an object, not a string.
 *
 * A sailing carries `departureDateTime: { iso, date, time }` — there is no
 * plain `departureDate` field at all. Reading it as a string yielded "", and
 * because a missing departure date skipped the sailing, the accommodations
 * lookup could never have fired even once a pet cabin appeared. Confirmed
 * against live payloads.
 */
function pickDateTime(
  record: Record<string, unknown>,
  keys: string[],
): { iso: string; date: string } {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) {
      return { iso: value, date: value.slice(0, 10) };
    }
    const nested = asRecord(value);
    if (!nested) continue;
    const iso = typeof nested.iso === "string" ? nested.iso : "";
    const date = typeof nested.date === "string" ? nested.date : iso.slice(0, 10);
    if (iso || date) return { iso: iso || date, date };
  }
  return { iso: "", date: "" };
}

/**
 * Two-step read: prices lists sailings with a preliminary pet-cabin flag, then
 * accommodations gives cabin-level stock for the ones worth asking about.
 */
export async function readAvailability(
  watch: Watch,
  log: (message: string) => void,
): Promise<Sailing[]> {
  const sailings: Sailing[] = [];

  for (const window of dateWindows(watch.dateFrom, watch.dateTo)) {
    log(`  prices ${window.fromDate.slice(0, 10)} to ${window.toDate.slice(0, 10)}`);
    const prices = await fetchPrices(watch, window);

    for (const candidate of extractCandidates(prices)) {
      if (!petCabinAvailable(candidate)) continue;

      const departure = pickDateTime(candidate, [
        "departureDateTime",
        "adjustedDepartureDateTime",
        "departureDate",
        "departure",
      ]);
      const arrival = pickDateTime(candidate, [
        "arrivalDateTime",
        "adjustedArrivalDateTime",
      ]);
      const shipName = pick(candidate, ["shipName", "ship", "vessel"]);
      if (!departure.date) continue;

      // The second call adds which cabin and at what price. It is enrichment,
      // not a gate: the flag above is already per-sailing stock — the same
      // payload shows kennelAvailable false beside smallKennelAvailable true —
      // so dropping a flagged sailing because this call returned nothing
      // parseable would lose the one event the whole watcher exists for.
      let petOptions: PetOption[] = [];
      if (shipName) {
        try {
          const tier = pick(candidate, ["ticketTier", "tier", "fareTier"]) || "STANDARD";
          // departureDate must be the sailing's exact departure instant, ISO
          // with the trailing Z — "2027-05-10T20:45:00Z". Established by
          // probing eighteen body variants against the live endpoint: that
          // one was accepted and every other form of the date was rejected,
          // midnight and Z-stripped included.
          petOptions = petCabinsFrom(
            await fetchAccommodations(watch, departure.iso, shipName, tier),
          );
        } catch (error) {
          log(`  accommodations lookup failed: ${(error as Error).message}`);
        }
        // Considerate pacing between accommodation lookups.
        await new Promise((r) => setTimeout(r, 800));
      }

      if (petOptions.length === 0) {
        petOptions = [
          {
            code: "pet-cabin",
            label: "Pet-friendly cabin",
            kind: "pet-friendly-cabin",
            available: true,
            remaining: null,
            price: null,
            currency: "GBP",
          },
        ];
      }

      sailings.push({
        id:
          pick(candidate, ["sailingId", "id", "crossingId"]) ||
          `${shipName}-${departure.date}`,
        routeFrom: watch.routeFrom,
        routeTo: watch.routeTo,
        departAt: departure.iso.replace("Z", "").slice(0, 19),
        arriveAt: arrival.iso ? arrival.iso.replace("Z", "").slice(0, 19) : null,
        shipName: shipName || null,
        petOptions,
        bookingUrl: "https://www.brittany-ferries.co.uk/booking",
      });
    }
  }

  return sailings;
}
