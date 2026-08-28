# ferry-watch — Agent Notes

Self-hosted replacement for dog.boats (Brittany Ferries pet-friendly cabin
finder) with the email alerts that service dropped. See `README.md` for usage.

## Tech Stack
- Node LTS + **pnpm**, TypeScript strict, ESM (`"type": "module"`)
- Zod 4 for config validation, Vitest for tests, nodemailer for SMTP
- Playwright is an **optional** peer dependency — required only for live checks

## Conventions
- Strict TypeScript, no `any`. Named exports. Relative imports carry `.js`
  extensions (ESM requirement).
- `pnpm verify` (typecheck + test) before committing.
- Zod 4: use `.prefault({})` — not `.default({})` — on nested config objects
  whose own fields all carry defaults.

## Architecture rules
- **Providers are the only site-specific code.** `match`, `diff`, `store` and
  `notify` are operator-agnostic — keep them that way when adding an operator.
- **`diff.ts` is the anti-spam brain.** Any change there risks either flooding
  the user or silently swallowing a real cabin. It is pure and heavily tested;
  add a test before changing behaviour.
- **Secrets never enter the config file.** The schema rejects anything that is
  not an `ENV_VAR` name. Read them via `process.env` at mailer construction.
- **Failures must be loud.** Silence is indistinguishable from "no availability",
  so repeated provider failures raise their own email exactly once per outage.

## The uncalibrated adapter
Brittany Ferries have no API and change their booking front end without notice.
`src/providers/brittany-ferries/selectors.ts` ships defaults that were written
**without live access to the site** — they are a starting point.

The parser (`parse.ts`) is intentionally shape-tolerant and pure: it walks an
arbitrary payload for things that behave like sailings and pet options. Test it
with representative payloads rather than binding it to one schema. When the site
changes, prefer widening the parser or re-running `calibrate` over hard-coding.

## Testing
- `test/` covers config, matching, diffing, state, templates, selectors, and a
  full `runOnce` pipeline against the mock provider.
- `runOnce` accepts an injected `mailer` so the pipeline is testable without
  sending mail. Use `MockProvider` (`--provider mock`) rather than the network.
- Never write a test that hits a live operator.
