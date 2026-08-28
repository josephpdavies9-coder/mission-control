import type { AvailabilityProvider } from "./types.js";

/** Resolves a provider id from a watch to an implementation. */
export async function getProvider(id: string): Promise<AvailabilityProvider> {
  if (id === "mock") {
    const { MockProvider } = await import("./mock.js");
    return new MockProvider();
  }
  if (id === "brittany-ferries") {
    const { BrittanyFerriesProvider } = await import("./brittany-ferries/index.js");
    return new BrittanyFerriesProvider();
  }
  throw new Error(
    `Unknown provider "${id}". Available: brittany-ferries, mock.`,
  );
}

export type { AvailabilityProvider, ProviderContext } from "./types.js";
