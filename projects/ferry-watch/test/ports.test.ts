import { describe, expect, it } from "vitest";
import { PORT_CODES, toPortCode, UK_TO_SPAIN } from "../src/providers/brittany-ferries/ports.js";

describe("toPortCode", () => {
  it("maps port names to the operator's codes", () => {
    expect(toPortCode("Portsmouth")).toBe("GBPME");
    expect(toPortCode("Santander")).toBe("ESSDR");
    expect(toPortCode("Bilbao")).toBe("ESBIO");
    expect(toPortCode("Plymouth")).toBe("GBPLY");
  });

  it("is case and whitespace insensitive", () => {
    expect(toPortCode("  sAnTaNdEr ")).toBe("ESSDR");
  });

  it("passes a code straight through", () => {
    expect(toPortCode("ESSDR")).toBe("ESSDR");
  });

  it("upper-cases an unknown value rather than failing", () => {
    expect(toPortCode("nowhere")).toBe("NOWHERE");
  });
});

describe("UK_TO_SPAIN", () => {
  it("lists exactly the three crossings the operator runs", () => {
    expect(UK_TO_SPAIN).toHaveLength(3);
    for (const route of UK_TO_SPAIN) {
      expect(route.from).toMatch(/^GB/);
      expect(route.to).toMatch(/^ES/);
      expect(Object.values(PORT_CODES)).toContain(route.from);
      expect(Object.values(PORT_CODES)).toContain(route.to);
    }
  });
});
