import type { Offer, WatchDelta } from "../types.js";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const KIND_LABEL: Record<string, string> = {
  "pet-friendly-cabin": "Pet-friendly cabin",
  kennel: "Kennel",
  "pet-in-vehicle": "Pet stays in vehicle",
  "pet-deck": "Pet deck",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minor units to a display string, e.g. 12750 + GBP -> "£127.50". */
export function formatPrice(price: number | null, currency: string | null): string {
  if (price === null) return "price not shown";
  const symbol = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "";
  const major = (price / 100).toFixed(2);
  return symbol ? `${symbol}${major}` : `${major} ${currency ?? ""}`.trim();
}

/** "Fri 12 Sep 2026, 20:30" from an ISO local timestamp. */
export function formatDepart(iso: string): string {
  const date = new Date(`${iso.length <= 10 ? `${iso}T00:00:00` : iso}`);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
  return formatted.replace(",", "");
}

function offerLine(offer: Offer): string {
  const kind = KIND_LABEL[offer.option.kind] ?? offer.option.kind;
  const route = offer.routeFrom && offer.routeTo
    ? `${offer.routeFrom} -> ${offer.routeTo}`
    : "";
  const remaining =
    offer.option.remaining !== null ? ` (${offer.option.remaining} left)` : "";
  const ship = offer.shipName ? ` on ${offer.shipName}` : "";
  const price = formatPrice(offer.option.price, offer.option.currency);
  return `${formatDepart(offer.departAt)}${ship} — ${route} — ${kind}: ${offer.option.label}${remaining} — ${price}`;
}

/** Plain-text and HTML body for a set of newly-available offers. */
export function renderAlert(
  deltas: WatchDelta[],
  subjectPrefix: string,
): RenderedEmail {
  const appearing = deltas.filter((d) => d.appeared.length > 0);
  const total = appearing.reduce((sum, d) => sum + d.appeared.length, 0);
  const routeSummary = appearing
    .map((d) => d.watchLabel)
    .slice(0, 2)
    .join(", ");
  const more = appearing.length > 2 ? ` +${appearing.length - 2} more` : "";

  const subject =
    `${subjectPrefix} ${total} pet cabin${total === 1 ? "" : "s"} available` +
    (routeSummary ? ` — ${routeSummary}${more}` : "");

  const textParts: string[] = [
    "Pet-friendly availability found. These sell out fast — book direct with the operator.",
    "",
  ];
  const htmlParts: string[] = [
    `<p style="margin:0 0 16px">Pet-friendly availability found. These sell out fast — book direct with the operator.</p>`,
  ];

  for (const delta of appearing) {
    textParts.push(`## ${delta.watchLabel}`);
    htmlParts.push(
      `<h2 style="font:600 16px/1.3 system-ui,sans-serif;margin:24px 0 8px">${escapeHtml(delta.watchLabel)}</h2>`,
      `<ul style="margin:0;padding-left:20px;font:14px/1.6 system-ui,sans-serif">`,
    );
    for (const offer of delta.appeared) {
      textParts.push(`  - ${offerLine(offer)}`);
      if (offer.bookingUrl) textParts.push(`    ${offer.bookingUrl}`);
      const link = offer.bookingUrl
        ? ` <a href="${escapeHtml(offer.bookingUrl)}">Book</a>`
        : "";
      htmlParts.push(`<li>${escapeHtml(offerLine(offer))}${link}</li>`);
    }
    htmlParts.push(`</ul>`);
    textParts.push("");
  }

  const gone = deltas.filter((d) => d.disappeared.length > 0);
  if (gone.length > 0) {
    textParts.push("No longer available:");
    htmlParts.push(
      `<h2 style="font:600 16px/1.3 system-ui,sans-serif;margin:24px 0 8px">No longer available</h2><ul style="margin:0;padding-left:20px;font:14px/1.6 system-ui,sans-serif">`,
    );
    for (const delta of gone) {
      for (const offer of delta.disappeared) {
        textParts.push(`  - ${delta.watchLabel}: ${offer.option.label}`);
        htmlParts.push(
          `<li>${escapeHtml(delta.watchLabel)}: ${escapeHtml(offer.option.label)}</li>`,
        );
      }
    }
    htmlParts.push(`</ul>`);
    textParts.push("");
  }

  textParts.push("--", "Sent by ferry-watch, running on your own machine.");
  htmlParts.push(
    `<p style="margin:24px 0 0;color:#666;font:12px/1.5 system-ui,sans-serif">Sent by ferry-watch, running on your own machine.</p>`,
  );

  return {
    subject,
    text: textParts.join("\n"),
    html: wrapHtml(htmlParts.join("\n")),
  };
}

/** Email sent when a watch has failed repeatedly, so silence is never mistaken for "no availability". */
export function renderFailureAlert(
  watchLabel: string,
  failures: number,
  error: string,
  subjectPrefix: string,
): RenderedEmail {
  const subject = `${subjectPrefix} check failing — ${watchLabel}`;
  const text = [
    `The watch "${watchLabel}" has failed ${failures} times in a row.`,
    "",
    "No availability emails will be accurate until this is fixed — the operator's",
    "site has most likely changed. Re-run calibration:",
    "",
    "  pnpm calibrate",
    "",
    `Last error: ${error}`,
  ].join("\n");
  const html = wrapHtml(
    `<p style="font:14px/1.6 system-ui,sans-serif">The watch <strong>${escapeHtml(watchLabel)}</strong> has failed ${failures} times in a row.</p>` +
      `<p style="font:14px/1.6 system-ui,sans-serif">No availability emails will be accurate until this is fixed — the operator's site has most likely changed. Re-run <code>pnpm calibrate</code>.</p>` +
      `<pre style="background:#f5f5f5;padding:12px;border-radius:6px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(error)}</pre>`,
  );
  return { subject, text, html };
}

function wrapHtml(body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#fff;color:#111">${body}</body></html>`;
}
