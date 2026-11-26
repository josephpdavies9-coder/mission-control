/**
 * Finds the Spain-to-home crossings Brittany Ferries actually run in December,
 * including any Spain-to-Ireland route, and reports pet availability on each.
 *
 * Joe is travelling home FROM Spain between 5 and 20 December and wants to
 * avoid driving up through France, so the question is which direct crossings
 * out of Spain exist at all, to Britain or to Ireland. Irish port codes are
 * not in ports.ts, and guessing one would send a request that cannot be told
 * apart from "no sailings", so they are read from the operator's own public
 * route catalogue first.
 *
 * Run: pnpm exec tsx scripts/probe-homebound.ts
 */

import { extractCandidates, petCabinAvailable } from "../src/providers/brittany-ferries/api.js";

const SITES = [
  { name: "UK site", base: "https://www.brittany-ferries.co.uk/api/bebop/v1" },
  { name: "Irish site", base: "https://www.brittanyferries.ie/api/bebop/v1" },
];
const BASE = process.env.FERRY_BASE ?? SITES[0]!.base;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const WINDOWS = [
  { fromDate: "2026-12-05T00:00:00", toDate: "2026-12-11T23:59:59" },
  { fromDate: "2026-12-12T00:00:00", toDate: "2026-12-18T23:59:59" },
  { fromDate: "2026-12-19T00:00:00", toDate: "2026-12-20T23:59:59" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Every five-letter port code in the payload, with whatever name sits beside it. */
function collectPorts(payload: unknown): Map<string, string> {
  const ports = new Map<string, string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 14) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && /^[A-Z]{5}$/.test(value)) {
        const name =
          [record.name, record.label, record.portName, record.title].find(
            (candidate) => typeof candidate === "string" && candidate,
          ) ?? `(seen under "${key}")`;
        if (!ports.has(value)) ports.set(value, String(name));
      }
      walk(value, depth + 1);
    }
  };
  walk(payload, 0);
  return ports;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown; text: string }> {
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
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Left null; the raw text is reported instead.
  }
  return { status: response.status, json, text };
}

const out = (line: string) => process.stdout.write(`${line}\n`);

// --- Step one: the public catalogue, so Irish codes come from the operator ---
const catalogue = await fetch(`${BASE}/route`, {
  headers: { accept: "application/json", "user-agent": UA },
});
out(`GET /route -> HTTP ${catalogue.status}`);
const cataloguePayload: unknown = await catalogue.json();

const ports = collectPorts(cataloguePayload);
out(`\nports in the catalogue (${ports.size}):`);
for (const [code, name] of [...ports].sort(([a], [b]) => a.localeCompare(b))) {
  out(`  ${code}  ${name}`);
}

const irish = [...ports.keys()].filter((code) => code.startsWith("IE"));
const british = [...ports.keys()].filter((code) => code.startsWith("GB"));
const spanish = [...ports.keys()].filter((code) => code.startsWith("ES"));
out(`\nSpanish: ${spanish.join(", ") || "none"}`);
out(`British: ${british.join(", ") || "none"}`);
out(`Irish:   ${irish.join(", ") || "none found — no Spain-to-Ireland route in the catalogue"}`);

// --- Step two: which of those crossings actually sail in the window ---
const destinations = [...british, ...irish];
out(`\nTesting ${spanish.length} x ${destinations.length} crossings out of Spain, 5-20 Dec 2026\n`);

