import type { Config, Watch } from "./config.js";
import type { WatchDelta, WatchResult } from "./types.js";
import { getProvider } from "./providers/index.js";
import { matchOffers, sortOffers, toOffers } from "./match.js";
import { diffWatch, recordFailure } from "./diff.js";
import { getWatchState, loadState, saveState, type State } from "./store.js";
import { createMailer, type Mailer } from "./notify/index.js";
import { renderAlert, renderFailureAlert } from "./notify/template.js";

export interface RunOptions {
  /** Render emails but never send them, and never write state. */
  dryRun: boolean;
  /** Restrict the sweep to these watch ids. */
  only: string[];
  /** Force the provider for every watch, e.g. "mock". */
  providerOverride: string | null;
  log: (message: string) => void;
  /** Injected in tests; otherwise built from the config's delivery block. */
  mailer?: Mailer;
}

export interface RunSummary {
  results: WatchResult[];
  deltas: WatchDelta[];
  alertsSent: number;
}

/** Checks every enabled watch once, emails what is new, and persists state. */
export async function runOnce(
  config: Config,
  options: RunOptions,
): Promise<RunSummary> {
  const now = new Date().toISOString();
  const state = await loadState(config.statePath);
  const mailer =
    options.mailer ??
    (await createMailer(
      options.dryRun
        ? { ...config.email, delivery: { transport: "console" } }
        : config.email,
    ));

  const watches = selectWatches(config.watches, options.only);
  const results: WatchResult[] = [];
  const deltas: WatchDelta[] = [];

  for (const watch of watches) {
    const result = await checkWatch(watch, config, options);
    results.push(result);

    if (result.error !== null) {
      await handleFailure(watch, config, state, result.error, now, mailer, options);
      continue;
    }

    const outcome = diffWatch(
      watch.id,
      watch.label,
      getWatchState(state, watch.id),
      result.matched,
      now,
      {
        renotifyAfterHours: config.alerts.renotifyAfterHours,
        notifyOnDisappear: config.alerts.notifyOnDisappear,
      },
    );

    state.watches[watch.id] = outcome.nextState;
    deltas.push(outcome.delta);

    options.log(
      `${watch.label}: ${result.matched.length} matching, ${outcome.delta.appeared.length} new`,
    );
  }

  const worthSending = deltas.filter(
    (delta) => delta.appeared.length > 0 || delta.disappeared.length > 0,
  );

  let alertsSent = 0;
  if (worthSending.length > 0) {
    await mailer.send(renderAlert(worthSending, config.email.subjectPrefix));
    alertsSent = 1;
    options.log(`Alert sent to ${config.email.to.join(", ")}`);
  } else {
    options.log("Nothing new — no email sent.");
  }

  if (!options.dryRun) await saveState(config.statePath, state);

  return { results, deltas, alertsSent };
}

function selectWatches(watches: Watch[], only: string[]): Watch[] {
  const enabled = watches.filter((watch) => watch.enabled);
  if (only.length === 0) return enabled;
  const wanted = new Set(only);
  const selected = enabled.filter((watch) => wanted.has(watch.id));
  if (selected.length === 0) {
    throw new Error(
      `No enabled watch matched --only ${only.join(",")}. Known ids: ${watches
        .map((w) => w.id)
        .join(", ")}`,
    );
  }
  return selected;
}

async function checkWatch(
  watch: Watch,
  config: Config,
  options: RunOptions,
): Promise<WatchResult> {
  const checkedAt = new Date().toISOString();
  options.log(`Checking ${watch.label}...`);

  try {
    const provider = await getProvider(options.providerOverride ?? watch.provider);
    const sailings = await provider.check(watch, {
      browser: config.browser,
      log: options.log,
    });
    const matched = sortOffers(matchOffers(watch, toOffers(sailings)));
    return { watchId: watch.id, watchLabel: watch.label, checkedAt, matched, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.log(`${watch.label}: FAILED — ${message}`);
    return {
      watchId: watch.id,
      watchLabel: watch.label,
      checkedAt,
      matched: [],
      error: message,
    };
  }
}

/**
 * A silently failing watch is worse than no watch at all — the user would read
 * the absence of email as "no cabins". So repeated failures raise their own
 * alert, once, until the watch recovers.
 */
async function handleFailure(
  watch: Watch,
  config: Config,
  state: State,
  error: string,
  now: string,
  mailer: Mailer,
  options: RunOptions,
): Promise<void> {
  const next = recordFailure(getWatchState(state, watch.id), now);
  const threshold = config.alerts.errorAfterConsecutiveFailures;

  if (next.consecutiveFailures >= threshold && next.failureNotifiedAt === null) {
    await mailer.send(
      renderFailureAlert(
        watch.label,
        next.consecutiveFailures,
        error,
        config.email.subjectPrefix,
      ),
    );
    next.failureNotifiedAt = now;
    options.log(`${watch.label}: failure alert sent`);
  }

  state.watches[watch.id] = next;
}
