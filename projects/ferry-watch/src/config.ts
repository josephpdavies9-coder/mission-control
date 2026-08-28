import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * Secrets are never stored in the config file — a config only ever names the
 * environment variable to read them from.
 */
const EnvRef = z
  .string()
  .min(1)
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be an ENV_VAR name, not a literal secret");

const PetAccommodationKind = z.enum([
  "pet-friendly-cabin",
  "kennel",
  "pet-in-vehicle",
  "pet-deck",
]);

/** `HH:MM` 24h. */
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
/** `YYYY-MM-DD`. */
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const WatchSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    enabled: z.boolean().default(true),
    provider: z.string().default("brittany-ferries"),

    routeFrom: z.string().min(1),
    routeTo: z.string().min(1),

    /** Inclusive window of acceptable departure dates. */
    dateFrom: IsoDate,
    dateTo: IsoDate,

    /** Only alert on sailings departing within this daily time window. */
    departAfter: TimeOfDay.nullable().default(null),
    departBefore: TimeOfDay.nullable().default(null),

    passengers: z.number().int().min(1).max(9).default(2),
    pets: z.number().int().min(1).max(6).default(1),
    /** Free-text vehicle code understood by the provider, or null for foot passengers. */
    vehicle: z.string().nullable().default(null),

    /** Which pet accommodation kinds are worth waking you up for. */
    wantKinds: z.array(PetAccommodationKind).min(1).default(["pet-friendly-cabin"]),
    /** Ceiling in minor units (pence) — null means any price. */
    maxPrice: z.number().int().positive().nullable().default(null),
  })
  .refine((w) => w.dateFrom <= w.dateTo, {
    message: "dateFrom must be on or before dateTo",
    path: ["dateFrom"],
  })
  .refine(
    (w) => !w.departAfter || !w.departBefore || w.departAfter < w.departBefore,
    { message: "departAfter must be before departBefore", path: ["departAfter"] },
  );

const SmtpSchema = z.object({
  transport: z.literal("smtp"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().min(1),
  /** Name of the env var holding the password / app password. */
  passwordEnv: EnvRef.default("FERRY_WATCH_SMTP_PASSWORD"),
});

const ResendSchema = z.object({
  transport: z.literal("resend"),
  apiKeyEnv: EnvRef.default("RESEND_API_KEY"),
});

/** Prints the email to stdout instead of sending — for dry runs. */
const ConsoleSchema = z.object({ transport: z.literal("console") });

const EmailSchema = z.object({
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
  /** Prefix applied to every subject line, for inbox filtering. */
  subjectPrefix: z.string().default("[ferry-watch]"),
  delivery: z.discriminatedUnion("transport", [
    SmtpSchema,
    ResendSchema,
    ConsoleSchema,
  ]),
});

export const ConfigSchema = z.object({
  email: EmailSchema,
  watches: z.array(WatchSchema).min(1),
  polling: z
    .object({
      /** Gap between sweeps in `watch` mode. */
      intervalMinutes: z.number().int().min(5).max(1440).default(30),
      /** Random extra delay so requests don't land on an exact cadence. */
      jitterSeconds: z.number().int().min(0).max(600).default(90),
    })
    .prefault({}),
  alerts: z
    .object({
      /** Don't re-alert the same offer within this many hours. */
      renotifyAfterHours: z.number().int().min(1).max(720).default(24),
      /** Also email when a previously alerted offer sells out. */
      notifyOnDisappear: z.boolean().default(false),
      /** Email when a provider fails this many consecutive sweeps. */
      errorAfterConsecutiveFailures: z.number().int().min(1).max(50).default(3),
    })
    .prefault({}),
  browser: z
    .object({
      headless: z.boolean().default(true),
      /** Per-watch budget for the whole booking-form flow. */
      timeoutSeconds: z.number().int().min(10).max(600).default(120),
      /** Overrides for the selector pack — see providers/brittany-ferries/selectors.ts. */
      selectors: z.record(z.string(), z.string()).default({}),
    })
    .prefault({}),
  statePath: z.string().default("./state/ferry-watch.state.json"),
});

export type Config = z.output<typeof ConfigSchema>;
export type Watch = Config["watches"][number];
export type EmailConfig = Config["email"];

/** Reads and validates a config file, throwing a readable error on failure. */
export async function loadConfig(path: string): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `Cannot read config at ${path}. Copy ferry-watch.config.example.json to ferry-watch.config.json and edit it.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`${path} is invalid:\n${issues}`);
  }

  const ids = result.data.watches.map((w) => w.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) {
    throw new Error(`${path} is invalid:\n  - watches: duplicate id "${duplicate}"`);
  }

  return result.data;
}

/**
 * Applies a date window from the command line to every watch, so a one-off
 * search does not require editing the config file. Re-validates through the
 * schema, which catches a reversed or malformed range.
 */
export function applyDateOverride(
  config: Config,
  from: string | null,
  to: string | null,
): Config {
  if (from === null && to === null) return config;

  const watches = config.watches.map((watch) => ({
    ...watch,
    dateFrom: from ?? watch.dateFrom,
    dateTo: to ?? watch.dateTo,
  }));

  const result = ConfigSchema.safeParse({ ...config, watches });
  if (!result.success) {
    // Every watch reports the same problem, so say it once.
    const issues = [...new Set(result.error.issues.map((issue) => issue.message))]
      .map((message) => `  - ${message}`)
      .join("\n");
    throw new Error(`--from/--to produced an invalid date window:\n${issues}`);
  }
  return result.data;
}