for (const from of spanish) {
  for (const to of destinations) {
    let crossings_total = 0;
    let sailings = 0;
    let petCabins = 0;
    let anyPetSpace = 0;
    let errored = 0;
    const notes: string[] = [];

    for (const window of WINDOWS) {
      const { status, json, text } = await post("/crossing/prices", {
        bookingReference: null,
        pets: { smallDogs: 1, largeDogs: 0, cats: 0 },
        passengers: { adults: 2, children: 0, infants: 0 },
        vehicle: {
          type: "CAR",
          registrations: ["TBC"],
          height: 183,
          length: 500,
          extras: { rearMountedBikeCarrier: null },
        },
        departurePort: from,
        arrivalPort: to,
        disability: null,
        direction: "outbound",
        fromDate: window.fromDate,
        toDate: window.toDate,
      });

      if (status !== 200) {
        errored += 1;
        notes.push(`HTTP ${status} ${text.slice(0, 80).replace(/\s+/g, " ")}`);
        continue;
      }
      const crossings = asRecord(json)?.crossings;
      if (!Array.isArray(crossings)) continue;
      // crossings is a list of DATE BUCKETS, not sailings: the sailing sits at
      // crossings[].prices[].crossingPrices. Counting the buckets and looking
      // for petAvailabilities on them found nothing and reported "no sailings"
      // for a route that has six. So the extraction is no longer hand-rolled
      // here — extractCandidates walks the payload whatever its depth and is
      // covered by the provider's own tests.
      crossings_total += crossings.length;
      for (const sailing of extractCandidates(json)) {
        sailings += 1;
        if (petCabinAvailable(sailing)) petCabins += 1;
        const pets = asRecord(sailing.petAvailabilities);
        if (pets && Object.values(pets).some((flag) => flag === true)) anyPetSpace += 1;
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    // Never let an error or a missing pet block masquerade as "no sailings".
    const summary =
      crossings_total === 0 && errored === WINDOWS.length
        ? `every window errored — nothing learned`
        : `${crossings_total} date bucket(s), ${sailings} sailing(s); ` +
          `${petCabins} with a pet cabin, ${anyPetSpace} with any pet space` +
          (errored > 0 ? `; ${errored}/${WINDOWS.length} window(s) errored` : "");
    out(`${from} -> ${to}: ${summary}${notes.length ? `  [${notes.join("; ")}]` : ""}`);
  }
}

// --- Step three: is "no sailings" real, or is `direction` wrong? ---
//
// The outbound leg (Portsmouth -> Santander) returns sailings on these very
// dates, and the ship has to come back, so "no sailings" for the return leg
// is suspicious rather than credible. The likeliest cause is `direction`:
// every request above sends "outbound", which may be meaningless on a
// Spain-departure query. A wrong value here returns an empty list that is
// indistinguishable from a route that does not run — the same trap as a
// guessed port code. So test the alternatives rather than believe the zero.
out("\n--- direction variants on the return leg, 5-11 Dec ---");

const directionVariants: { label: string; value: string | null | undefined }[] = [
  { label: '"outbound" (what the monitor sends)', value: "outbound" },
  { label: '"inbound"', value: "inbound" },
  { label: '"return"', value: "return" },
  { label: "omitted entirely", value: undefined },
  { label: "null", value: null },
];

for (const from of spanish) {
  for (const to of british) {
    for (const variant of directionVariants) {
      const body: Record<string, unknown> = {
        bookingReference: null,
        pets: { smallDogs: 1, largeDogs: 0, cats: 0 },
        passengers: { adults: 2, children: 0, infants: 0 },
        vehicle: {
          type: "CAR",
          registrations: ["TBC"],
          height: 183,
          length: 500,
          extras: { rearMountedBikeCarrier: null },
        },
        departurePort: from,
        arrivalPort: to,
        disability: null,
        fromDate: "2026-12-05T00:00:00",
        toDate: "2026-12-11T23:59:59",
      };
      if (variant.value !== undefined) body.direction = variant.value;

      const { status, json, text } = await post("/crossing/prices", body);
      const crossings = asRecord(json)?.crossings;
      const count = Array.isArray(crossings) ? crossings.length : -1;
      const detail =
        status !== 200
          ? `HTTP ${status} ${text.slice(0, 90)}`
          : count < 0
            ? "200 but no crossings array"
            : `${count} sailing(s)`;
      out(`${from} -> ${to}  direction ${variant.label}: ${detail}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

// --- Step four: what a return-leg crossing actually contains ---
//
// Santander to Portsmouth has crossings in the window but none of them was
// counted, which means the payload carries no petAvailabilities block at all
// on that leg — a different thing from the block being present with every
// flag false. Print one whole crossing so that is a fact rather than an
// inference.
out("\n--- one whole Santander -> Portsmouth crossing, 5-11 Dec ---");
const returnLeg = await post("/crossing/prices", {
  bookingReference: null,
  pets: { smallDogs: 1, largeDogs: 0, cats: 0 },
  passengers: { adults: 2, children: 0, infants: 0 },
  vehicle: {
    type: "CAR",
    registrations: ["TBC"],
    height: 183,
    length: 500,
    extras: { rearMountedBikeCarrier: null },
  },
  departurePort: "ESSDR",
  arrivalPort: "GBPME",
  disability: null,
  direction: "outbound",
  fromDate: "2026-12-05T00:00:00",
  toDate: "2026-12-11T23:59:59",
});
if (returnLeg.status !== 200) {
  out(`HTTP ${returnLeg.status}: ${returnLeg.text.slice(0, 200)}`);
} else {
  const crossings = asRecord(returnLeg.json)?.crossings;
  out(JSON.stringify(Array.isArray(crossings) ? crossings : returnLeg.json, null, 2).slice(0, 4000));
}
