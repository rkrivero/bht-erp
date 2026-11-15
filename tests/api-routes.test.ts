import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signSessionToken } from "../src/lib/auth";
import { GET as getOrders } from "../src/app/api/orders/route";
import { GET as getCollections } from "../src/app/api/collections/route";

describe("API Route Role Enforcement & Financial Isolation", () => {
  it("blocks WAREHOUSE_DELIVERY from /api/collections and strips financial fields on /api/orders", async () => {
    const whToken = signSessionToken({
      userId: 4,
      username: "almacen1",
      fullName: "Encargado de Almacén",
      role: "WAREHOUSE_DELIVERY",
      defaultCashAccountId: null,
    });

    const collectionsReq = new NextRequest("http://localhost:3000/api/collections", {
      headers: { cookie: `bht_session=${whToken}` },
    });
    const colRes = await getCollections(collectionsReq);
    expect(colRes.status).toBe(403);

    const ordersReq = new NextRequest("http://localhost:3000/api/orders", {
      headers: { cookie: `bht_session=${whToken}` },
    });
    const ordRes = await getOrders(ordersReq);
    expect(ordRes.status).toBe(200);
    const body = await ordRes.json();
    expect(Array.isArray(body.orders)).toBe(true);
    for (const p of body.catalog) {
      expect(p).not.toHaveProperty("list_sale_price_pen");
      expect(p).not.toHaveProperty("ref_cost_pen");
    }
  });
});
