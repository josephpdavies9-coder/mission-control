#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import {
  applyDateOverride,
  applyEnvOverrides,
  loadConfig,
} from "./config.js";
import { runOnce } from "./run.js";
import { createMailer } from "./notify/index.js";
import { renderAlert } from "./notify/template.js";
import {
  calibrate,
  inspectForm,
  probeCalibration,
  recordCalibration,
} from "./providers/brittany-ferries/calibrate.js";

const DEFAULT_HOME = "https://www.brittany-ferries.co.uk/";

const USAGE = `ferry-watch — pet-friendly ferry cabin alerts by email

Usage:
  ferry-watch check      [options]   Check once, email anything new, exit
  ferry-watch watch      [options]   Check on a loop at polling.intervalMinutes
  ferry-watch calibrate  [options]   Capture what the booking site returns
                                     (--record to drive the site yourself)
  ferry-watch probe      [options]   Non-interactive calibration, for CI logs
  ferry-watch inspect    [options]   List the booking page's form controls
  ferry-watch test-email [options]   Send a sample alert to prove delivery works

Options:
  --config <path>    Config file (default: ./ferry-watch.config.json)
  --from <date>      Override every watch's start date (YYYY-MM-DD)
  --to <date>        Override every watch's end date (YYYY-MM-DD)
  --only <ids>       Comma-separated watch ids to check
  --record           calibrate: open a real browser and record your own search
  --start-url <url>  calibrate/probe: where to start (default: operator home)
  --wait <seconds>   probe: how long to let the page settle (default: 15)
  --provider <id>    Override every watch's provider (e.g. mock)
  --dry-run          Print emails instead of sending; leaves state untouched
  --quiet            Only print errors
  --help             Show this message
`;

interface Cli {
  command: string;
  configPath: string;
  from: string | null;
  to: string | null;
  only: string[];
  record: boolean;
  startUrl: string | null;
  wait: number;
  provider: string | null;
  dryRun: boolean;
  quiet: boolean;
}

export function parseCli(argv: string[]): Cli | null {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string", default: "./ferry-watch.config.json" },
      from: { type: "string" },
      to: { type: "string" },
      only: { type: "string", default: "" },
      record: { type: "boolean", default: false },
      "start-url": { type: "string" },
      wait: { type: "string" },
      provider: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help || positionals.length === 0) return null;

  return {
    command: positionals[0] ?? "check",
    configPath: resolve(values.config ?? "./ferry-watch.config.json"),
    from: values.from ?? null,
    to: values.to ?? null,
    only: (values.only ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    record: values.record ?? false,
    startUrl: values["start-url"] ?? null,
    wait: Number(values.wait ?? 15) || 15,
    provider: values.provider ?? null,
    dryRun: values["dry-run"] ?? false,
    quiet: values.quiet ?? false,
  };
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2));
  if (!cli) {
    process.stdout.write(USAGE);
    return 0;
  }

  const log = cli.quiet
    ? () => undefined
    : (message: string) => process.stdout.write(`${message}\n`);

  const config = applyDateOverride(
    applyEnvOverrides(await loadConfig(cli.configPath)),
    cli.from,
    cli.to,
  );
  const runOptions = {
    dryRun: cli.dryRun,
    only: cli.only,
    providerOverride: cli.provider,
    log,
  };

  switch (cli.command) {
    case "check": {
      const summary = await runOnce(config, runOptions);
      const failed = summary.results.filter((r) => r.error !== null);
      // A failing sweep must not look like a clean one to cron.
      return failed.length === summary.results.length && failed.length > 0 ? 1 : 0;
    }

    case "watch": {
      log(
        `Watching ${config.watches.filter((w) => w.enabled).length} route(s) every ` +
          `${config.polling.intervalMinutes} min. Ctrl-C to stop.`,
      );
      for (;;) {
        try {
          await runOnce(config, runOptions);
        } catch (error) {
          // One bad sweep must never kill a long-running watcher.
          process.stderr.write(`Sweep failed: ${(error as Error).message}\n`);
        }
        const jitter = Math.floor(Math.random() * config.polling.jitterSeconds * 1000);
        const delay = config.polling.intervalMinutes * 60_000 + jitter;
        log(`Next sweep in ${Math.round(delay / 60_000)} min.`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    case "calibrate": {
      const watch =
        config.watches.find((w) => cli.only.length === 0 || cli.only.includes(w.id)) ??
        config.watches[0];
      if (!watch) throw new Error("No watches configured to calibrate against.");

      if (cli.record) {
        await recordCalibration(
          config,
          watch,
          "./calibration",
          cli.startUrl ?? defaultStartUrl(config),
        );
        return 0;
      }

      await calibrate(config, watch, "./calibration");
      return 0;
    }

    case "probe": {
      const watch = config.watches[0];
      if (!watch) throw new Error("No watches configured to probe with.");
      await probeCalibration(
        config,
        watch,
        "./calibration",
        cli.startUrl ?? defaultStartUrl(config),
        cli.wait,
      );
      return 0;
    }

    case "inspect": {
      await inspectForm(config, cli.startUrl ?? defaultStartUrl(config));
      return 0;
    }

    case "test-email": {
      const mailer = await createMailer(
        cli.dryRun ? { ...config.email, delivery: { transport: "console" } } : config.email,
      );
      const sample = renderAlert(
        [
          {
            watchId: "sample",
            watchLabel: "Sample — Santander to Portsmouth",
            appeared: [
              {
                key: "sample::PETCAB",
                sailingId: "sample",
                routeFrom: "Santander",
                routeTo: "Portsmouth",
                departAt: "2026-09-12T20:30:00",
                arriveAt: null,
                shipName: "Galicia",
                bookingUrl: "https://www.brittany-ferries.co.uk/",
                option: {
                  code: "PETCAB",
                  label: "4-berth pet-friendly cabin",
                  kind: "pet-friendly-cabin",
                  available: true,
                  remaining: 2,
                  price: 24500,
                  currency: "GBP",
                },
              },
            ],
            disappeared: [],
          },
        ],
        config.email.subjectPrefix,
      );
      await mailer.send(sample);
      log(`Sample sent via ${mailer.id} to ${config.email.to.join(", ")}`);
      return 0;
    }

    default:
      process.stderr.write(`Unknown command "${cli.command}".\n\n${USAGE}`);
      return 2;
  }
}

/** The operator's home page, derived from the configured search URL. */
function defaultStartUrl(config: Awaited<ReturnType<typeof loadConfig>>): string {
  const configured = config.browser.selectors.searchUrl;
  try {
    return new URL(configured ?? DEFAULT_HOME).origin;
  } catch {
    return DEFAULT_HOME;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
