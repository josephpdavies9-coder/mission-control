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

// Captured from a live /crossing/accommodations response. The two pet cabins
// the operator sells are codes 4E (inside) and 4N (outside), and the price is
// nested under unitCost — there is no flat price field anywhere in the payload.
const LIVE_ACCOMMODATIONS = {
  accommodationMandatory: true,
  currency: "GBP",
  accommodations: [
    {
      code: "4B",
      description: "Inside 4 berth cabin with ensuite facilities",
      unitCost: { amount: 154, economy: 0, discounted: false },
      quantityAvailable: 8,
    },
  ],
  petAccommodations: [
    {
      code: "4E",
      description: "Inside 4 berth pet friendly cabin with ensuite facilities",
      unitCost: { amount: 174, economy: 0, discounted: false },
      quantityAvailable: 5,
      extras: [
        {
          code: "BOTTLE_OF_WATER",
          description: "Water in cabin",
          unitCost: { amount: 5.5, economy: 0, discounted: false },
          quantityAvailable: 10,
        },
      ],
    },
    {
      code: "4N",
      description: "Outside 4 berth pet friendly cabin with ensuite facilities",
      unitCost: { amount: 194, economy: 0, discounted: false },
      quantityAvailable: 0,
    },
  ],
};

describe("live accommodations shape", () => {
  const found = petCabinsFrom(LIVE_ACCOMMODATIONS);

  it("keeps only the pet cabin that has stock", () => {
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("4E");
    expect(found[0]?.remaining).toBe(5);
  });

  it("reads the price out of unitCost", () => {
    // £174, in pence. A flat `price` lookup returned null here.
    expect(found[0]?.price).toBe(17_400);
  });

  it("ignores the ordinary cabin and the in-cabin extras", () => {
    // "Water in cabin" is a nested extra with stock, and the 4B cabin is
    // simply not pet friendly. Both walk past the same filter.
    expect(found.map((o) => o.label)).not.toContain("Water in cabin");
    expect(found.map((o) => o.code)).not.toContain("4B");
  });
});

// Joe's requirement, stated explicitly: cabins only, kennels are not an
// acceptable substitute. This is a regression guard, not a restatement of the
// tests above — it is the one rule most likely to be relaxed by accident,
// because the operator reports kennel space on the very same call and it is
// tempting to treat "some pet space" as a hit.
describe("kennels never produce an alert", () => {
  const KENNELS_BUT_NO_CABIN = {
    ...LIVE_SAILING,
    petAvailabilities: {
      kennelAvailable: true,
      smallKennelAvailable: true,
      petCabinAvailable: false,
      stayInCarAvailable: true,
      petAvailability: true,
    },
  };

  it("ignores a sailing offering only kennels, a car space and pet passage", () => {
    // Four of the five flags are true here. Only petCabinAvailable counts.
    expect(petCabinAvailable(KENNELS_BUT_NO_CABIN)).toBe(false);
  });

  it("never lifts a kennel out of an accommodations payload", () => {
    const withKennels = {
      currency: "GBP",
      petAccommodations: [
        {
          code: "KEN",
          description: "Kennel on pet deck",
          unitCost: { amount: 35, economy: 0, discounted: false },
          quantityAvailable: 12,
        },
        {
          code: "KENS",
          description: "Small kennel",
          unitCost: { amount: 25, economy: 0, discounted: false },
          quantityAvailable: 8,
        },
      ],
    };
    expect(petCabinsFrom(withKennels)).toEqual([]);
  });
});
