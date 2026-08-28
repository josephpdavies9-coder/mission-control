import type { Watch } from "../../config.js";

/** A search URL turned back into a reusable template. */
export interface SearchUrlSuggestion {
  /** The real URL this was derived from. */
  sourceUrl: string;
  /** That URL with known values replaced by {placeholders}. */
  template: string;
  /** Placeholders successfully substituted. */
  substituted: string[];
  /** Placeholders whose value could not be found in the URL. */
  missing: string[];
  /** Every query parameter, so unmatched ones can be mapped by hand. */
  queryParams: [string, string][];
}

/**
 * The same date appears in URLs in wildly different formats, so try the
 * plausible renderings of `YYYY-MM-DD` rather than assuming one.
 */
export function dateVariants(isoDate: string): string[] {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return [isoDate];
  return [
    `${y}-${m}-${d}`,
    `${d}-${m}-${y}`,
    `${d}/${m}/${y}`,
    `${y}/${m}/${d}`,
    `${y}${m}${d}`,
    `${d}${m}${y}`,
    `${m}/${d}/${y}`,
  ];
}

/** Case-insensitive, URL-encoding-aware occurrence test. */
function findVariant(haystack: string, needle: string): string | null {
  const candidates = [needle, encodeURIComponent(needle)];
  const lower = haystack.toLowerCase();
  for (const candidate of candidates) {
    if (candidate && lower.includes(candidate.toLowerCase())) return candidate;
  }
  return null;
}

function replaceAllInsensitive(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.replace(new RegExp(escaped, "gi"), replacement);
}

/**
 * Templates one real URL. Only high-signal values are substituted — dates and
 * port names are distinctive enough to replace safely, whereas passenger counts
 * are bare digits that would corrupt unrelated parts of the URL, so those are
 * surfaced as query parameters for the user to map instead.
 */
export function templateUrl(url: string, watch: Watch): SearchUrlSuggestion {
  const targets: { placeholder: string; values: string[] }[] = [
    { placeholder: "{date}", values: dateVariants(watch.dateFrom) },
    { placeholder: "{from}", values: [watch.routeFrom] },
    { placeholder: "{to}", values: [watch.routeTo] },
  ];

  let template = url;
  const substituted: string[] = [];
  const missing: string[] = [];

  for (const { placeholder, values } of targets) {
    const hit = values.map((value) => findVariant(template, value)).find(Boolean);
    if (hit) {
      template = replaceAllInsensitive(template, hit, placeholder);
      substituted.push(placeholder);
    } else {
      missing.push(placeholder);
    }
  }

  let queryParams: [string, string][] = [];
  try {
    queryParams = [...new URL(url).searchParams.entries()];
  } catch {
    // A relative or malformed URL simply yields no parameter listing.
  }

  return { sourceUrl: url, template, substituted, missing, queryParams };
}

/**
 * Picks the page URL that looks most like the search the user performed —
 * the one where the most known values could be substituted.
 */
export function suggestSearchUrl(
  urls: string[],
  watch: Watch,
): SearchUrlSuggestion | null {
  let best: SearchUrlSuggestion | null = null;

  for (const url of urls) {
    const suggestion = templateUrl(url, watch);
    if (suggestion.substituted.length === 0) continue;
    if (
      !best ||
      suggestion.substituted.length > best.substituted.length ||
      // Prefer the longer URL on a tie: it carries more of the real search.
      (suggestion.substituted.length === best.substituted.length &&
        suggestion.sourceUrl.length > best.sourceUrl.length)
    ) {
      best = suggestion;
    }
  }

  return best;
}
