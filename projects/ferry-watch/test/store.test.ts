import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, getWatchState, loadState, saveState } from "../src/store.js";

async function tempPath(name = "state.json"): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "ferry-state-")), name);
}

describe("state persistence", () => {
  it("round-trips through disk", async () => {
    const path = await tempPath();
    const state = emptyState();
    state.watches.w = {
      lastCheckedAt: "2026-09-01T00:00:00.000Z",
      consecutiveFailures: 0,
      failureNotifiedAt: null,
      offers: {
        "s1::PET4": {
          firstSeenAt: "2026-09-01T00:00:00.000Z",
          lastSeenAt: "2026-09-01T00:00:00.000Z",
          lastNotifiedAt: "2026-09-01T00:00:00.000Z",
        },
      },
    };

    await saveState(path, state);
    expect(await loadState(path)).toEqual(state);
  });

  it("creates missing directories", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ferry-state-")), "a/b/state.json");
    await saveState(path, emptyState());
    expect(await loadState(path)).toEqual(emptyState());
  });

  it("starts fresh rather than failing when the file is absent", async () => {
    expect(await loadState("/nope/missing.json")).toEqual(emptyState());
  });

  it("starts fresh rather than failing when the file is corrupt", async () => {
    const path = await tempPath();
    await writeFile(path, "{ truncated", "utf8");
    expect(await loadState(path)).toEqual(emptyState());
  });

  it("starts fresh when the file is valid JSON of the wrong shape", async () => {
    const path = await tempPath();
    await writeFile(path, JSON.stringify({ version: 99 }), "utf8");
    expect(await loadState(path)).toEqual(emptyState());
  });

  it("returns an empty watch state for an unknown watch", () => {
    expect(getWatchState(emptyState(), "unknown").offers).toEqual({});
  });
});
