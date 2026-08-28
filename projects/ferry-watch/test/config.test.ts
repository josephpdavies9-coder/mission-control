import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, loadConfig } from "../src/config.js";

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
