> **Superseded — kept for the record.**
>
> This brief was written before the API was found, and describes the problem as
> it looked when browser automation seemed to be the only route. It is wrong
> about that, and about several details it states as established fact.
>
> What actually works is in [FINDINGS.md](./FINDINGS.md) and implemented in
> `src/providers/brittany-ferries/api.ts`. Read those instead. This file
> survives only because the parallel attempt it briefed is what found the two
> endpoints, and because the traps it lists are a fair record of what the
> problem looked like from inside the wrong approach.

# Build brief: pet-friendly ferry cabin alerts (independent attempt)

Build a tool that emails me as soon as a **pet-friendly cabin** becomes available
on any **UK → Spain** Brittany Ferries crossing.

Work autonomously. Do not stop to ask questions — make reasonable decisions,
state your assumptions in the README, and keep going until it works or you have
proven it cannot.

## The problem

Brittany Ferries pet cabins sell out and get released unpredictably. There is no
API. A site called dog.boats used to do this and dropped its email alerts.

## Requirements

1. Watch all three UK→Spain crossings for a configurable date window.
2. Email me **only when something new appears**. An offer already reported must
   not email again until a configurable re-notify window elapses.
3. Email me when the checker itself is **failing**. Silence must never be
   mistakable for "no cabins available".
4. Run unattended on a schedule with no always-on machine of mine (GitHub
   Actions is fine; the repo is public so minutes are free).
5. Secrets (SMTP password, my address) come from environment/secrets, never
   committed.
6. Include tests. Never hit the live site from a test.
7. Be a polite client: no more than hourly, narrow date windows, real
   User-Agent, no parallel hammering.

## What is already established — do not re-derive this

All verified against the live site from a GitHub Actions runner.

**Reachability.** GitHub runners reach www.brittany-ferries.co.uk normally:
HTTP 200, real page, no bot wall. Cloudflare fronts it and sets a
`__cfwaitingroom` cookie, so a queue is possible at peak.

**The only UK→Spain crossings, with the operator's own port codes** (from
`GET https://www.brittany-ferries.co.uk/api/bebop/v1/route`, which works with a
plain curl and needs no session):

| Route | From | To |
|---|---|---|
| Portsmouth to Santander | GBPME | ESSDR |
| Portsmouth to Bilbao | GBPME | ESBIO |
| Plymouth to Santander | GBPLY | ESSDR |

Others: GBPOO Poole, FROUI Caen, FRSML St Malo, FRCER Cherbourg, FRLEH Le Havre,
FRROS Roscoff.

**The internal API.** Base `https://www.brittany-ferries.co.uk/api/bebop/v1`.
`/route` returns 200. `/crossing` exists but returns an identical, contentless
500 to a bare call AND to every parameter-name guess tried:
`departurePort/arrivalPort/departureDate`, `departurePortCode/arrivalPortCode`,
`departure/arrival/date`, `from/to/date`, `origin/destination`,
`outboundDate`. It is GET-only (POST returns 405). Everything else 404s:
routes, port(s), schedule(s), timetable, sailing(s), crossings, availability,
accommodation(s), cabin(s), price(s), fare(s), search, quote, offer(s), booking,
basket, journey(s), trip, crossing/search, crossing/availability.

**Conclusion: stop guessing parameters.** The call must be observed being made
by the site's own JavaScript after a real search.

**The booking form** is at `/booking` (redirects to `/booking/trip`). Angular
Material. Confirmed structure:

- Trip-type radios, labels exactly `["Return trip", "One way"]`
- Route dropdown — form-field label "Outbound route"
- Passengers — "Number of passengers"
- Vehicle — "Type of travel" / "Please select"
- Pets — "Pets (max. 5)" / "No pet selected"
- Date input `[data-testid="outwardDate"]`, placeholder "Outbound date"
- Submit `[data-testid="submit"]`, text "Search sailings"
- Stepper `[data-testid="bf-stepper-header-cell-0..5"]`;
  **step index 2 is "CABINS & SEATS"** — where pet cabins are listed
- Cookie banner: `#onetrust-accept-btn-handler`

**Route option text** contains a Material icon ligature between the ports:
`Portsmoutharrow_right_altSantander`. Strip `arrow_right_alt` before matching.

## Traps already hit — avoid these, they each cost a cycle

1. **Ordinal ids are unstable.** Choosing "One way" removes the inbound date
   field, re-renders the form and renumbers every `mat-select`. `#mat-select-0`
   stops being the route. Select controls by their form-field label instead.
2. **Synthetic clicks do not populate mat-selects.** A click dispatched inside
   the page (`el.click()` via evaluate) opens the panel with zero options. Use a
   real driver-level click.
3. **Overlays go stale.** A mat-select panel that has not closed makes the next
   dropdown report the previous one's options — every dropdown then looks
   identical. Press Escape and poll until options leave the DOM before opening
   the next.
4. **Material datepickers discard uncommitted text.** Click, fill, then blur
   (Tab) before reading the value back. Try several formats and keep whichever
   the control retains.
5. **Never swallow click errors.** A caught exception and a genuinely empty
   dropdown look identical in logs. Report the exception.

## Definition of done

`check --dry-run` prints real sailings with real pet cabin options and prices
for a date window that has availability, twice in a row consistently. Then the
same run emails on first sight and stays silent on the second.

If you conclude it cannot be done, say so plainly and document exactly what you
tried and what the blocker is.
