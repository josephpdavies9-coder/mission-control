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

## RESOLVED: the API answers directly, no browser needed

Everything above about needing a browser session is **wrong**, and the mistake
is worth recording because it was expensive.

`POST /api/bebop/v1/crossing` returns 405 "Method 'POST' is not supported".
I read that as "this endpoint family is GET-only" and stopped POSTing anywhere
under `/crossing`. That inference was unfounded: the 405 describes `/crossing`
itself, not its children. Two of its children take POST and answer freely —
no cookie, no session, no Cloudflare clearance, no browser:

```
POST /api/bebop/v1/crossing/prices
POST /api/bebop/v1/crossing/accommodations
```

That single wrong generalisation closed the correct branch and sent the work
through roughly fifteen cycles of Angular Material automation that were never
needed. A negative result about one path says nothing about paths beneath it.

### The two-step sequence

**Step one — which sailings even have pet cabins.** `/crossing/prices` takes a
date window and returns the sailings in it, each carrying a
`petAvailabilities.petCabinAvailable` flag:

```json
{
  "bookingReference": null,
  "pets": { "smallDogs": 1, "largeDogs": 0, "cats": 0 },
  "passengers": { "adults": 2, "children": 0, "infants": 0 },
  "vehicle": {
    "type": "CAR", "registrations": ["TBC"],
    "height": 183, "length": 500,
    "extras": { "rearMountedBikeCarrier": null }
  },
  "departurePort": "GBPME", "arrivalPort": "ESSDR",
  "disability": null, "direction": "outbound",
  "fromDate": "2026-09-25", "toDate": "2026-10-01"
}
```

**Step two — whether any are actually left.** For each flagged sailing,
`/crossing/accommodations` with `petCabinsNeeded: true`, plus the `shipName`
and `ticketTier` that step one supplied for that sailing. An accommodation
counts only when its name matches `/pet\s*friendly\s*cabin/i` **and**
`quantityAvailable > 0`.

The distinction between the two steps is the whole point. The step-one flag
means the ship *has* pet cabins, not that any remain unsold. Alerting on the
flag alone would produce a constant stream of false positives — which is
exactly the failure mode a pet-cabin watcher exists to avoid.

### The real payload shape (captured live, 29 Aug 2026)

`/crossing/prices` answers `{ crossings, currency }`. Each crossing:

```json
{
  "departureDateTime": { "iso": "2026-09-25T21:00:00Z", "date": "2026-09-25", "time": "22:00" },
  "arrivalDateTime":   { "iso": "2026-09-27T06:00:00Z", "date": "2026-09-27", "time": "08:00" },
  "departurePort": "GBPME", "arrivalPort": "ESSDR",
  "shipName": "Salamanca", "shipType": "cruise",
  "standardPrice": { "amount": 334 }, "flexiPrice": { "amount": 344 },
  "cabinPrice": { "amount": 32 },
  "sailingId": 418542,
  "isCabinSpaceFull": true, "isPetAllowed": true,
  "petAvailabilities": {
    "kennelAvailable": false, "smallKennelAvailable": true,
    "petCabinAvailable": false, "stayInCarAvailable": false,
    "petAvailability": true
  }
}
```

Three things here cost a bug each, and all three are now covered by tests
built from this exact payload:

**There is no `departureDate` field.** The date arrives as an object. Reading
it as a string produced `""`, and a sailing with no departure date was
skipped — so the accommodations call could never have fired even once a pet
cabin appeared. A watcher that silently skips the only event it exists for is
worse than one that crashes.

**`petAvailability` is a decoy.** It is a boolean *inside* `petAvailabilities`
and it is `true` on a sailing with no pet cabin. Anything keying off the name
alone alerts on kennels. Likewise `smallKennelAvailable: true` sits beside
`petCabinAvailable: false` on the same sailing — these flags are per-facility
stock, not ship capability.

**A key-presence test finds the same sailing twice**, because the inner
`petAvailabilities` object contains a key called `petAvailability`. A sailing
is now identified by having *structured* pet availability, not by a key name.

### /crossing/accommodations — verified end to end

The request is accepted only when `departureDate` is the sailing's **exact
departure instant, ISO with the trailing Z** — `"2027-05-10T20:45:00Z"`.
Midnight on the day, the Z-stripped form, a bare date and the nested object
were all rejected with 400 "Failed to read request". `ticketTier: "STANDARD"`
was never the problem. Established by probing eighteen body variants in a
single run rather than one per CI cycle.

The response is `{ accommodationMandatory, accommodations, currency,
discountType, globalExtras, petAccommodations }`. Brittany Ferries sell
exactly two pet cabins:

| Code | Description | Price |
|------|-------------|-------|
| `4E` | Inside 4 berth pet friendly cabin with ensuite facilities | £174 |
| `4N` | Outside 4 berth pet friendly cabin with ensuite facilities | £194 |

Each carries `quantityAvailable`, and it is genuinely per-sailing: `4N` showed
0, 2 and 6 across three sailings in the same week.

**The price is nested** under `unitCost: { amount, economy, discounted }`.
There is no flat `price` field anywhere in the payload, so reading one
returned null on every real cabin — an alert that omits the very price it went
looking for.

Pet cabins appear under `petAccommodations` and never duplicate into
`accommodations`, so walking the whole payload finds each exactly once. The
label filter still matters: `accommodations` holds ordinary cabins and every
cabin carries an `extras` array (champagne, water, lounge access) with its own
descriptions and stock, all of which walk past the same filter.

### Cabins only — kennels are not a substitute

Joe's requirement, and worth recording because the API makes the wrong thing
easy. `petAvailabilities` carries five flags, and on a sold-out sailing four of
them can be true while `petCabinAvailable` is false: kennels, small kennels,
stay-in-car and the catch-all `petAvailability`. Treating "some pet space" as a
hit would fire constantly and never mean anything.

Only `petCabinAvailable` counts, and only a `/pet friendly cabin/i` label with
`quantityAvailable > 0` survives the accommodations filter. A named regression
test covers both, since this is the rule most likely to be relaxed by accident.

### Current state of the route (29 Aug 2026)

Across all three UK→Spain crossings and the full 25 Sep – 7 Oct 2026 window:
**every sailing reports `petCabinAvailable: false`.** Kennels are available on
several; pet cabins on none. So "0 matching" is a true reading, not a parser
failure — and it is exactly the state the watcher exists to see change.

One consequence worth stating plainly: because nothing has ever been flagged,
`/crossing/accommodations` **has never actually run**. Its request shape came
from a paste and its response shape is unverified. That is why the second call
is treated as enrichment rather than a gate — a flagged sailing is reported
whether or not that call succeeds. Getting less detail in an alert is a small
cost; missing the alert entirely is not.

### Practical limits

Date windows are requested seven days at a time and paced 800ms apart, with
exponential backoff on 429 and 5xx. Port codes come from the public `/route`
catalogue (see above) and are unchanged.

### Credit

The two endpoint names came from a parallel attempt at the same problem by
Codex, working from the same brief. It POSTed to the sub-paths that I had
written off.

## A note on etiquette

This reads an undocumented internal API. It is not a documented, supported
interface and carries no promise of stability.
Keep the polling interval at an hour or more, keep date windows narrow, and
expect it to break when they redeploy. dog.boats did the same thing and
stopped offering alerts; that may well be why.
