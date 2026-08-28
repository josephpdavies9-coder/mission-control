import type { PetAccommodationKind, PetOption, Sailing } from "../../types.js";

/**
 * Brittany Ferries has no public API, so availability is read out of the JSON
 * their booking pages fetch for themselves. That JSON is undocumented and
 * changes without notice, so this parser is deliberately shape-tolerant: it
 * walks an arbitrary payload looking for things that behave like sailings and
 * pet-accommodation options, rather than binding to one exact schema.
 *
 * `pnpm calibrate` dumps the real payloads so these heuristics can be
 * tightened against whatever the site is actually returning today.
 */

type Json = unknown;
type JsonRecord = Record<string, Json>;

const DEPARTURE_KEYS =
  /^(depart(ure)?(date)?(time)?|sailingdate(time)?|startdate(time)?|outbounddate)$/i;
const ARRIVAL_KEYS = /^(arriv(al|e)(date)?(time)?|enddate(time)?)$/i;
const SHIP_KEYS = /^(ship|vessel|shipname|vesselname)$/i;
const ID_KEYS = /^(id|code|sailingid|sailingcode|serviceid|crossingid)$/i;
const LABEL_KEYS = /^(name|label|title|description|displayname|accommodationname)$/i;
// The optional suffix lets keys that name their own units (`pricePence`)
// match here, so `toMinorUnits` can honour them.
const PRICE_KEYS = /^(price|amount|total|fare|cost|totalprice)(pence|cents|minor(units)?)?$/i;
const CURRENCY_KEYS = /^(currency|currencycode|ccy)$/i;
const REMAINING_KEYS =
  /^(remaining|available(count|units|quantity)?|quantityavailable|capacity|stock|berthsavailable)$/i;
const AVAILABLE_KEYS = /^(available|isavailable|bookable|isbookable|instock)$/i;
const SOLD_OUT_KEYS = /^(soldout|issoldout|unavailable|isunavailable|full)$/i;

/** Anything whose text mentions a pet is a candidate accommodation option. */
const PET_TEXT = /\b(pet|pets|dog|dogs|animal|kennel)\b/i;

function isRecord(value: Json): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalises the date formats seen in the wild to `YYYY-MM-DDTHH:MM:SS`,
 * preserving the operator's local time rather than shifting to UTC.
 */
export function normaliseDateTime(value: string): string | null {
  const trimmed = value.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (iso) {
    const [, y, m, d, hh = "00", mm = "00", ss = "00"] = iso;
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }

  const uk = /^(\d{2})\/(\d{2})\/(\d{4})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (uk) {
    const [, d, m, y, hh = "00", mm = "00", ss = "00"] = uk;
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }

  return null;
}

/** Classifies an option's text into the kind of pet accommodation it is. */
export function classifyPetKind(text: string): PetAccommodationKind | null {
  if (!PET_TEXT.test(text)) return null;
  if (/kennel/i.test(text)) return "kennel";
  if (/\b(in|stay\w*)\b.{0,20}\b(vehicle|car|van|motorhome)\b/i.test(text)) {
    return "pet-in-vehicle";
  }
  if (/\bdeck\b/i.test(text)) return "pet-deck";
  if (/\b(cabin|berth|kabine|stateroom)\b/i.test(text)) return "pet-friendly-cabin";
  // Mentions a pet but names no accommodation — treat as a cabin, which is the
  // scarce thing worth alerting on, and let the label speak for itself.
  return "pet-friendly-cabin";
}

