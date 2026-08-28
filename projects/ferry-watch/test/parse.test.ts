import { describe, expect, it } from "vitest";
import {
  classifyPetKind,
  extractSailings,
  normaliseDateTime,
  toMinorUnits,
} from "../src/providers/brittany-ferries/parse.js";

const ctx = { routeFrom: "Santander", routeTo: "Portsmouth", bookingUrl: "https://x.test" };

describe("normaliseDateTime", () => {
  it("keeps ISO date-times in local time", () => {
    expect(normaliseDateTime("2026-09-12T20:30:00")).toBe("2026-09-12T20:30:00");
  });

  it("accepts a bare date", () => {
    expect(normaliseDateTime("2026-09-12")).toBe("2026-09-12T00:00:00");
  });

  it("accepts UK-format dates", () => {
    expect(normaliseDateTime("12/09/2026 20:30")).toBe("2026-09-12T20:30:00");
  });

  it("does not shift an ISO time into UTC", () => {
    expect(normaliseDateTime("2026-09-12T20:30:00+02:00")).toBe("2026-09-12T20:30:00");
  });

  it("rejects nonsense", () => {
    expect(normaliseDateTime("next tuesday")).toBeNull();
  });
});

describe("classifyPetKind", () => {
  it("recognises pet cabins", () => {
    expect(classifyPetKind("4-berth pet-friendly cabin")).toBe("pet-friendly-cabin");
  });

  it("recognises kennels", () => {
    expect(classifyPetKind("Onboard kennel (large dog)")).toBe("kennel");
  });

  it("recognises pets staying in the vehicle", () => {
    expect(classifyPetKind("Pet stays in vehicle")).toBe("pet-in-vehicle");
  });

  it("ignores options with no pet mention", () => {
    expect(classifyPetKind("2-berth inside cabin")).toBeNull();
  });

  it("does not mistake a reclining seat for a pet option", () => {
    expect(classifyPetKind("Reclining seat")).toBeNull();
  });
});

describe("toMinorUnits", () => {
  it("treats decimal prices as major units", () => {
    expect(toMinorUnits({ price: 127.5 })).toBe(12750);
  });

  it("respects keys that already name minor units", () => {
    expect(toMinorUnits({ pricePence: 12750 })).toBe(12750);
  });

  it("parses formatted strings", () => {
    expect(toMinorUnits({ totalPrice: "£245.00" })).toBe(24500);
  });

  it("returns null when no price is present", () => {
    expect(toMinorUnits({ label: "cabin" })).toBeNull();
  });
});

describe("extractSailings", () => {
  it("pulls sailings and pet cabins out of a nested payload", () => {
    const payload = {
      data: {
        crossings: [
          {
            id: "SDR-PME-0912",
            departureDateTime: "2026-09-12T20:30:00",
            arrivalDateTime: "2026-09-13T18:15:00",
            shipName: "Galicia",
            accommodation: [
              { code: "IN2", name: "2-berth inside cabin", available: true, price: 180 },
              {
                code: "PET4",
                name: "4-berth pet-friendly cabin",
                available: true,
                availableUnits: 2,
                price: 245,
                currency: "GBP",
              },
            ],
          },
        ],
      },
    };

    const [sailing, ...rest] = extractSailings(payload, ctx);
    expect(rest).toHaveLength(0);
    expect(sailing?.id).toBe("SDR-PME-0912");
    expect(sailing?.shipName).toBe("Galicia");
    expect(sailing?.departAt).toBe("2026-09-12T20:30:00");
    // The non-pet cabin must not be reported as a pet option.
    expect(sailing?.petOptions).toHaveLength(1);
    expect(sailing?.petOptions[0]).toMatchObject({
      code: "PET4",
      kind: "pet-friendly-cabin",
      available: true,
      remaining: 2,
      price: 24500,
      currency: "GBP",
    });
  });

  it("marks sold-out options unavailable rather than dropping them", () => {
    const payload = {
      sailings: [
        {
          id: "S1",
          departureDate: "2026-09-14T22:00:00",
          options: [{ code: "PET4", name: "Pet-friendly cabin", soldOut: true }],
        },
      ],
    };
    expect(extractSailings(payload, ctx)[0]?.petOptions[0]?.available).toBe(false);
  });

  it("treats a zero remaining count as unavailable", () => {
    const payload = {
      sailings: [
        {
          id: "S2",
          departureDate: "2026-09-14T22:00:00",
          options: [{ code: "PET4", name: "Pet-friendly cabin", availableUnits: 0 }],
        },
      ],
    };
    expect(extractSailings(payload, ctx)[0]?.petOptions[0]?.available).toBe(false);
  });

  it("returns nothing when a sailing has no pet accommodation", () => {
    const payload = {
      sailings: [
        {
          id: "S3",
          departureDate: "2026-09-14T22:00:00",
          options: [{ code: "IN2", name: "2-berth inside cabin", available: true }],
        },
      ],
    };
    expect(extractSailings(payload, ctx)).toEqual([]);
  });

  it("degrades to an empty list on an unrecognised schema", () => {
    expect(extractSailings({ totally: { different: [1, 2, 3] } }, ctx)).toEqual([]);
    expect(extractSailings(null, ctx)).toEqual([]);
    expect(extractSailings("not json", ctx)).toEqual([]);
  });

  it("survives deeply nested and cyclic-looking structures without hanging", () => {
    let nested: Record<string, unknown> = { departureDate: "2026-09-14" };
    for (let i = 0; i < 100; i += 1) nested = { child: nested };
    expect(() => extractSailings(nested, ctx)).not.toThrow();
  });
});
