import type { Config, Watch } from "../config.js";
import type { Sailing } from "../types.js";

export interface ProviderContext {
  browser: Config["browser"];
  /** Emits progress lines; silent in cron use. */
  log: (message: string) => void;
}

/** A source of pet-accommodation availability for one ferry operator. */
export interface AvailabilityProvider {
  readonly id: string;
  check(watch: Watch, context: ProviderContext): Promise<Sailing[]>;
}
