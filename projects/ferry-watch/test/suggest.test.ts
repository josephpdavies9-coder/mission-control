import { describe, expect, it } from "vitest";
import { dateVariants, suggestSearchUrl, templateUrl } from "../src/providers/brittany-ferries/suggest.js";
import { ConfigSchema, type Watch } from "../src/config.js";

const watch: Watch = ConfigSchema.parse({
  email: { from: "a@b.test", to: ["c@d.test"], delivery: { transport: "console" } },
  watches: [
    {
      id: "w",
      label: "W",
      routeFrom: "Santander",
      routeTo: "Portsmouth",
      dateFrom: "2026-09-25",
      dateTo: "2026-10-07",
      passengers: 2,
      pets: 1,
    },
  ],
}).watches[0] as Watch;

describe("dateVariants", () => {
  it("covers the formats booking sites actually use", () => {
    const variants = dateVariants("2026-09-25");
    expect(variants).toContain("2026-09-25");
    expect(variants).toContain("25/09/2026");
    expect(variants).toContain("20260925");
    expect(variants).toContain("25-09-2026");
  });
});

describe("templateUrl", () => {
  it("replaces ports and an ISO date with placeholders", () => {
    const result = templateUrl(
      "https://x.test/book?from=Santander&to=Portsmouth&date=2026-09-25",
      watch,
    );
    expect(result.template).toBe("https://x.test/book?from={from}&to={to}&date={date}");
    expect(result.substituted).toEqual(["{date}", "{from}", "{to}"]);
    expect(result.missing).toEqual([]);
  });

  it("handles a UK-formatted date", () => {
    const result = templateUrl("https://x.test/?d=25%2F09%2F2026", watch);
    expect(result.template).toContain("{date}");
  });

  it("matches ports case-insensitively", () => {
    const result = templateUrl("https://x.test/?from=SANTANDER", watch);
    expect(result.template).toBe("https://x.test/?from={from}");
  });

  it("replaces every occurrence of a value", () => {
    const result = templateUrl(
      "https://x.test/Santander/out?port=Santander",
      watch,
    );
    expect(result.template).toBe("https://x.test/{from}/out?port={from}");
  });

  it("reports what it could not find instead of guessing", () => {
    const result = templateUrl("https://x.test/book?routeCode=SDR-PME", watch);
    expect(result.missing).toEqual(["{date}", "{from}", "{to}"]);
  });

  it("lists query parameters so unmatched ones can be mapped by hand", () => {
    const result = templateUrl("https://x.test/book?adults=2&pets=1", watch);
    expect(result.queryParams).toEqual([
      ["adults", "2"],
      ["pets", "1"],
    ]);
  });

  it("leaves bare passenger digits alone rather than corrupting the URL", () => {
    // "2" appears in the host and the path; substituting it would be destructive.
    const result = templateUrl("https://x2.test/v2/book?adults=2", watch);
    expect(result.template).toContain("x2.test/v2/book");
  });
});

describe("suggestSearchUrl", () => {
  it("picks the URL carrying the most of the search", () => {
    const suggestion = suggestSearchUrl(
      [
        "https://x.test/",
        "https://x.test/book?from=Santander",
        "https://x.test/book?from=Santander&to=Portsmouth&date=2026-09-25",
      ],
      watch,
    );
    expect(suggestion?.substituted).toHaveLength(3);
  });

  it("prefers the longer URL when two carry equal information", () => {
    const suggestion = suggestSearchUrl(
      ["https://x.test/?from=Santander", "https://x.test/?from=Santander&step=2"],
      watch,
    );
    expect(suggestion?.sourceUrl).toContain("step=2");
  });

  it("returns null when nothing resembles the search", () => {
    expect(suggestSearchUrl(["https://x.test/", "https://x.test/about"], watch)).toBeNull();
  });

  it("ignores a malformed URL without throwing", () => {
    expect(() => suggestSearchUrl(["not a url", "Santander"], watch)).not.toThrow();
  });
});
