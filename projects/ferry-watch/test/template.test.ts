import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatPrice,
  renderAlert,
  renderFailureAlert,
} from "../src/notify/template.js";
import type { Offer } from "../src/types.js";

const offer: Offer = {
  key: "s1::PET4",
  sailingId: "s1",
  routeFrom: "Santander",
  routeTo: "Portsmouth",
  departAt: "2026-09-12T20:30:00",
  arriveAt: null,
  shipName: "Galicia",
  bookingUrl: "https://www.brittany-ferries.co.uk/book?x=1&y=2",
  option: {
    code: "PET4",
    label: "4-berth pet-friendly cabin",
    kind: "pet-friendly-cabin",
    available: true,
    remaining: 2,
    price: 24500,
    currency: "GBP",
  },
};

describe("formatPrice", () => {
  it("renders sterling from minor units", () => {
    expect(formatPrice(24500, "GBP")).toBe("£245.00");
  });

  it("renders euros", () => {
    expect(formatPrice(9900, "EUR")).toBe("€99.00");
  });

  it("says so when there is no price", () => {
    expect(formatPrice(null, "GBP")).toBe("price not shown");
  });
});

describe("escapeHtml", () => {
  it("neutralises markup from operator-supplied text", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).not.toContain("<img");
  });
});

describe("renderAlert", () => {
  const delta = {
    watchId: "w",
    watchLabel: "Santander to Portsmouth",
    appeared: [offer],
    disappeared: [],
  };

  it("puts the count and route in the subject", () => {
    const email = renderAlert([delta], "[ferry-watch]");
    expect(email.subject).toContain("[ferry-watch]");
    expect(email.subject).toContain("1 pet cabin available");
    expect(email.subject).toContain("Santander to Portsmouth");
  });

  it("pluralises correctly", () => {
    const two = { ...delta, appeared: [offer, { ...offer, key: "s2::PET4" }] };
    expect(renderAlert([two], "[x]").subject).toContain("2 pet cabins available");
  });

  it("includes the detail and a booking link in both bodies", () => {
    const email = renderAlert([delta], "[x]");
    expect(email.text).toContain("4-berth pet-friendly cabin");
    expect(email.text).toContain("£245.00");
    expect(email.text).toContain("(2 left)");
    expect(email.text).toContain("Galicia");
    expect(email.text).toContain(offer.bookingUrl as string);
    expect(email.html).toContain("Book");
  });

  it("escapes an operator label containing markup", () => {
    const nasty = {
      ...delta,
      appeared: [{ ...offer, option: { ...offer.option, label: "<script>x</script>" } }],
    };
    expect(renderAlert([nasty], "[x]").html).not.toContain("<script>");
  });

  it("lists sold-out offers when present", () => {
    const gone = { ...delta, appeared: [], disappeared: [offer] };
    const email = renderAlert([gone], "[x]");
    expect(email.text).toContain("No longer available");
  });
});

describe("renderFailureAlert", () => {
  it("says what broke and how to fix it", () => {
    const email = renderFailureAlert("Route", 3, "selector timeout", "[x]");
    expect(email.subject).toContain("check failing");
    expect(email.text).toContain("calibrate");
    expect(email.text).toContain("selector timeout");
  });
});
