# ferry-watch

A self-hosted replacement for [dog.boats](https://www.dog.boats/) — the
independent Brittany Ferries **pet-friendly cabin finder** — with the email
alerts it no longer offers.

Pet-friendly cabins on the Spain↔UK crossings are scarce and get released and
cancelled unpredictably. Refreshing the booking page yourself is the only way to
catch one. `ferry-watch` does the refreshing, remembers what it has already told
you about, and emails you the moment something new appears.

## What it does

- Watches any number of routes and date windows at once.
- Checks the operator the way a person would — a real browser walking the
  booking search, one page load per departure date, at a polite randomised pace.
- Emails you **only what is new**. An offer that was there last sweep does not
  email you again (configurable re-notify window, default 24h).
- Emails you when a watch has been **failing** repeatedly, so silence is never
  mistaken for "no cabins available".
- Runs entirely on your own machine. No account, no third party, no data leaves
  your laptop except the requests to the operator and your own SMTP relay.

## Quick start

```bash
cd projects/ferry-watch
pnpm install
pnpm exec playwright install chromium     # only needed for live checks

cp ferry-watch.config.example.json ferry-watch.config.json
$EDITOR ferry-watch.config.json           # set your email + routes + dates
```

Prove the plumbing works before pointing it at a real site:

```bash
# Full pipeline against a built-in fake operator, printing the email
pnpm exec tsx src/cli.ts check --provider mock --dry-run

# Prove your SMTP credentials actually deliver
export FERRY_WATCH_SMTP_PASSWORD='your-app-password'
pnpm exec tsx src/cli.ts test-email
```

Then run it for real:

```bash
pnpm exec tsx src/cli.ts check     # one sweep, then exit — good for cron
pnpm exec tsx src/cli.ts watch     # long-running loop
```

## Commands

| Command | What it does |
|---|---|
| `check` | One sweep. Emails anything new, saves state, exits. Exit code 1 if every watch failed. |
| `watch` | Sweeps forever at `polling.intervalMinutes` (plus jitter). |
| `calibrate` | Records what the booking site actually returns — see below. |
| `test-email` | Sends a sample alert so you can confirm delivery. |

Options: `--config <path>`, `--only <ids>`, `--provider <id>`, `--dry-run`, `--quiet`.

## Calibration — read this before trusting a live run

**Brittany Ferries publish no API**, and they change their booking front end
without notice. `ferry-watch` therefore reads availability out of the JSON their
own booking pages fetch, using deliberately shape-tolerant parsing rather than
one hard-coded schema.

The search URL and response pattern shipped in
`src/providers/brittany-ferries/selectors.ts` are a **starting point, not
verified fact** — they were written without live access to the site. Before you
rely on this, calibrate it:

```bash
pnpm exec tsx src/cli.ts calibrate
```

This opens the booking search for your first watch, captures every JSON response
the page fetches, writes them to `./calibration/`, reports which ones contained
recognisable pet availability, and prints the config to paste into
`browser.selectors`. If nothing is found, set `"headless": false` and re-run to
watch what the page actually does.

Once `check` returns sailings, you are calibrated. If the site later changes,
the consecutive-failure alert will email you rather than leaving you in silence.

## Configuration

See `ferry-watch.config.example.json`. Notable fields:

| Field | Meaning |
|---|---|
| `watches[].routeFrom` / `routeTo` | Port names as the operator's URL expects them. |
| `watches[].dateFrom` / `dateTo` | Inclusive departure window. One page load per day in range (capped at 60). |
| `watches[].departAfter` / `departBefore` | Only alert on sailings in this daily time window. |
| `watches[].wantKinds` | `pet-friendly-cabin`, `kennel`, `pet-in-vehicle`, `pet-deck`. |
| `watches[].maxPrice` | Ceiling in **pence**. Offers with no disclosed price are always kept. |
| `alerts.renotifyAfterHours` | How long before a still-available offer is worth mentioning again. |
| `alerts.notifyOnDisappear` | Also email when something you were told about sells out. |
| `polling.jitterSeconds` | Random padding so sweeps don't land on an exact cadence. |

### Credentials

Secrets are **never** written to the config file — it only names the environment
variable to read them from, and the schema rejects anything that looks like a
literal secret. For Gmail, use an
[app password](https://support.google.com/accounts/answer/185833), not your
account password:

```bash
export FERRY_WATCH_SMTP_PASSWORD='xxxx xxxx xxxx xxxx'
```

`delivery.transport` can be `smtp`, `resend` (HTTPS-only, for networks that
block outbound SMTP), or `console` (prints instead of sending).

## Running it on a schedule

Cron, every 30 minutes:

```cron
*/30 * * * * cd ~/mission-control/projects/ferry-watch && \
  FERRY_WATCH_SMTP_PASSWORD='...' /usr/local/bin/pnpm exec tsx src/cli.ts check --quiet \
  >> ~/.ferry-watch.log 2>&1
```

On macOS, `launchd` survives reboots more reliably — or simply leave
`pnpm exec tsx src/cli.ts watch` running in a terminal.

**Be a considerate guest.** Every sweep is one page load per date per watch
against someone else's website. Thirty minutes is frequent enough to catch a
cancellation; one minute is not neighbourly and risks getting you blocked.

## Architecture

```
src/
  cli.ts                     Command parsing and entry point
  run.ts                     Orchestration: check -> match -> diff -> email -> persist
  config.ts                  Zod schema; secrets stay in env vars
  match.ts                   Filters offers down to what a watch asked for
  diff.ts                    Decides what is genuinely new (the anti-spam brain)
  store.ts                   Atomic JSON state; corrupt state degrades to a fresh start
  notify/                    Email rendering + smtp / resend / console transports
  providers/
    brittany-ferries/        Playwright driver, tolerant parser, calibration
    mock.ts                  Deterministic fake operator for testing
```

Adding another operator means implementing `AvailabilityProvider` in
`src/providers/` and registering it — the matching, de-duplication, templating
and delivery are all operator-agnostic.

## Development

```bash
pnpm test          # 85 tests
pnpm check         # typecheck
pnpm verify        # both
```

Playwright is an **optional** dependency: unit tests and the mock provider run
without it, and it is only needed to poll a live operator.

## Limitations, honestly

- **The Brittany Ferries adapter is uncalibrated as shipped.** Its default
  search URL was written without live access to the site. Run `calibrate` first.
- Availability is read from an undocumented internal feed. When it changes, the
  parser degrades to "no sailings found" and the failure alert fires — it will
  not silently report false negatives.
- `ferry-watch` never books anything. It tells you a cabin exists and links you
  to the operator; you book it yourself.
