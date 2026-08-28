import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyDateOverride,
  applyEnvOverrides,
  ConfigSchema,
  loadConfig,
} from "../src/config.js";

const base = {
  email: { from: "a@b.test", to: ["c@d.test"], delivery: { transport: "console" } },
  watches: [
    {
      id: "w",
      label: "W",
      routeFrom: "Santander",
      routeTo: "Portsmouth",
      dateFrom: "2026-09-10",
      dateTo: "2026-09-20",
    },
  ],
};

async function writeTemp(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ferry-watch-"));
  const path = join(dir, "config.json");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("ConfigSchema", () => {
  it("applies sensible defaults", () => {
    const config = ConfigSchema.parse(base);
    expect(config.polling.intervalMinutes).toBe(30);
    expect(config.alerts.renotifyAfterHours).toBe(24);
    expect(config.watches[0]?.wantKinds).toEqual(["pet-friendly-cabin"]);
    expect(config.watches[0]?.provider).toBe("brittany-ferries");
    expect(config.watches[0]?.enabled).toBe(true);
  });

  it("rejects a reversed date range", () => {
    const bad = { ...base, watches: [{ ...base.watches[0], dateTo: "2026-09-01" }] };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed date", () => {
    const bad = { ...base, watches: [{ ...base.watches[0], dateFrom: "10-09-2026" }] };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a reversed time window", () => {
    const bad = {
      ...base,
      watches: [{ ...base.watches[0], departAfter: "20:00", departBefore: "08:00" }],
    };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("refuses a literal password in place of an env var name", () => {
    const bad = {
      ...base,
      email: {
        ...base.email,
        delivery: {
          transport: "smtp",
          host: "smtp.gmail.com",
          user: "me@gmail.com",
          passwordEnv: "hunter2",
        },
      },
    };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a proper SMTP block", () => {
    const good = {
      ...base,
      email: {
        ...base.email,
        delivery: {
          transport: "smtp",
          host: "smtp.gmail.com",
          user: "me@gmail.com",
          passwordEnv: "FERRY_WATCH_SMTP_PASSWORD",
        },
      },
    };
    const parsed = ConfigSchema.parse(good);
    expect(parsed.email.delivery).toMatchObject({ port: 587, secure: false });
  });

  it("rejects an invalid recipient address", () => {
    const bad = { ...base, email: { ...base.email, to: ["not-an-email"] } };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe("loadConfig", () => {
  it("explains a missing file", async () => {
    await expect(loadConfig("/nope/missing.json")).rejects.toThrow(/Cannot read config/);
  });

  it("explains malformed JSON", async () => {
    const path = await writeTemp("{ not json");
    await expect(loadConfig(path)).rejects.toThrow(/not valid JSON/);
  });

  it("lists validation problems with their field paths", async () => {
    const path = await writeTemp(JSON.stringify({ email: base.email, watches: [] }));
    await expect(loadConfig(path)).rejects.toThrow(/watches/);
  });

  it("rejects duplicate watch ids", async () => {
    const path = await writeTemp(
      JSON.stringify({ ...base, watches: [base.watches[0], base.watches[0]] }),
    );
    await expect(loadConfig(path)).rejects.toThrow(/duplicate id/);
  });

  it("loads a valid file", async () => {
    const path = await writeTemp(JSON.stringify(base));
    await expect(loadConfig(path)).resolves.toMatchObject({ statePath: expect.any(String) });
  });
});

describe("applyDateOverride", () => {
  it("leaves the config untouched when neither bound is given", () => {
    const config = ConfigSchema.parse(base);
    expect(applyDateOverride(config, null, null)).toBe(config);
  });

  it("applies a window to every watch", () => {
    const twoWatches = ConfigSchema.parse({
      ...base,
      watches: [base.watches[0], { ...base.watches[0], id: "w2" }],
    });
    const overridden = applyDateOverride(twoWatches, "2026-09-25", "2026-10-07");
    for (const watch of overridden.watches) {
      expect(watch.dateFrom).toBe("2026-09-25");
      expect(watch.dateTo).toBe("2026-10-07");
    }
  });

  it("allows overriding just one bound", () => {
    const config = ConfigSchema.parse(base);
    const overridden = applyDateOverride(config, "2026-09-15", null);
    expect(overridden.watches[0]?.dateFrom).toBe("2026-09-15");
    expect(overridden.watches[0]?.dateTo).toBe("2026-09-20");
  });

  it("rejects a reversed window rather than searching nothing", () => {
    const config = ConfigSchema.parse(base);
    expect(() => applyDateOverride(config, "2026-10-07", "2026-09-25")).toThrow(
      /invalid date window/,
    );
  });

  it("rejects a malformed date", () => {
    const config = ConfigSchema.parse(base);
    expect(() => applyDateOverride(config, "25/09/2026", null)).toThrow(
      /invalid date window/,
    );
  });
});

describe("applyEnvOverrides", () => {
  const smtpBase = {
    ...base,
    email: {
      ...base.email,
      delivery: {
        transport: "smtp",
        host: "smtp.example.com",
        user: "me@example.com",
        passwordEnv: "FERRY_WATCH_SMTP_PASSWORD",
      },
    },
  };

  it("leaves the config alone when nothing is set", () => {
    const config = ConfigSchema.parse(base);
    expect(applyEnvOverrides(config, {})).toEqual(config);
  });

  it("overrides recipients from a comma-separated list", () => {
    const config = ConfigSchema.parse(base);
    const overridden = applyEnvOverrides(config, {
      FERRY_WATCH_EMAIL_TO: "a@x.test, b@x.test",
    });
    expect(overridden.email.to).toEqual(["a@x.test", "b@x.test"]);
  });

  it("overrides SMTP host, user and port", () => {
    const config = ConfigSchema.parse(smtpBase);
    const overridden = applyEnvOverrides(config, {
      FERRY_WATCH_SMTP_HOST: "smtp.gmail.com",
      FERRY_WATCH_SMTP_USER: "joe@gmail.com",
      FERRY_WATCH_SMTP_PORT: "465",
    });
    expect(overridden.email.delivery).toMatchObject({
      host: "smtp.gmail.com",
      user: "joe@gmail.com",
      port: 465,
    });
  });

  it("ignores a nonsense port rather than failing the run", () => {
    const config = ConfigSchema.parse(smtpBase);
    const overridden = applyEnvOverrides(config, { FERRY_WATCH_SMTP_PORT: "abc" });
    expect(overridden.email.delivery).toMatchObject({ port: 587 });
  });

  it("overrides the state path", () => {
    const config = ConfigSchema.parse(base);
    expect(
      applyEnvOverrides(config, { FERRY_WATCH_STATE_PATH: "./ci/state.json" }).statePath,
    ).toBe("./ci/state.json");
  });

  it("rejects an invalid override rather than silently sending nowhere", () => {
    const config = ConfigSchema.parse(base);
    expect(() =>
      applyEnvOverrides(config, { FERRY_WATCH_EMAIL_TO: "not-an-address" }),
    ).toThrow(/invalid config/);
  });

  it("does not mutate the config it was given", () => {
    const config = ConfigSchema.parse(base);
    applyEnvOverrides(config, { FERRY_WATCH_EMAIL_FROM: "new@x.test" });
    expect(config.email.from).toBe("a@b.test");
  });
});
