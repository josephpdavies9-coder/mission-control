import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, type Config } from "../src/config.js";
import { runOnce } from "../src/run.js";
import { loadState } from "../src/store.js";
import type { Mailer } from "../src/notify/index.js";
import type { RenderedEmail } from "../src/notify/template.js";

class RecordingMailer implements Mailer {
  readonly id = "recording";
  readonly sent: RenderedEmail[] = [];
  async send(email: RenderedEmail): Promise<void> {
    this.sent.push(email);
  }
}

async function makeConfig(overrides: Partial<Config> = {}): Promise<Config> {
  const statePath = join(await mkdtemp(join(tmpdir(), "ferry-run-")), "state.json");
  return ConfigSchema.parse({
    email: { from: "a@b.test", to: ["c@d.test"], delivery: { transport: "console" } },
    statePath,
    watches: [
      {
        id: "sdr-pme",
        label: "Santander to Portsmouth",
        provider: "mock",
        routeFrom: "Santander",
        routeTo: "Portsmouth",
        // The mock sails on dateFrom, so this window always contains a hit.
        dateFrom: "2026-09-12",
        dateTo: "2026-09-20",
      },
    ],
    ...overrides,
  });
}

const silent = { dryRun: false, only: [], providerOverride: null, log: () => undefined };

describe("runOnce", () => {
  it("emails on the first sweep and stays quiet on the second", async () => {
    const config = await makeConfig();
    const mailer = new RecordingMailer();

    const first = await runOnce(config, { ...silent, mailer });
    expect(first.alertsSent).toBe(1);
    expect(mailer.sent[0]?.subject).toContain("1 pet cabin available");
    expect(mailer.sent[0]?.text).toContain("Santander");

    const second = await runOnce(config, { ...silent, mailer });
    expect(second.alertsSent).toBe(0);
    expect(mailer.sent).toHaveLength(1);
  });

  it("persists state so a fresh process does not re-alert", async () => {
    const config = await makeConfig();
    await runOnce(config, { ...silent, mailer: new RecordingMailer() });

    const state = await loadState(config.statePath);
    expect(Object.keys(state.watches["sdr-pme"]?.offers ?? {})).toHaveLength(1);

    const mailer = new RecordingMailer();
    expect((await runOnce(config, { ...silent, mailer })).alertsSent).toBe(0);
  });

  it("writes no state and sends nothing on a dry run", async () => {
    const config = await makeConfig();
    const mailer = new RecordingMailer();
    await runOnce(config, { ...silent, mailer, dryRun: true });

    expect(await loadState(config.statePath)).toEqual({ version: 1, watches: {} });
  });

  it("sends nothing when no sailing falls in the watch window", async () => {
    const config = await makeConfig();
    const narrowed = {
      ...config,
      watches: [{ ...config.watches[0]!, dateFrom: "2026-12-01", dateTo: "2026-12-02" }],
    };
    const mailer = new RecordingMailer();
    // The mock sails on dateFrom, so widening the filter past it must exclude it.
    const summary = await runOnce(
      { ...narrowed, watches: [{ ...narrowed.watches[0]!, departAfter: "23:00" }] },
      { ...silent, mailer },
    );
    expect(summary.alertsSent).toBe(0);
  });

  it("records a provider failure without emailing on the first occurrence", async () => {
    const config = await makeConfig();
    const mailer = new RecordingMailer();
    const summary = await runOnce(config, {
      ...silent,
      mailer,
      providerOverride: "does-not-exist",
    });

    expect(summary.results[0]?.error).toContain("Unknown provider");
    expect(mailer.sent).toHaveLength(0);

    const state = await loadState(config.statePath);
    expect(state.watches["sdr-pme"]?.consecutiveFailures).toBe(1);
  });

  it("emails once after the configured run of consecutive failures", async () => {
    const config = await makeConfig();
    const mailer = new RecordingMailer();
    const failing = { ...silent, mailer, providerOverride: "does-not-exist" };

    await runOnce(config, failing);
    await runOnce(config, failing);
    expect(mailer.sent).toHaveLength(0);

    await runOnce(config, failing);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain("check failing");

    // Already warned — it must not nag on every subsequent sweep.
    await runOnce(config, failing);
    expect(mailer.sent).toHaveLength(1);
  });

  it("skips disabled watches", async () => {
    const config = await makeConfig();
    const disabled = {
      ...config,
      watches: [{ ...config.watches[0]!, enabled: false }],
    };
    const summary = await runOnce(disabled, { ...silent, mailer: new RecordingMailer() });
    expect(summary.results).toEqual([]);
  });

  it("rejects an --only that matches nothing", async () => {
    const config = await makeConfig();
    await expect(
      runOnce(config, { ...silent, only: ["nope"], mailer: new RecordingMailer() }),
    ).rejects.toThrow(/No enabled watch matched/);
  });
});
