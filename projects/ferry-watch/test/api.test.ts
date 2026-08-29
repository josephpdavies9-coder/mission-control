import { describe, expect, it } from "vitest";
import {
  dateWindows,
  extractCandidates,
  petCabinAvailable,
  petCabinsFrom,
} from "../src/providers/brittany-ferries/api.js";

describe("dateWindows", () => {
  it("splits a range into seven-day windows", () => {
    const windows = dateWindows("2026-09-25", "2026-10-07");
    expect(windows).toHaveLength(2);
    expect(windows[0]?.fromDate).toBe("2026-09-25T00:00:00");
    expect(windows[0]?.toDate).toBe("2026-10-01T23:59:59");
    expect(windows[1]?.toDate).toBe("2026-10-07T23:59:59");
  });

  it("handles a single day", () => {
    expect(dateWindows("2026-09-25", "2026-09-25")).toHaveLength(1);
  });

  it("returns nothing for a reversed range", () => {
    expect(dateWindows("2026-10-07", "2026-09-25")).toEqual([]);
  });
});

describe("petCabinAvailable", () => {
  it("reads the flag from an object", () => {
    expect(petCabinAvailable({ petAvailabilities: { petCabinAvailable: true } })).toBe(true);
    expect(petCabinAvailable({ petAvailabilities: { petCabinAvailable: false } })).toBe(false);
  });

  it("reads the flag from an array of entries", () => {
    expect(
      petCabinAvailable({ petAvailabilities: [{ petCabinAvailable: false }, { petCabinAvailable: true }] }),
    ).toBe(true);
  });

  it("is false when the field is missing", () => {
    expect(petCabinAvailable({ shipName: "Salamanca" })).toBe(false);
  });
});

describe("extractCandidates", () => {
  it("finds sailings nested anywhere in the payload", () => {
    const payload = {
      data: { outbound: [{ shipName: "Salamanca", petAvailabilities: { petCabinAvailable: true } }] },
    };
    expect(extractCandidates(payload)).toHaveLength(1);
  });

  it("returns nothing for an unrelated payload", () => {
    expect(extractCandidates({ totally: { different: [1, 2] } })).toEqual([]);
  });
});

describe("petCabinsFrom", () => {
  it("keeps pet cabins with stock and converts the price to pence", () => {
    const payload = {
      accommodations: [
        { code: "PET4", description: "4 berth Pet Friendly Cabin", quantityAvailable: 2, price: 245 },
        { code: "IN2", description: "2 berth inside cabin", quantityAvailable: 9, price: 180 },
      ],
    };
    const options = petCabinsFrom(payload);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ code: "PET4", remaining: 2, price: 24500 });
  });

  it("drops a pet cabin with no stock", () => {
    const payload = {
      accommodations: [
        { code: "PET4", description: "Pet friendly cabin", quantityAvailable: 0, price: 245 },
      ],
    };
    expect(petCabinsFrom(payload)).toEqual([]);
  });

  it("matches the description case- and spacing-insensitively", () => {
    const payload = {
      accommodations: [{ code: "P", description: "PET  FRIENDLY  CABIN (4)", quantityAvailable: 1 }],
    };
    expect(petCabinsFrom(payload)).toHaveLength(1);
  });
});

// The shape below is copied from a live /crossing/prices response captured on
// a GitHub runner, not invented. Field names here are the whole point: an
// earlier version looked for a "departureDate" string that does not exist.
const LIVE_SAILING = {
  departureDateTime: { iso: "2026-09-25T21:00:00Z", date: "2026-09-25", time: "22:00" },
  arrivalDateTime: { iso: "2026-09-27T06:00:00Z", date: "2026-09-27", time: "08:00" },
  adjustedDepartureDateTime: {
    iso: "2026-09-25T21:00:00Z",
    date: "2026-09-25",
    time: "22:00",
  },
  departurePort: "GBPME",
  arrivalPort: "ESSDR",
  shipName: "Salamanca",
  shipType: "cruise",
  standardPrice: { amount: 334, economy: null, discounted: false },
  cabinPrice: { amount: 32, economy: 0, discounted: false },
  sailingId: 418542,
  full: false,
  isCabinSpaceFull: true,
  isSeatSpaceFull: false,
  isPetAllowed: true,
  isAccommodationMandatory: true,
  petAvailabilities: {
    kennelAvailable: false,
    smallKennelAvailable: true,
    petCabinAvailable: false,
    stayInCarAvailable: false,
    petAvailability: true,
  },
  wheelchairCabinsAvailable: false,
};

const LIVE_PRICES = { crossings: [LIVE_SAILING], currency: "GBP" };

describe("live payload shape", () => {
  it("finds the sailing under the crossings key", () => {
    expect(extractCandidates(LIVE_PRICES)).toHaveLength(1);
  });

  it("does not flag a sailing whose pet cabins are gone", () => {
    // petAvailability is true and smallKennelAvailable is true on this very
    // sailing. Neither is a pet cabin, and treating either as one would alert
    // on a kennel — the exact false positive this watcher exists to avoid.
    expect(petCabinAvailable(LIVE_SAILING)).toBe(false);
  });

  it("flags the same sailing once a pet cabin returns", () => {
    const returned = {
      ...LIVE_SAILING,
      petAvailabilities: { ...LIVE_SAILING.petAvailabilities, petCabinAvailable: true },
    };
    expect(petCabinAvailable(returned)).toBe(true);
  });
});
