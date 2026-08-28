import { describe, expect, it } from "vitest";
import {
  buildUrl,
  datesInRange,
  resolveSelectors,
  DEFAULT_SELECTORS,
} from "../src/providers/brittany-ferries/selectors.js";
import { suggestPattern } from "../src/providers/brittany-ferries/calibrate.js";

describe("buildUrl", () => {
  it("substitutes and encodes placeholders", () => {
    const url = buildUrl("https://x.test/?a={from}&b={date}", {
      from: "Santander/Port",
      date: "2026-09-12",
    });
    expect(url).toBe("https://x.test/?a=Santander%2FPort&b=2026-09-12");
  });

  it("renders a null placeholder as empty", () => {
    expect(buildUrl("https://x.test/?v={vehicle}", { vehicle: null })).toBe(
      "https://x.test/?v=",
    );
  });
});

describe("datesInRange", () => {
  it("is inclusive at both ends", () => {
    expect(datesInRange("2026-09-10", "2026-09-13")).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("handles a single day", () => {
    expect(datesInRange("2026-09-10", "2026-09-10")).toEqual(["2026-09-10"]);
  });

  it("caps a runaway range so one watch cannot hammer the site", () => {
    expect(datesInRange("2026-01-01", "2027-01-01", 7)).toHaveLength(7);
  });

  it("returns nothing for a reversed range", () => {
    expect(datesInRange("2026-09-13", "2026-09-10")).toEqual([]);
  });
});

describe("resolveSelectors", () => {
  it("falls back to the defaults", () => {
    expect(resolveSelectors({})).toEqual(DEFAULT_SELECTORS);
  });

  it("applies overrides and ignores unknown or empty keys", () => {
    const resolved = resolveSelectors({
      searchUrl: "https://custom.test/{date}",
      readySelector: "",
      nonsense: "x",
    });
    expect(resolved.searchUrl).toBe("https://custom.test/{date}");
    expect(resolved.readySelector).toBe(DEFAULT_SELECTORS.readySelector);
    expect(resolved).not.toHaveProperty("nonsense");
  });
});

describe("suggestPattern", () => {
  it("builds a regex from the endpoints that carried availability", () => {
    expect(suggestPattern(["https://x.test/api/v2/availability?a=1"])).toBe("(availability)");
  });

  it("falls back to matching everything when given nothing usable", () => {
    expect(suggestPattern(["not a url"])).toBe(".");
  });
});
