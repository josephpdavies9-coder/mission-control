/**
 * Which Spain-to-Ireland (and Spain-to-UK) crossings sail 5-20 Dec 2026, and
 * do any carry a pet cabin.
 *
 * Ireland is absent from the UK catalogue but present on the Irish, French and
 * Spanish ones: IEROE (Rosslare) and IEORK (Cork). The Spanish host publishes
 * exactly the set a Spain-departure traveller needs — ESBIO, ESSDR, GBPLY,
 * GBPME, IEROE — so it is the natural host for a homebound watch, but that has
 * to be demonstrated rather than assumed: a host may list a port and still
 * refuse or empty-answer a query for it.
 *
 * Extraction is the provider's own tested code, not a fresh parser. The
 * payload nests sailings at crossings[].prices[].crossingPrices, and
 * hand-rolling that in a probe produced three wrong findings already.
 *
 * Run: pnpm exec tsx scripts/probe-ireland-routes.ts
 */

import { extractCandidates, petCabinAvailable } from "../src/providers/brittany-ferries/api.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HOSTS = [
  { name: "es", host: "www.brittany-ferries.es" },
  { name: "ie", host: "www.brittany-ferries.ie" },
];

const PAIRS = [
  { from: "ESSDR", to: "IEROE", label: "Santander -> Rosslare" },
  { from: "ESBIO", to: "IEROE", label: "Bilbao -> Rosslare" },
  { from: "ESSDR", to: "IEORK", label: "Santander -> Cork" },
  { from: "ESBIO", to: "IEORK", label: "Bilbao -> Cork" },
  // Included as a control: the UK host says this one has six date buckets of
  // sailings, so a host that returns nothing for it is answering differently
  // rather than reporting an empty timetable.
  { from: "ESSDR", to: "GBPME", label: "Santander -> Portsmouth (control)" },
];

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

const out = (line: string) => process.stdout.write(`${line}\n`);

for (const { name, host } of HOSTS) {
  out(`\n===== ${host} =====`);
  for (const pair of PAIRS) {
    let buckets = 0;
    let sailings = 0;
    let petCabins = 0;
    let anyPetSpace = 0;
    let errored = 0;
    let currency = "";
    const notes: string[] = [];
    const examples: string[] = [];

    for (const window of WINDOWS) {
      const response = await fetch(`https://${host}/api/bebop/v1/crossing/prices`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
          "user-agent": UA,
        },
        body: JSON.stringify({
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
          departurePort: pair.from,
          arrivalPort: pair.to,
          disability: null,
          direction: "outbound",
          fromDate: window.fromDate,
          toDate: window.toDate,
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        errored += 1;
        notes.push(`HTTP ${response.status} ${text.slice(0, 70).replace(/\s+/g, " ")}`);
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }

      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        errored += 1;
        notes.push("response was not JSON");
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }

      const root = asRecord(json);
      if (typeof root?.currency === "string") currency = root.currency;
      if (Array.isArray(root?.crossings)) buckets += root.crossings.length;

      for (const sailing of extractCandidates(json)) {
        sailings += 1;
        const pets = asRecord(sailing.petAvailabilities);
        const hasCabin = petCabinAvailable(sailing);
        if (hasCabin) petCabins += 1;
        if (pets && Object.values(pets).some((flag) => flag === true)) anyPetSpace += 1;
        if (examples.length < 4) {
          const when = asRecord(sailing.departureDateTime);
          examples.push(
            `${String(when?.date ?? "?")} ${String(when?.time ?? "")} ` +
              `${String(sailing.shipName ?? "?")} cabin=${hasCabin} ` +
              `pets=${pets ? Object.entries(pets).filter(([, v]) => v === true).map(([k]) => k).join("|") || "none" : "absent"}`,
          );
        }
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    out(
      `${pair.label.padEnd(34)} ${buckets} bucket(s), ${sailings} sailing(s), ` +
        `${petCabins} pet cabin, ${anyPetSpace} any pet space` +
        (currency ? `, ${currency}` : "") +
        (errored > 0 ? `, ${errored}/${WINDOWS.length} errored` : ""),
    );
    for (const example of examples) out(`    ${example}`);
    for (const note of notes) out(`    ! ${note}`);
  }
}
