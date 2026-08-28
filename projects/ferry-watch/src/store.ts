import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

/** What we remember about a single offer between sweeps. */
const OfferStateSchema = z.object({
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  /** Null until we have actually emailed about it. */
  lastNotifiedAt: z.string().nullable(),
});

const WatchStateSchema = z.object({
  lastCheckedAt: z.string().nullable().default(null),
  consecutiveFailures: z.number().int().min(0).default(0),
  /** Set when we last emailed about this watch failing, so we nag only once. */
  failureNotifiedAt: z.string().nullable().default(null),
  offers: z.record(z.string(), OfferStateSchema).default({}),
});

const StateSchema = z.object({
  version: z.literal(1).default(1),
  watches: z.record(z.string(), WatchStateSchema).default({}),
});

export type OfferState = z.output<typeof OfferStateSchema>;
export type WatchState = z.output<typeof WatchStateSchema>;
export type State = z.output<typeof StateSchema>;

export function emptyState(): State {
  return { version: 1, watches: {} };
}

export function emptyWatchState(): WatchState {
  return {
    lastCheckedAt: null,
    consecutiveFailures: 0,
    failureNotifiedAt: null,
    offers: {},
  };
}

/**
 * Loads persisted state. A missing or corrupt file is not fatal: alerting from
 * a clean slate is far better than refusing to run, so we start fresh.
 */
export async function loadState(path: string): Promise<State> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return emptyState();
  }

  try {
    const result = StateSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : emptyState();
  } catch {
    return emptyState();
  }
}

/** Writes state atomically so a crash mid-write can't corrupt it. */
export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export function getWatchState(state: State, watchId: string): WatchState {
  return state.watches[watchId] ?? emptyWatchState();
}
