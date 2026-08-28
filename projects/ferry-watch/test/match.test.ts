import { describe, expect, it } from "vitest";
import { matchOffers, sortOffers, toOffers } from "../src/match.js";
import { ConfigSchema, type Watch } from "../src/config.js";
import type { PetOption, Sailing } from "../src/types.js";

function watch(overrides: Partial<Watch> = {}): Watch {
  const config = ConfigSchema.parse({
    email: {
      from: "a@b.test",
      to: ["c@d.test"],
      delivery: { transport: "console" },
    },
    watches: [
      {
        id: "w",
        label: "W",
        routeFrom: "Santander",
        routeTo: "Portsmouth",
        dateFrom: "2026-09-10",
        dateTo: "2026-09-20",
        ...overrides,
      },
    ],
  });
  return config.watches[0] as Watch;
}

function petOption(overrides: Partial<PetOption> = {}): PetOption {
  return {
    code: "PET4",
    label: "Pet-friendly cabin",
    kind: "pet-friendly-cabin",
    available: true,
    remaining: 2,
    price: 24500,
    currency: "GBP",
    ...overrides,
  };
}

function sailing(departAt: string, options: PetOption[]): Sailing {
  return {
    id: `s-${departAt}`,
    routeFrom: "Santander",
    routeTo: "Portsmouth",
    departAt,
    arriveAt: null,
    shipName: "Galicia",
    petOptions: options,
    bookingUrl: null,
  };
}

describe("matchOffers", () => {
  it("keeps an available pet cabin inside the date window", () => {
    const offers = toOffers([sailing("2026-09-12T20:30:00", [petOption()])]);
    expect(matchOffers(watch(), offers)).toHaveLength(1);
  });

  it("drops unavailable options", () => {
    const offers = toOffers([
      sailing("2026-09-12T20:30:00", [petOption({ available: false })]),
    ]);
    expect(matchOffers(watch(), offers)).toEqual([]);
  });

  it("drops sailings outside the date window", () => {
    const offers = toOffers([sailing("2026-10-01T20:30:00", [petOption()])]);
    expect(matchOffers(watch(), offers)).toEqual([]);
  });

  it("includes the boundary dates", () => {
    const offers = toOffers([
      sailing("2026-09-10T08:00:00", [petOption()]),
      sailing("2026-09-20T23:00:00", [petOption()]),
    ]);
    expect(matchOffers(watch(), offers)).toHaveLength(2);
  });

  it("drops kinds the watch did not ask for", () => {
    const offers = toOffers([
      sailing("2026-09-12T20:30:00", [petOption({ kind: "kennel", code: "KEN" })]),
    ]);
    expect(matchOffers(watch(), offers)).toEqual([]);
    expect(matchOffers(watch({ wantKinds: ["kennel"] }), offers)).toHaveLength(1);
  });

  it("honours the departure time window", () => {
    const offers = toOffers([
      sailing("2026-09-12T07:00:00", [petOption()]),
      sailing("2026-09-12T20:30:00", [petOption()]),
    ]);
    const filtered = matchOffers(watch({ departAfter: "18:00" }), offers);
    expect(filtered.map((o) => o.departAt)).toEqual(["2026-09-12T20:30:00"]);
  });

  it("drops offers above the price ceiling", () => {
    const offers = toOffers([sailing("2026-09-12T20:30:00", [petOption({ price: 30000 })])]);
    expect(matchOffers(watch({ maxPrice: 25000 }), offers)).toEqual([]);
  });

  it("keeps an offer whose price the operator did not disclose", () => {
    const offers = toOffers([sailing("2026-09-12T20:30:00", [petOption({ price: null })])]);
    expect(matchOffers(watch({ maxPrice: 25000 }), offers)).toHaveLength(1);
  });
});

describe("sortOffers", () => {
  it("orders by departure, then price", () => {
    const offers = toOffers([
      sailing("2026-09-14T20:30:00", [petOption()]),
      sailing("2026-09-12T20:30:00", [
        petOption({ code: "B", price: 30000 }),
        petOption({ code: "A", price: 20000 }),
      ]),
    ]);
    expect(sortOffers(offers).map((o) => o.option.code)).toEqual(["A", "B", "PET4"]);
  });
});

describe("toOffers", () => {
  it("gives every option a key unique to its sailing", () => {
    const offers = toOffers([
      sailing("2026-09-12T20:30:00", [petOption({ code: "A" }), petOption({ code: "B" })]),
    ]);
    expect(new Set(offers.map((o) => o.key)).size).toBe(2);
  });
});
