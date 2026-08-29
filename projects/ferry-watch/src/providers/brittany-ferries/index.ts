import type { Watch } from "../../config.js";
import type { Sailing } from "../../types.js";
import type { AvailabilityProvider, ProviderContext } from "../types.js";
import { readAvailability } from "./api.js";

/**
 * Reads pet-cabin availability from Brittany Ferries' internal JSON API.
 *
 * No browser, no cookies, no session: /crossing/prices lists sailings with a
 * preliminary pet-cabin flag, and /crossing/accommodations gives cabin-level
 * stock for the ones worth asking about. Both are POST.
 */
export class BrittanyFerriesProvider implements AvailabilityProvider {
  readonly id = "brittany-ferries";

  async check(watch: Watch, context: ProviderContext): Promise<Sailing[]> {
    return readAvailability(watch, context.log);
  }
}
