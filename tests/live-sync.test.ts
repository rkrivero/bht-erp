import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getSync } from "../src/app/api/sync/route";
import { signTestSessionToken } from "../src/lib/auth/test-session";
import { getPool } from "../src/lib/db";
import { computeSyncSnapshot } from "../src/lib/realtime/sync-engine";
import type { SessionUser } from "../src/lib/types";

beforeAll(() => {
  process.env.BHT_DB_BRANCH = "dev";
});

const partnerAdminUser: SessionUser = {
  userId: 1,
  username: "socio_admin",
  fullName: "Asistente Operativo",
  role: "PARTNER_ADMIN",
  defaultCashAccountId: 1,
};

const sellerUser: SessionUser = {
  userId: 3,
  username: "vendedor1",
  fullName: "Vendedor",
  role: "EXTERNAL_SELLER",
  defaultCashAccountId: 1,
};

const warehouseUser: SessionUser = {
  userId: 4,
  username: "almacen1",
  fullName: "Encargado de Almacén",
  role: "WAREHOUSE_DELIVERY",
  defaultCashAccountId: null,
};

const partnerAdminToken = signTestSessionToken(partnerAdminUser);
const sellerToken = signTestSessionToken(sellerUser);
const whToken = signTestSessionToken(warehouseUser);

