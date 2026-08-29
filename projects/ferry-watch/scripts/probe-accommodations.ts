/**
 * Finds the request shape /crossing/accommodations actually accepts.
 *
 * It answers 400 "Failed to read request" to the body we send — a
 * deserialisation failure, so some field is the wrong type or missing rather
 * than merely having a bad value. Guessing one field per CI run is what made
 * the earlier browser work so expensive, so this tries every plausible variant
 * in a single run and reports which ones the operator accepts.
 *
 * Run: pnpm exec tsx scripts/probe-accommodations.ts
 */

const BASE = "https://www.brittany-ferries.co.uk/api/bebop/v1";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// A sailing confirmed to have a pet cabin, from a live /crossing/prices run.
const SAILING = {
  departurePort: "GBPME",
  arrivalPort: "ESSDR",
  shipName: "Santona",
  sailingId: 422969,
  date: "2027-05-10",
  iso: "2027-05-10T20:45:00Z",
};

const base: Record<string, unknown> = {
  bookingReference: null,
  departurePort: SAILING.departurePort,
  arrivalPort: SAILING.arrivalPort,
  departureDate: SAILING.date,
  passengers: { adults: 2, children: 0, infants: 0 },
  vehicle: {
    type: "CAR",
    registrations: ["TBC"],
    height: 183,
    length: 500,
    extras: { rearMountedBikeCarrier: null },
  },
  disability: null,
  petCabinsNeeded: true,
  ticketTier: "STANDARD",
  pets: { smallDogs: 1, largeDogs: 0, cats: 0 },
  shipName: SAILING.shipName,
  direction: "outbound",
};

const omit = (body: Record<string, unknown>, key: string) => {
  const copy = { ...body };
  delete copy[key];
  return copy;
};

const variants: { name: string; body: Record<string, unknown> }[] = [
  { name: "as-sent (baseline)", body: base },

  // The prices call rejects bare dates and needs "YYYY-MM-DDTHH:MM:SS", so
  // the same convention is the single most likely fix here.
  { name: "departureDate midnight datetime", body: { ...base, departureDate: `${SAILING.date}T00:00:00` } },
  { name: "departureDate sailing datetime", body: { ...base, departureDate: SAILING.iso.replace("Z", "") } },
  { name: "departureDate full iso with Z", body: { ...base, departureDate: SAILING.iso } },
  { name: "departureDate as object", body: { ...base, departureDate: { iso: SAILING.iso, date: SAILING.date, time: "21:45" } } },

  // The prices response names four fares: economy, standard, flexi, cabin.
  { name: "ticketTier null", body: { ...base, ticketTier: null } },
  { name: "ticketTier omitted", body: omit(base, "ticketTier") },
  { name: "ticketTier ECONOMY", body: { ...base, ticketTier: "ECONOMY" } },
  { name: "ticketTier FLEXI", body: { ...base, ticketTier: "FLEXI" } },
  { name: "ticketTier lowercase standard", body: { ...base, ticketTier: "standard" } },

  // Maybe the sailing is addressed by id rather than by ship and date.
  { name: "plus sailingId", body: { ...base, sailingId: SAILING.sailingId } },
  { name: "sailingId instead of shipName", body: { ...omit(base, "shipName"), sailingId: SAILING.sailingId } },

  { name: "shipName omitted", body: omit(base, "shipName") },
  { name: "petCabinsNeeded omitted", body: omit(base, "petCabinsNeeded") },
  { name: "direction omitted", body: omit(base, "direction") },
  { name: "bookingReference omitted", body: omit(base, "bookingReference") },

  // Combination of the two most likely single fixes.
  {
    name: "midnight datetime + ticketTier null",
    body: { ...base, departureDate: `${SAILING.date}T00:00:00`, ticketTier: null },
  },
  {
    name: "midnight datetime + sailingId",
    body: { ...base, departureDate: `${SAILING.date}T00:00:00`, sailingId: SAILING.sailingId },
  },
];

const succeeded: string[] = [];

for (const variant of variants) {
  let line: string;
  try {
    const response = await fetch(`${BASE}/crossing/accommodations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "accept-language": "en-GB",
        "user-agent": UA,
      },
      body: JSON.stringify(variant.body),
    });
    const text = await response.text();
    line = `${response.status} ${text.slice(0, 160)}`;
    if (response.ok) {
      succeeded.push(variant.name);
      // The response of the first working variant is the thing we came for.
      if (succeeded.length === 1) {
        process.stdout.write(`\n=== FIRST WORKING BODY: ${variant.name} ===\n`);
        process.stdout.write(`${JSON.stringify(variant.body, null, 2)}\n`);
        process.stdout.write(`=== ITS RESPONSE (first 6000 chars) ===\n${text.slice(0, 6000)}\n\n`);
      }
    }
  } catch (error) {
    line = `threw ${(error as Error).message}`;
  }
  process.stdout.write(`${variant.name.padEnd(36)} ${line}\n`);
  // Considerate pacing — this is eighteen calls in a row.
  await new Promise((r) => setTimeout(r, 800));
}

process.stdout.write(
  `\nAccepted: ${succeeded.length > 0 ? succeeded.join(", ") : "none — every variant was rejected"}\n`,
);
