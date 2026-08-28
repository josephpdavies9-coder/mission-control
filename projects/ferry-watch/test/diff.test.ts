import { describe, expect, it } from "vitest";
import { diffWatch, recordFailure } from "../src/diff.js";
import { emptyWatchState } from "../src/store.js";
import type { Offer } from "../src/types.js";

function offer(key: string, departAt = "2026-09-12T20:30:00"): Offer {
  return {
    key,
    sailingId: key.split("::")[0] ?? key,
    routeFrom: "Santander",
    routeTo: "Portsmouth",
    departAt,
    arriveAt: null,
    shipName: "Galicia",
    bookingUrl: null,
    option: {
      code: "PET4",
      label: "Pet-friendly cabin",
      kind: "pet-friendly-cabin",
      available: true,
      remaining: 1,
      price: 24500,
      currency: "GBP",
    },
  };
}

const options = { renotifyAfterHours: 24, notifyOnDisappear: false };
const T0 = "2026-09-01T09:00:00.000Z";

describe("diffWatch", () => {
  it("alerts on a first sighting", () => {
    const { delta } = diffWatch("w", "W", undefined, [offer("s1::PET4")], T0, options);
    expect(delta.appeared.map((o) => o.key)).toEqual(["s1::PET4"]);
  });

  it("stays silent when the same offer is still there next sweep", () => {
    const first = diffWatch("w", "W", undefined, [offer("s1::PET4")], T0, options);
    const second = diffWatch(
      "w",
      "W",
      first.nextState,
      [offer("s1::PET4")],
      "2026-09-01T09:30:00.000Z",
      options,
    );
    expect(second.delta.appeared).toEqual([]);
  });

  it("re-alerts once the re-notify window has elapsed", () => {
    const first = diffWatch("w", "W", undefined, [offer("s1::PET4")], T0, options);
    const later = diffWatch(
      "w",
      "W",
      first.nextState,
      [offer("s1::PET4")],
      "2026-09-02T10:00:00.000Z",
      options,
    );
    expect(later.delta.appeared).toHaveLength(1);
  });

  it("alerts on a genuinely new offer alongside a known one", () => {
    const first = diffWatch("w", "W", undefined, [offer("s1::PET4")], T0, options);
    const second = diffWatch(
      "w",
      "W",
      first.nextState,
      [offer("s1::PET4"), offer("s2::PET4", "2026-09-13T20:30:00")],
      "2026-09-01T09:30:00.000Z",
      options,
    );
    expect(second.delta.appeared.map((o) => o.key)).toEqual(["s2::PET4"]);
  });

  it("reports offers that sold out only when asked to", () => {
    const first = diffWatch("w", "W", undefined, [offer("s1::PET4")], T0, options);

    const silent = diffWatch("w", "W", first.nextState, [], "2026-09-01T10:00:00.000Z", options);
    expect(silent.delta.disappeared).toEqual([]);

    const loud = diffWatch("w", "W", first.nextState, [], "2026-09-01T10:00:00.000Z", {
      ...options,
      notifyOnDisappear: true,
    });
    expect(loud.delta.disappeared.map((o) => o.key)).toEqual(["s1::PET4"]);
  });

  it("forgets offers that are gone, so they alert afresh if they return", () => {
    const first = diffWatch("w", "W", undefined, [offer("s1::PET4")], T0, options);
    const gone = diffWatch("w", "W", first.nextState, [], "2026-09-01T10:00:00.000Z", options);
    expect(gone.nextState.offers["s1::PET4"]).toBeUndefined();

    const back = diffWatch(
      "w",
      "W",
      gone.nextState,
      [offer("s1::PET4")],
      "2026-09-01T11:00:00.000Z",
      options,
    );
    expect(back.delta.appeared).toHaveLength(1);
  });

  it("preserves when an offer was first seen across sweeps", () => {
    const first = diffWatch("w", "W", undefined, [offer("s1::PET4")], T0, options);
    const second = diffWatch(
      "w",
      "W",
      first.nextState,
      [offer("s1::PET4")],
      "2026-09-01T09:30:00.000Z",
      options,
    );
    expect(second.nextState.offers["s1::PET4"]?.firstSeenAt).toBe(T0);
    expect(second.nextState.offers["s1::PET4"]?.lastSeenAt).toBe("2026-09-01T09:30:00.000Z");
  });

  it("clears the failure counter after a good sweep", () => {
    const failed = { ...emptyWatchState(), consecutiveFailures: 3, failureNotifiedAt: T0 };
    const { nextState } = diffWatch("w", "W", failed, [offer("s1::PET4")], T0, options);
    expect(nextState.consecutiveFailures).toBe(0);
    expect(nextState.failureNotifiedAt).toBeNull();
  });
});

describe("recordFailure", () => {
  it("counts consecutive failures without losing known offers", () => {
    const seeded = diffWatch("w", "W", undefined, [offer("s1::PET4")], T0, options).nextState;
    const once = recordFailure(seeded, "2026-09-01T10:00:00.000Z");
    expect(once.consecutiveFailures).toBe(1);
    expect(once.offers["s1::PET4"]).toBeDefined();
    expect(recordFailure(once, "2026-09-01T11:00:00.000Z").consecutiveFailures).toBe(2);
  });
});