describe("/api/sync Live Sync Engine, Auth & RBAC", () => {
  it("rejects unauthenticated and invalid-token requests with 401 and Cache-Control: no-store", async () => {
    const unauthJson = await getSync(new NextRequest("http://localhost:3000/api/sync"));
    expect(unauthJson.status).toBe(401);
    expect(unauthJson.headers.get("cache-control")).toContain("no-store");

    const invalidToken = await getSync(
      new NextRequest("http://localhost:3000/api/sync", {
        headers: { cookie: "bht_session=invalid.tampered.token" },
      })
    );
    expect(invalidToken.status).toBe(401);

    const unauthSse = await getSync(
      new NextRequest("http://localhost:3000/api/sync", {
        headers: { accept: "text/event-stream" },
      })
    );
    expect(unauthSse.status).toBe(401);
  });

  it("enforces strict RBAC scope filtering and strips all pricing/financial metadata for WAREHOUSE_DELIVERY", async () => {
    const whRes = await getSync(
      new NextRequest(
        "http://localhost:3000/api/sync?since=stale-token&scopes=orders,purchases,collections,treasury,partners",
        {
          headers: { cookie: `bht_session=${whToken}` },
        }
      )
    );
    expect(whRes.status).toBe(200);
    expect(whRes.headers.get("cache-control")).toContain("no-store");

    const whBody = await whRes.json();
    expect(whBody.allowedScopes).toEqual(["orders", "inventory"]);
    expect(whBody.changedScopes).toEqual(["orders"]);
    expect(whBody.version).toMatch(/^v1\.w\./);
    expect(JSON.stringify(whBody)).not.toMatch(
      /price|cost|collections|treasury|purchases|partners|list_sale_price|ref_cost|balance_due|total_pen/i
    );

    const whDisallowedScopeOnlyRes = await getSync(
      new NextRequest(
        "http://localhost:3000/api/sync?since=stale-token&scopes=partners",
        {
          headers: { cookie: `bht_session=${whToken}` },
        }
      )
    );
    expect(whDisallowedScopeOnlyRes.status).toBe(200);
    const whDisallowedScopeOnlyBody = await whDisallowedScopeOnlyRes.json();
    expect(whDisallowedScopeOnlyBody.allowedScopes).toEqual(["orders", "inventory"]);
    expect(whDisallowedScopeOnlyBody.changedScopes).toEqual([]);

    const sellerRes = await getSync(
      new NextRequest("http://localhost:3000/api/sync?since=stale-token", {
        headers: { cookie: `bht_session=${sellerToken}` },
      })
    );
    expect(sellerRes.status).toBe(200);
    const sellerBody = await sellerRes.json();
    expect(sellerBody.allowedScopes).toEqual([
      "orders",
      "inventory",
      "collections",
      "treasury",
    ]);
    expect(sellerBody.changedScopes).toEqual([
      "orders",
      "inventory",
      "collections",
      "treasury",
    ]);
    expect(sellerBody.version).toMatch(/^v1\.s\./);

    const partnerRes = await getSync(
      new NextRequest("http://localhost:3000/api/sync?since=stale-token", {
        headers: { cookie: `bht_session=${partnerAdminToken}` },
      })
    );
    expect(partnerRes.status).toBe(200);
    const partnerBody = await partnerRes.json();
    expect(partnerBody.allowedScopes).toEqual([
      "orders",
      "inventory",
      "collections",
      "treasury",
      "purchases",
      "partners",
    ]);
    expect(partnerBody.version).toMatch(/^v1\.p\./);
  });

  it("produces deterministic version watermarks and empty changedScopes when unchanged", async () => {
    const firstRes = await getSync(
      new NextRequest("http://localhost:3000/api/sync", {
        headers: { cookie: `bht_session=${partnerAdminToken}` },
      })
    );
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json();
    expect(first.changedScopes).toEqual([]);
    expect(typeof first.version).toBe("string");

    const secondRes = await getSync(
      new NextRequest(
        `http://localhost:3000/api/sync?since=${encodeURIComponent(first.version)}`,
        {
          headers: { cookie: `bht_session=${partnerAdminToken}` },
        }
      )
    );
    expect(secondRes.status).toBe(200);
    const second = await secondRes.json();
    expect(second.version).toBe(first.version);
    expect(second.changedScopes).toEqual([]);

    // Cross-role cursor is rejected safely and triggers full role-allowed scope refresh
    const whBaselineRes = await getSync(
      new NextRequest("http://localhost:3000/api/sync", {
        headers: { cookie: `bht_session=${whToken}` },
      })
    );
    const whBaseline = await whBaselineRes.json();

    const crossRoleRes = await getSync(
      new NextRequest(
        `http://localhost:3000/api/sync?since=${encodeURIComponent(whBaseline.version)}`,
        {
          headers: { cookie: `bht_session=${partnerAdminToken}` },
        }
      )
    );
    const crossRole = await crossRoleRes.json();
    expect(crossRole.changedScopes).toEqual(crossRole.allowedScopes);
  });

  it("isolates pricing changes from WAREHOUSE_DELIVERY/EXTERNAL_SELLER while reflecting operational updates across roles", async () => {
    const client = await getPool("dev").connect();
    try {
      await client.query("BEGIN");

      const wh0 = await computeSyncSnapshot(client, warehouseUser);
      const seller0 = await computeSyncSnapshot(client, sellerUser);
      const partner0 = await computeSyncSnapshot(client, partnerAdminUser);

      // Simulate partner updating ref_cost_pen ONLY: partner sees inventory+partners change;
      // seller and warehouse do NOT receive cost metadata signal.
      await client.query(
        `UPDATE erp.products
         SET ref_cost_pen = COALESCE(ref_cost_pen, 10) + 1.25,
             updated_at = NOW()
         WHERE product_id = (SELECT product_id FROM erp.products ORDER BY product_id ASC LIMIT 1)`
      );

      const whAfterCost = await computeSyncSnapshot(client, warehouseUser, wh0.version);
      const sellerAfterCost = await computeSyncSnapshot(
        client,
        sellerUser,
        seller0.version
      );
      const partnerAfterCost = await computeSyncSnapshot(
        client,
        partnerAdminUser,
        partner0.version
      );

      expect(whAfterCost.version).toBe(wh0.version);
      expect(whAfterCost.changedScopes).toEqual([]);
      expect(sellerAfterCost.version).toBe(seller0.version);
      expect(sellerAfterCost.changedScopes).toEqual([]);
      expect(partnerAfterCost.version).not.toBe(partner0.version);
      expect(partnerAfterCost.changedScopes).toEqual(
        expect.arrayContaining(["inventory", "partners"])
      );
      expect(partnerAfterCost.changedScopes).not.toContain("orders");

      // Simulate an operational order arriving in warehouse queue
      await client.query(
        `INSERT INTO erp.sales_orders (
           order_code, order_date, warehouse_id, customer_name_raw,
           payment_mode, operational_status, total_pen, paid_pen,
           stock_deducted, source_origin
         ) VALUES (
           'SO-TEST-SYNC-999999', CURRENT_DATE,
           (SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1),
           'CLIENTE TEST SYNC', 'CASH', 'REGISTERED', 100, 0, TRUE, 'ERP_APP'
         )`
      );

      const whAfterOrder = await computeSyncSnapshot(
        client,
        warehouseUser,
        wh0.version
      );
      expect(whAfterOrder.changedScopes).toEqual(["orders"]);

      const partnerAfterOrder = await computeSyncSnapshot(
        client,
        partnerAdminUser,
        partnerAfterCost.version
      );
      expect(partnerAfterOrder.changedScopes).toEqual(
        expect.arrayContaining(["orders", "collections", "partners"])
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("streams an initial SSE sync event and tears down cleanly on abort", async () => {
    const controller = new AbortController();
    const res = await getSync(
      new NextRequest("http://localhost:3000/api/sync", {
        headers: {
          cookie: `bht_session=${partnerAdminToken}`,
          accept: "text/event-stream",
        },
        signal: controller.signal,
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const firstChunk = await reader!.read();
    expect(firstChunk.done).toBe(false);

    const text = new TextDecoder().decode(firstChunk.value);
    expect(text).toContain("event: sync");
    expect(text).toContain('"version":"v1.p.');

    controller.abort();
    await reader!.cancel();
  });
});
