# ferry-watch

A self-hosted replacement for [dog.boats](https://www.dog.boats/) — the
independent Brittany Ferries **pet-friendly cabin finder** — with the email
alerts it no longer offers.

Pet-friendly cabins on the UK↔Spain crossings are scarce, sell out months
ahead, and reappear only when someone cancels. Refreshing the booking page
yourself is the only way to catch one. `ferry-watch` does the refreshing,
remembers what it has already told you about, and emails you the moment
something new appears.

## What it does

- Watches any number of routes and date windows at once.
- Reads the operator's own JSON API directly — two calls per date window, no
  browser, no session, no scraping.
- Confirms real stock before alerting. A sailing is only reported once the
  operator lists a pet-friendly cabin with units actually available.
- Emails you **only what is new**. An offer that was there last sweep does not
  email you again (configurable re-notify window, default 24h).
- Emails you when a watch has been **failing** repeatedly, so silence is never
  mistaken for "no cabins available".
- Runs on GitHub Actions or on your own machine. No account, no third party,
  and nothing leaves your control except the requests to the operator and your
  own SMTP relay.

## Quick start

```bash
cd projects/ferry-watch
pnpm install

cp ferry-watch.config.example.json ferry-watch.config.json
$EDITOR ferry-watch.config.json           # set your email address
```

The shipped config watches all three **UK → Spain** crossings:
Portsmouth→Santander, Portsmouth→Bilbao and Plymouth→Santander.

Prove the plumbing before pointing it at the real site:

```bash
# Full pipeline against a built-in fake operator, printing the email
pnpm exec tsx src/cli.ts check --provider mock --dry-run

# Prove your SMTP credentials actually deliver
export FERRY_WATCH_SMTP_PASSWORD='your-app-password'
pnpm exec tsx src/cli.ts test-email
```

Then run it for real. No calibration step — the API needs none:

```bash
# One sweep over a specific window, printing the email instead of sending it
pnpm exec tsx src/cli.ts check --from 2026-09-25 --to 2026-10-07 --dry-run

# Or leave it watching that window
pnpm exec tsx src/cli.ts watch --from 2026-09-25 --to 2026-10-07
```

`--from` / `--to` override the dates in every watch, so a one-off search never
means editing JSON. Omit them to use the dates in the config.

## Running it on GitHub Actions (no machine of your own)

`.github/workflows/ferry-watch.yml` runs the sweep every 15 minutes on GitHub's
infrastructure. Nothing needs to stay switched on at home.

Add these repository secrets under **Settings → Secrets and variables →
Actions**. They are secrets rather than config because the repository is
public — your address and mail account never reach a committed file:

| Secret | Example |
|---|---|
| `FERRY_WATCH_EMAIL_TO` | `you@gmail.com` |
| `FERRY_WATCH_EMAIL_FROM` | `you@gmail.com` |
| `FERRY_WATCH_SMTP_HOST` | `smtp.gmail.com` |
| `FERRY_WATCH_SMTP_USER` | `you@gmail.com` |
| `FERRY_WATCH_SMTP_PASSWORD` | a Gmail [app password](https://support.google.com/accounts/answer/185833) |

Scheduled workflows only run from the default branch, so the workflow has to be
on `main` to fire. Which offers have already been emailed is kept in the Actions
cache; a cache miss costs one repeated alert, never a missed one.

If the API changes and every route starts failing, the run exits non-zero and
GitHub emails you about the failed workflow — so a broken watcher is noisy
rather than silent.

### How much traffic a sweep costs

Two API calls per date window per watch, plus one per flagged sailing. The
shipped config over a 13-day window is roughly six calls a sweep. That is why
15 minutes is defensible where the old browser-driven version needed an hour.

## Commands

| Command | What it does |
|---|---|
| `check` | One sweep. Emails anything new, saves state, exits. Exit code 1 if every watch failed. |
| `watch` | Sweeps forever at `polling.intervalMinutes` (plus jitter). |
| `test-email` | Sends a sample alert so you can confirm delivery. |

Options: `--config <path>`, `--from <date>`, `--to <date>`, `--only <ids>`,
`--provider <id>`, `--dry-run`, `--quiet`.

The `calibrate`, `probe`, `inspect` and `search` commands drive a real browser
and belong to the superseded scraping path. They are kept as a fallback in case
the operator closes the API, and need `pnpm exec playwright install chromium`.

## How availability is read

Brittany Ferries publish no public API, but their booking pages call an
internal one that answers freely — no cookie, no session, no browser:

```
POST /api/bebop/v1/crossing/prices          sailings in a date window, each
                                            flagged for pet cabin availability
POST /api/bebop/v1/crossing/accommodations  which cabin, at what price, and
                                            how many are left
```

The first call is the trigger and the second adds detail. Deliberately, the
second is **not** a gate: if it fails, the sailing is still reported with less
information. Losing an alert entirely is far worse than losing a price, and
that call has failed in practice.

Every request and response shape is documented in [FINDINGS.md](./FINDINGS.md),
along with the three parser bugs that came from assuming a field name instead
of reading the payload. Tests are built from captured live responses rather
than invented fixtures.

Requests are windowed seven days at a time, paced 800ms apart, and retried with
exponential backoff on 429 and 5xx. This is an undocumented internal interface
with no promise of stability; expect it to break when they redeploy.

## Configuration

See `ferry-watch.config.example.json`. Notable fields:

| Field | Meaning |
|---|---|
| `watches[].routeFrom` / `routeTo` | Port names; mapped to the operator's codes in `providers/brittany-ferries/ports.ts`. |
| `watches[].dateFrom` / `dateTo` | Inclusive departure window, requested seven days at a time. |
| `watches[].departAfter` / `departBefore` | Only alert on sailings in this daily time window. |
| `watches[].wantKinds` | `pet-friendly-cabin`, `kennel`, `pet-in-vehicle`, `pet-deck`. |
| `watches[].maxPrice` | Ceiling in **pence**. Offers with no disclosed price are always kept. |
| `alerts.renotifyAfterHours` | How long before a still-available offer is worth mentioning again. |
| `alerts.notifyOnDisappear` | Also email when something you were told about sells out. |
| `polling.jitterSeconds` | Random padding so sweeps don't land on an exact cadence. |

### Credentials

Secrets are **never** written to the config file — it only names the environment
variable to read them from, and the schema rejects anything that is not a plain
environment-variable name. For Gmail, use an app password, not your account
password:

```bash
export FERRY_WATCH_SMTP_PASSWORD='xxxx xxxx xxxx xxxx'
```

`delivery.transport` can be `smtp`, `resend` (HTTPS-only, for networks that
block outbound SMTP), or `console` (prints instead of sending).

Setting `FERRY_WATCH_DUMP_DIR` writes the exact request and response of every
API call to that directory. It is off unless set, and exists so a sweep that
finds nothing can be told apart from a sweep that is parsing the wrong thing.

## Running it on a schedule yourself

Cron, every 30 minutes:

```cron
*/30 * * * * cd ~/mission-control/projects/ferry-watch && \
  FERRY_WATCH_SMTP_PASSWORD='...' /usr/local/bin/pnpm exec tsx src/cli.ts check --quiet \
  --from 2026-09-25 --to 2026-10-07 >> ~/.ferry-watch.log 2>&1
```

On macOS, `launchd` survives reboots more reliably — or simply leave
`pnpm exec tsx src/cli.ts watch` running in a terminal.

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
    brittany-ferries/
      api.ts                 The live path: the two-call JSON sequence
      ports.ts               Port name -> operator code
      browser.ts, calibrate.ts, parse.ts, selectors.ts, suggest.ts
                             Superseded scraping fallback
    mock.ts                  Deterministic fake operator for testing
scripts/
  probe-accommodations.ts    Finds which request bodies the operator accepts
```

Adding another operator means implementing `AvailabilityProvider` in
`src/providers/` and registering it — the matching, de-duplication, templating
and delivery are all operator-agnostic.

## Development

```bash
pnpm test          # 131 tests
pnpm check         # typecheck
pnpm verify        # both
```

Playwright is an **optional** peer dependency, imported lazily. The API path,
the unit tests and the mock provider all run without it.

## Limitations, honestly

- Availability comes from an undocumented internal API. When it changes, the
  parser degrades to "no sailings found" and the failure alert fires — it will
  not silently report false negatives.
- Pet cabin stock is only as truthful as the operator's own booking flow. A
  cabin can be gone between the alert and your booking it.
- `ferry-watch` never books anything. It tells you a cabin exists and links you
  to the operator; you book it yourself.
