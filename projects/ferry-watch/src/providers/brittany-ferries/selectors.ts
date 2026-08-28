/**
 * Site-specific knobs for the Brittany Ferries booking flow.
 *
 * IMPORTANT: these defaults are a starting point, not verified fact. Brittany
 * Ferries publish no API and change their booking front end without notice, so
 * run `pnpm calibrate` on a machine that can reach the site — it records the
 * real search URL and the JSON endpoints the page calls, and prints the exact
 * overrides to paste into `browser.selectors` in your config.
 */
export interface SelectorPack {
  /**
   * Search URL. Placeholders are substituted from the watch:
   * {from} {to} {date} {passengers} {pets} {vehicle}
   */
  searchUrl: string;
  /** Only JSON responses whose URL matches this are parsed for availability. */
  responseUrlPattern: string;
  /** Optional: wait for this selector before considering the page settled. */
  readySelector: string;
  /** Optional: cookie-consent button dismissed before reading results. */
  consentSelector: string;
}

export const DEFAULT_SELECTORS: SelectorPack = {
  searchUrl:
    "https://www.brittany-ferries.co.uk/booking?departurePort={from}&arrivalPort={to}&outboundDate={date}&adults={passengers}&pets={pets}",
  responseUrlPattern: "(avail|sailing|crossing|search|fare|price|accommodation)",
  readySelector: "",
  consentSelector: "#onetrust-accept-btn-handler",
};

/** Merges user overrides over the defaults, ignoring unknown keys. */
export function resolveSelectors(
  overrides: Record<string, string>,
): SelectorPack {
  const resolved: SelectorPack = { ...DEFAULT_SELECTORS };
  for (const key of Object.keys(DEFAULT_SELECTORS) as (keyof SelectorPack)[]) {
    const value = overrides[key];
    if (typeof value === "string" && value.length > 0) resolved[key] = value;
  }
  return resolved;
}

/** Substitutes {placeholders} in a URL template, URL-encoding each value. */
export function buildUrl(
  template: string,
  values: Record<string, string | number | null>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === null || value === undefined
      ? ""
      : encodeURIComponent(String(value));
  });
}

/** Every date in an inclusive `YYYY-MM-DD` range. */
export function datesInRange(from: string, to: string, cap = 60): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  let cursor = Date.parse(`${from}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(end)) return dates;
  while (cursor <= end && dates.length < cap) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return dates;
}
