import { describe, expect, it } from "vitest";
import { getOfflineCausalKey } from "@/lib/offline/outbox";

describe("offline causal chains", () => {
  it("groups writes for the same actor, kind and order", () => {
    const base = {
      kind: "COLLECTION" as const,
      actorUsername: "seller-1",
      body: { orderId: 42 },
      causalKey: undefined,
    };
    expect(getOfflineCausalKey({ ...base, id: "a" })).toBe(
      getOfflineCausalKey({ ...base, id: "b" })
    );
  });

  it("keeps independent orders and actors in separate chains", () => {
    const first = getOfflineCausalKey({
      id: "a",
      kind: "COLLECTION",
      actorUsername: "seller-1",
      body: { orderId: 42 },
      causalKey: undefined,
    });
    const second = getOfflineCausalKey({
      id: "b",
      kind: "COLLECTION",
      actorUsername: "seller-1",
      body: { orderId: 84 },
      causalKey: undefined,
    });
    const third = getOfflineCausalKey({
      id: "c",
      kind: "COLLECTION",
      actorUsername: "seller-2",
      body: { orderId: 42 },
      causalKey: undefined,
    });
    expect(new Set([first, second, third]).size).toBe(3);
  });
});
