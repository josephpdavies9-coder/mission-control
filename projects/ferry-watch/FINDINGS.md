# Brittany Ferries — what has actually been confirmed

Everything here was observed from a GitHub Actions runner against the live
site, not inferred. Dates are 2026-08-28.

## Reachability

A GitHub runner reaches the site normally: HTTP 200, real page
("Cross Channel Ferries to France & Spain"), ~539 KB of HTML, no bot wall.
Cloudflare fronts it and sets a `__cfwaitingroom` cookie, so a queue is
possible at peak but was not hit.

This matters: it means the watch can run in CI, with no always-on machine.

## Routes and port codes — confirmed

From the operator's own catalogue at `/api/bebop/v1/route`:

| Route | Departure | Arrival |
|---|---|---|
| Portsmouth to Santander | `GBPME` | `ESSDR` |
| Portsmouth to Bilbao | `GBPME` | `ESBIO` |
| Plymouth to Santander | `GBPLY` | `ESSDR` |

These are the **only** UK-to-Spain crossings Brittany Ferries operate.
Other codes seen: `GBPOO` Poole, `FROUI` Caen, `FRSML` St Malo,
`FRCER` Cherbourg, `FRLEH` Le Havre, `FRROS` Roscoff.

## The internal API — partially mapped

Base: `https://www.brittany-ferries.co.uk/api/bebop/v1`

| Endpoint | Result |
|---|---|
| `/route` | **200** — the route catalogue above |
| `/crossing` | **500** on every call — exists, but rejects everything tried |
| everything else tried | 404 |

Tried and 404: `routes`, `port(s)`, `schedule(s)`, `timetable`, `sailing(s)`,
`crossings`, `availability`, `available`, `accommodation(s)`, `cabin(s)`,
`price(s)`, `fare(s)`, `search`, `quote`, `crossing/search`,
`crossing/availability`, `offer(s)`, `booking`, `basket`, `journey(s)`, `trip`.

`/crossing` is GET-only (POST returns 405 "Method 'POST' is not supported").
Its 500 body is a generic Spring error — `{"status":500,"error":"Internal
Server Error","message":"text","path":"/v1/crossing"}` — identical for a bare
call and for every parameter-name guess:

    departurePort / arrivalPort / departureDate
    departurePortCode / arrivalPortCode / departureDate
    departure / arrival / date
    from / to / date
    origin / destination / departureDate
    departurePort / arrivalPort / outboundDate

An unchanging, contentless 500 tells us nothing about what it wants. It is
most likely missing a header, session cookie, or offer/tariff identifier that
the Angular front end holds.

## What this means for the next step

Guessing is exhausted. The parameters must be **observed**: perform a real
search and capture the request the site's own JavaScript makes. Two ways:

1. **`pnpm exec tsx src/cli.ts calibrate --record`** on any machine with a
   browser. Two minutes, and it captures the exact call. This is by far the
   fastest route if a laptop is available.
2. **Drive the booking form headlessly in CI.** Same result, no laptop, but it
   needs selector work against an Angular form that changes without notice.

Until one of those happens, no availability can be read, and the watch will
report failures rather than silently claiming there are no cabins.

## How dog.boats did it — observed from their live site

Fetched from a GitHub runner on 2026-08-29.

**Confirmed:**

- The page is **28 KB of static HTML**, served 200.
- Its **only** `<script>` is Google Analytics (`gtag`). There is no application
  JavaScript, no `fetch(`, no `/api/...` path, and no backend hostname
  (no Firebase, Supabase, workers.dev, AWS) anywhere in the page.
- It links to `brittany-ferries` 63 times — outbound links, not API calls.
- Its CSS defines `.vpnAlert` (an orange `#FF9900` banner), `.vpnBlock` and
  `.vpnMsg`.
- Its privacy policy collects **email addresses** and describes account
  registration and authentication — the alerts service it used to run.

**What follows from that:**

dog.boats did **not** find a clean public API, and did not query the operator
from the browser. Availability was **pre-rendered server-side**: a backend job
they ran queried Brittany Ferries on a schedule and baked the results into
static HTML. That is the same architecture as ferry-watch — a backend poller —
so there is no shortcut here that we have missed.

The VPN banner is the interesting part. They evidently had to warn users about,
or work around, IP and geography affecting what the operator returns.

**What that says about our 500s:**

`/route` answers a bare `curl` because it is a public catalogue. `/crossing`
refuses every bare call regardless of parameters. Together with the VPN
messaging, the likely explanation is that `/crossing` needs a **real browser
session** — Cloudflare clearance plus whatever offer/tariff context the Angular
app establishes — rather than any particular parameter spelling.

So the next step is not more parameter guessing. It is to establish a session
in the browser and let the page make the availability call itself: drive the
booking form headlessly, exactly as `calibrate --record` does with a human.

**The sobering part:** dog.boats ran this for years and then stopped offering
email alerts, while keeping the site up. That is the best available evidence of
what this costs to maintain.

## A note on etiquette

This reads an undocumented internal API and drives a public booking site.
Keep the polling interval at an hour or more, keep date windows narrow, and
expect it to break when they redeploy. dog.boats did the same thing and
stopped offering alerts; that may well be why.
