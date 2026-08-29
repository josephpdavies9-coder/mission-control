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