function firstString(node: JsonRecord, pattern: RegExp): string | null {
  for (const [key, value] of Object.entries(node)) {
    if (pattern.test(key) && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function firstNumber(node: JsonRecord, pattern: RegExp): number | null {
  for (const [key, value] of Object.entries(node)) {
    if (!pattern.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstBoolean(node: JsonRecord, pattern: RegExp): boolean | null {
  for (const [key, value] of Object.entries(node)) {
    if (!pattern.test(key)) continue;
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

/**
 * Converts a price to minor units. Undocumented feeds most often quote major
 * units (`127.5`), so that is the assumption unless the key says otherwise.
 */
export function toMinorUnits(node: JsonRecord): number | null {
  for (const [key, value] of Object.entries(node)) {
    if (!PRICE_KEYS.test(key)) continue;
    const raw =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value.replace(/[^0-9.-]/g, ""))
          : NaN;
    if (!Number.isFinite(raw) || raw < 0) continue;
    const alreadyMinor = /pence|cents|minor/i.test(key);
    return Math.round(alreadyMinor ? raw : raw * 100);
  }
  return null;
}

/** Every string value directly on a node, used for pet keyword matching. */
function ownText(node: JsonRecord): string {
  return Object.entries(node)
    .filter(([, value]) => typeof value === "string")
    .map(([, value]) => value as string)
    .join(" ");
}

function toPetOption(node: JsonRecord): PetOption | null {
  const text = ownText(node);
  const kind = classifyPetKind(text);
  if (!kind) return null;

  const label = firstString(node, LABEL_KEYS) ?? text.slice(0, 80).trim();
  if (!label) return null;

  const soldOut = firstBoolean(node, SOLD_OUT_KEYS);
  const availableFlag = firstBoolean(node, AVAILABLE_KEYS);
  const remaining = firstNumber(node, REMAINING_KEYS);

  // Prefer an explicit signal; fall back to a positive count; otherwise assume
  // the operator would not have listed it at all if it were unbookable.
  const available =
    soldOut !== null
      ? !soldOut
      : availableFlag !== null
        ? availableFlag
        : remaining !== null
          ? remaining > 0
          : true;

  return {
    code: firstString(node, ID_KEYS) ?? slug(label),
    label,
    kind,
    available,
    remaining: remaining === null ? null : Math.max(0, Math.trunc(remaining)),
    price: toMinorUnits(node),
    currency: firstString(node, CURRENCY_KEYS),
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Depth-first walk yielding every object in a payload. */
function* walk(node: Json, depth = 0): Generator<JsonRecord> {
  if (depth > 24) return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  yield node;
  for (const value of Object.values(node)) yield* walk(value, depth + 1);
}

/** Collects pet options anywhere beneath a node, de-duplicated by code. */
function collectPetOptions(node: JsonRecord): PetOption[] {
  const byCode = new Map<string, PetOption>();
  for (const candidate of walk(node)) {
    const option = toPetOption(candidate);
    if (!option) continue;
    const existing = byCode.get(option.code);
    // Keep the richest record when the same option appears more than once.
    if (!existing || (existing.price === null && option.price !== null)) {
      byCode.set(option.code, option);
    }
  }
  return [...byCode.values()];
}

export interface ParseContext {
  routeFrom: string;
  routeTo: string;
  bookingUrl: string | null;
}

/**
 * Extracts sailings with pet availability from an arbitrary payload.
 * Returns an empty array rather than throwing when nothing matches, so a
 * changed schema degrades to "no availability found" and is caught by the
 * consecutive-failure alert rather than crashing the run.
 */
export function extractSailings(payload: Json, context: ParseContext): Sailing[] {
  const sailings = new Map<string, Sailing>();

  for (const node of walk(payload)) {
    const departRaw = firstString(node, DEPARTURE_KEYS);
    if (!departRaw) continue;
    const departAt = normaliseDateTime(departRaw);
    if (!departAt) continue;

    const petOptions = collectPetOptions(node);
    if (petOptions.length === 0) continue;

    const arrivalRaw = firstString(node, ARRIVAL_KEYS);
    const shipName = firstString(node, SHIP_KEYS);
    const id =
      firstString(node, ID_KEYS) ??
      slug(`${context.routeFrom}-${context.routeTo}-${departAt}`);

    const existing = sailings.get(id);
    if (existing && existing.petOptions.length >= petOptions.length) continue;

    sailings.set(id, {
      id,
      routeFrom: context.routeFrom,
      routeTo: context.routeTo,
      departAt,
      arriveAt: arrivalRaw ? normaliseDateTime(arrivalRaw) : null,
      shipName,
      petOptions,
      bookingUrl: context.bookingUrl,
    });
  }

  return [...sailings.values()];
}
