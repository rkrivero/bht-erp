import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteOutboxMutation,
  getOfflineCausalKey,
  listOutbox,
  putOutboxMutation,
  retryOutboxMutation,
  updateAndRetryOutboxMutation,
} from "@/lib/offline/outbox";
import type { OfflineMutation } from "@/lib/offline/types";

describe("offline causal chains & conflict resolution", () => {
  beforeEach(async () => {
    const existing = await listOutbox();
    for (const item of existing) {
      await deleteOutboxMutation(item.id);
    }
  });

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

  it("assigns order:<orderId> causal key to WAREHOUSE_ADVANCE mutations", () => {
    const wh1 = getOfflineCausalKey({
      id: "wh-1",
      kind: "WAREHOUSE_ADVANCE",
      actorUsername: "almacen1",
      body: { action: "advance", orderId: 105, nextStatus: "READY" },
      causalKey: undefined,
    });
    const wh2 = getOfflineCausalKey({
      id: "wh-2",
      kind: "WAREHOUSE_ADVANCE",
      actorUsername: "almacen1",
      body: { action: "advance", orderId: 105, nextStatus: "DELIVERED" },
      causalKey: undefined,
    });
    expect(wh1).toBe("order:105");
    expect(wh2).toBe("order:105");
  });

  it("retries a conflicted mutation preserving id when conflict is not IDEMPOTENCY_KEY_REUSED", async () => {
    const mutation: OfflineMutation = {
      id: "mut-conflict-1",
      kind: "WAREHOUSE_ADVANCE",
      actorUsername: "almacen1",
      url: "/api/orders",
      body: { action: "advance", orderId: 77, nextStatus: "DELIVERED" },
      createdAt: "2026-11-22T10:00:00.000Z",
      status: "conflict",
      lastError: "Transición inválida de estado",
      conflictCode: "INVALID_STATE_TRANSITION",
    };
    await putOutboxMutation(mutation);

    const retried = await retryOutboxMutation("mut-conflict-1");
    expect(retried).not.toBeNull();
    expect(retried!.id).toBe("mut-conflict-1");
    expect(retried!.status).toBe("pending");
    expect(retried!.lastError).toBeUndefined();
    expect(retried!.conflictCode).toBeUndefined();
    expect(retried!.causalKey).toBe("order:77");
  });

  it("regenerates UUID on retryOutboxMutation and updateAndRetryOutboxMutation when IDEMPOTENCY_KEY_REUSED", async () => {
    const mutation: OfflineMutation = {
      id: "reused-key-1",
      kind: "COLLECTION",
      actorUsername: "vendedor1",
      url: "/api/collections",
      body: { mode: "single_order", orderId: 50, amountPen: 100 },
      createdAt: "2026-11-22T10:01:00.000Z",
      status: "conflict",
      lastError: "Clave de idempotencia reutilizada con distinto contenido",
      conflictCode: "IDEMPOTENCY_KEY_REUSED",
    };
    await putOutboxMutation(mutation);

    const updated = await updateAndRetryOutboxMutation("reused-key-1", {
      amountPen: 80,
    });
    expect(updated).not.toBeNull();
    expect(updated!.id).not.toBe("reused-key-1");
    expect(updated!.status).toBe("pending");
    expect(updated!.body.amountPen).toBe(80);
    expect(updated!.body.orderId).toBe(50);
    expect(updated!.conflictCode).toBeUndefined();

    const all = await listOutbox();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(updated!.id);
  });
});
