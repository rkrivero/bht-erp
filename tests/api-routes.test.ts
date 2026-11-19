import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signTestSessionToken } from "../src/lib/auth/test-session";
import { getPool, resolveDatabaseUrl } from "../src/lib/db";
import { GET as getOrders } from "../src/app/api/orders/route";
import { GET as getCollections } from "../src/app/api/collections/route";
import {
  GET as getPartners,
  POST as postPartners,
} from "../src/app/api/partners/route";
import { GET as getTreasury } from "../src/app/api/treasury/route";
import {
  GET as getPurchases,
  POST as postPurchases,
} from "../src/app/api/purchases/route";
import { GET as getReports } from "../src/app/api/reports/route";

beforeAll(() => {
  process.env.BHT_DB_BRANCH = "dev";
});

const sellerToken = signTestSessionToken({
  userId: 3,
  username: "vendedor1",
  fullName: "Vendedor Externo Ruta",
  role: "EXTERNAL_SELLER",
  defaultCashAccountId: 1,
});

const partnerAdminToken = signTestSessionToken({
  userId: 1,
  username: "socio_admin",
  fullName: "Socio Operativo y Admin",
  role: "PARTNER_ADMIN",
  defaultCashAccountId: 1,
});

const partnerManagerToken = signTestSessionToken({
  userId: 2,
  username: "socio_gerente",
  fullName: "Socio Gerente",
  role: "PARTNER_MANAGER",
  defaultCashAccountId: 1,
});

const whToken = signTestSessionToken({
  userId: 4,
  username: "almacen1",
  fullName: "Encargado de Almacén",
  role: "WAREHOUSE_DELIVERY",
  defaultCashAccountId: null,
});

describe("API Route Role Enforcement, DB Branch Isolation & Endpoint Contracts", () => {
  it("resolves distinct Neon dev and main connection strings", () => {
    const devUrl = resolveDatabaseUrl("dev");
    const mainUrl = resolveDatabaseUrl("main");
    expect(devUrl).toBeTruthy();
    expect(mainUrl).toBeTruthy();
    expect(devUrl).not.toBe(mainUrl);
  });

  it("blocks EXTERNAL_SELLER from /api/partners and returns corrected KPIs, currentUser, and biSummary for PARTNER_ADMIN", async () => {
    const forbiddenReq = new NextRequest("http://localhost:3000/api/partners", {
      headers: { cookie: `bht_session=${sellerToken}` },
    });
    const forbiddenRes = await getPartners(forbiddenReq);
    expect(forbiddenRes.status).toBe(403);

    const okReq = new NextRequest("http://localhost:3000/api/partners", {
      headers: { cookie: `bht_session=${partnerAdminToken}` },
    });
    const okRes = await getPartners(okReq);
    expect(okRes.status).toBe(200);
    const body = await okRes.json();

    expect(body.currentUser).toMatchObject({
      userId: 1,
      username: "socio_admin",
      role: "PARTNER_ADMIN",
    });
    expect(body.kpiQ1).toBeDefined();
    expect(body.kpiQ1.cash_collected_pen).toBeGreaterThan(0);
    expect(body.kpiQ1.collected_sales_pen).toBe(body.kpiQ1.cash_collected_pen);
    expect(body.kpiQ1.accounts_receivable_pen).toBe(45745);
    expect(body.kpiQ1.open_debtors_count).toBe(13);
    expect(body.openDebtorsCount).toBe(13);
    expect(body.kpiQ1.pre_route_foundational_outflow_pen).toBe(81267.86);
    expect(body.kpiQ1.reconciliation_gap_pen).toBe(290);
    expect(body.kpiQ1.reconciliation_gap_pct).not.toBe(0.99);
    expect(body.kpiQ1.reconciliation_gap_pct).toBeCloseTo(1.62, 2);

    expect(Array.isArray(body.pendingOnDemand)).toBe(true);
    expect(Array.isArray(body.qualityGaps)).toBe(true);
    expect(body.biSummary).toBeDefined();
    expect(Array.isArray(body.biSummary.monthlyPerformance)).toBe(true);
    expect(Array.isArray(body.biSummary.cashAccountsSummary)).toBe(true);
    expect(Array.isArray(body.biSummary.topCustomers)).toBe(true);
    expect(Array.isArray(body.biSummary.lowStockAlerts)).toBe(true);
    expect(Array.isArray(body.biSummary.marginRiskSkus)).toBe(true);
    expect(Array.isArray(body.biSummary.apSummaryBySupplier)).toBe(true);
    expect(body.dataCut).toBeDefined();
    expect(body.dataCut.asOfLimaDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.dataCut.lastOrderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof body.dataCut.bankReconciled).toBe("boolean");
    expect(body.operationalQuality).toBeDefined();
    expect(body.operationalQuality.registrationCoverage24h).toBeDefined();
    expect(body.operationalQuality.startupChecklist).toHaveLength(6);
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.length).toBeGreaterThan(0);

    const mgrReq = new NextRequest("http://localhost:3000/api/partners", {
      headers: { cookie: `bht_session=${partnerManagerToken}` },
    });
    const mgrRes = await getPartners(mgrReq);
    expect(mgrRes.status).toBe(200);
    const mgrBody = await mgrRes.json();
    expect(mgrBody.currentUser).toMatchObject({
      userId: 2,
      role: "PARTNER_MANAGER",
    });
    expect(mgrBody.dataCut).toBeDefined();
    expect(mgrBody.operationalQuality).toBeDefined();
    expect(mgrBody.users).toEqual([]);
    expect(mgrBody.userAccessHistory).toEqual([]);
  });

  it("blocks WAREHOUSE_DELIVERY from /api/collections and strips financial fields on /api/orders", async () => {
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
    expect(body.catalog).toEqual([]);
    expect(body.pagination).toEqual(
      expect.objectContaining({
        limit: expect.any(Number),
        offset: 0,
        totalCount: expect.any(Number),
        hasMore: expect.any(Boolean),
      })
    );

    const pagedOrdersReq = new NextRequest(
      "http://localhost:3000/api/orders?limit=5&offset=5",
      {
        headers: { cookie: `bht_session=${whToken}` },
      }
    );
    const pagedRes = await getOrders(pagedOrdersReq);
    expect(pagedRes.status).toBe(200);
    const pagedBody = await pagedRes.json();
    expect(Array.isArray(pagedBody.orders)).toBe(true);
    expect(pagedBody.orders.length).toBeLessThanOrEqual(5);
    expect(pagedBody.pagination).toEqual(
      expect.objectContaining({
        limit: 5,
        offset: 5,
      })
    );

    const customerPartyId = body.orders.find(
      (order: { customer_party_id?: number | null }) => order.customer_party_id
    )?.customer_party_id;
    if (customerPartyId) {
      const customerOrdersReq = new NextRequest(
        `http://localhost:3000/api/orders?customer_party_id=${customerPartyId}&include_refs=false`,
        { headers: { cookie: `bht_session=${whToken}` } }
      );
      const customerOrdersRes = await getOrders(customerOrdersReq);
      expect(customerOrdersRes.status).toBe(200);
      const customerOrdersBody = await customerOrdersRes.json();
      expect(customerOrdersBody.orders.length).toBeGreaterThan(0);
      expect(
        customerOrdersBody.orders.every(
          (order: { customer_party_id?: number | null }) =>
            order.customer_party_id === customerPartyId
        )
      ).toBe(true);
      expect(customerOrdersBody.catalog).toEqual([]);
      expect(customerOrdersBody.accounts).toEqual([]);
    }
  });

  it("returns valid AP obligation columns, suppliers, and accounts on GET /api/treasury for partners and hides AP/suppliers from seller", async () => {
    const whReq = new NextRequest("http://localhost:3000/api/treasury", {
      headers: { cookie: `bht_session=${whToken}` },
    });
    const whRes = await getTreasury(whReq);
    expect(whRes.status).toBe(403);

    const sellerReq = new NextRequest("http://localhost:3000/api/treasury", {
      headers: { cookie: `bht_session=${sellerToken}` },
    });
    const sellerRes = await getTreasury(sellerReq);
    expect(sellerRes.status).toBe(200);
    const sellerBody = await sellerRes.json();
    expect(sellerBody.apObligations).toEqual([]);
    expect(sellerBody.suppliers).toEqual([]);
    expect(Array.isArray(sellerBody.accounts)).toBe(true);

    const partnerReq = new NextRequest("http://localhost:3000/api/treasury", {
      headers: { cookie: `bht_session=${partnerAdminToken}` },
    });
    const partnerRes = await getTreasury(partnerReq);
    expect(partnerRes.status).toBe(200);
    const body = await partnerRes.json();
    expect(Array.isArray(body.ledger)).toBe(true);
    expect(Array.isArray(body.apObligations)).toBe(true);
    expect(body.apObligations.length).toBeGreaterThan(0);
    const firstAp = body.apObligations[0];
    expect(typeof firstAp.ap_id).toBe("number");
    expect(typeof firstAp.balance_due_pen).toBe("number");
    expect(firstAp).toHaveProperty("supplier_name");
    expect(firstAp).toHaveProperty("original_amount_pen");
    expect(firstAp).toHaveProperty("paid_amount_pen");
    expect(["OPEN", "PARTIAL"]).toContain(firstAp.status);
    expect(Array.isArray(firstAp.lines)).toBe(true);
    expect(firstAp.lines.length).toBeGreaterThan(0);
    expect(firstAp.lines[0]).toHaveProperty("unit_of_measure");
    expect(firstAp.lines[0]).toHaveProperty("raw_description");
    expect(Array.isArray(firstAp.payments)).toBe(true);

    expect(Array.isArray(body.suppliers)).toBe(true);
    expect(body.suppliers.length).toBeGreaterThan(0);
    expect(Array.isArray(body.accounts)).toBe(true);
    expect(body.accounts.length).toBeGreaterThan(0);
  });

  it("enforces partner-only RBAC on /api/purchases and /api/reports, and exports UTF-8 BOM CSVs", async () => {
    for (const token of [sellerToken, whToken]) {
      const purGet = await getPurchases(
        new NextRequest("http://localhost:3000/api/purchases", {
          headers: { cookie: `bht_session=${token}` },
        })
      );
      expect(purGet.status).toBe(403);

      const purPost = await postPurchases(
        new NextRequest("http://localhost:3000/api/purchases", {
          method: "POST",
          headers: {
            cookie: `bht_session=${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "create_supplier", legalName: "Test" }),
        })
      );
      expect(purPost.status).toBe(403);

      const repGet = await getReports(
        new NextRequest("http://localhost:3000/api/reports?dataset=bi_summary", {
          headers: { cookie: `bht_session=${token}` },
        })
      );
      expect(repGet.status).toBe(403);

      const secForbidden = await getReports(
        new NextRequest("http://localhost:3000/api/reports?section=resumen", {
          headers: { cookie: `bht_session=${token}` },
        })
      );
      expect(secForbidden.status).toBe(403);
    }

    const purOk = await getPurchases(
      new NextRequest("http://localhost:3000/api/purchases", {
        headers: { cookie: `bht_session=${partnerManagerToken}` },
      })
    );
    expect(purOk.status).toBe(200);
    const purBody = await purOk.json();
    expect(Array.isArray(purBody.suppliers)).toBe(true);
    expect(Array.isArray(purBody.recentPurchases)).toBe(true);
    expect(Array.isArray(purBody.pendingOnDemand)).toBe(true);
    expect(Array.isArray(purBody.apObligations)).toBe(true);
    expect(purBody.apObligations.length).toBeGreaterThan(0);
    expect(Array.isArray(purBody.apObligations[0].lines)).toBe(true);
    expect(purBody.apObligations[0].lines.length).toBeGreaterThan(0);
    expect(purBody.apObligations[0].lines[0]).toHaveProperty("unit_of_measure");
    expect(Array.isArray(purBody.accounts)).toBe(true);

    const invalidDatasetRes = await getReports(
      new NextRequest("http://localhost:3000/api/reports?dataset=no_existe", {
        headers: { cookie: `bht_session=${partnerAdminToken}` },
      })
    );
    expect(invalidDatasetRes.status).toBe(400);

    const biRes = await getReports(
      new NextRequest("http://localhost:3000/api/reports?dataset=bi_summary", {
        headers: { cookie: `bht_session=${partnerAdminToken}` },
      })
    );
    expect(biRes.status).toBe(200);
    const biBody = await biRes.json();
    expect(biBody.biSummary).toBeDefined();
    expect(biBody.biSummary.monthlyPerformance.length).toBeGreaterThanOrEqual(4);

    const csvRes = await getReports(
      new NextRequest(
        "http://localhost:3000/api/reports?dataset=proveedores_cxp&format=csv",
        {
          headers: { cookie: `bht_session=${partnerAdminToken}` },
        }
      )
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    expect(csvRes.headers.get("content-disposition")).toMatch(
      /^attachment; filename="bht_proveedores_cxp_\d{4}-\d{2}-\d{2}\.csv"$/
    );
    const rawBytes = new Uint8Array(await csvRes.arrayBuffer());
    expect(Array.from(rawBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(rawBytes);
    expect(csvText.charCodeAt(0)).toBe(0xfeff);
    expect(csvText).toContain("ap_id,supplier_party_id,supplier_name");

    const badSectionRes = await getReports(
      new NextRequest("http://localhost:3000/api/reports?section=no_existe", {
        headers: { cookie: `bht_session=${partnerAdminToken}` },
      })
    );
    expect(badSectionRes.status).toBe(400);

    const invertedRangeRes = await getReports(
      new NextRequest(
        "http://localhost:3000/api/reports?section=resumen&from=2026-09-30&to=2026-06-01",
        {
          headers: { cookie: `bht_session=${partnerAdminToken}` },
        }
      )
    );
    expect(invertedRangeRes.status).toBe(400);

    for (const sec of [
      "resumen",
      "caja_cxp",
      "cartera",
      "comercial",
      "stock",
      "auditoria",
    ]) {
      const secRes = await getReports(
        new NextRequest(`http://localhost:3000/api/reports?section=${sec}`, {
          headers: { cookie: `bht_session=${partnerManagerToken}` },
        })
      );
      expect(secRes.status).toBe(200);
      const secBody = await secRes.json();
      expect(secBody.section).toBe(sec);
      expect(secBody.data).toBeDefined();
    }

    for (const ds of ["valorizacion_inventario_corte", "aging_cxc_cxp_corte"]) {
      const newCsvRes = await getReports(
        new NextRequest(`http://localhost:3000/api/reports?dataset=${ds}&format=csv`, {
          headers: { cookie: `bht_session=${partnerAdminToken}` },
        })
      );
      expect(newCsvRes.status).toBe(200);
      const bytes = new Uint8Array(await newCsvRes.arrayBuffer());
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    }
  });

  it("restricts access administration to PARTNER_ADMIN and protects the active admin", async () => {
    const sellerRes = await postPartners(
      new NextRequest("http://localhost:3000/api/partners", {
        method: "POST",
        headers: {
          cookie: `bht_session=${sellerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "toggle_user_active", userId: 3 }),
      })
    );
    expect(sellerRes.status).toBe(403);

    const whRes = await postPartners(
      new NextRequest("http://localhost:3000/api/partners", {
        method: "POST",
        headers: {
          cookie: `bht_session=${whToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "toggle_user_active", userId: 3 }),
      })
    );
    expect(whRes.status).toBe(403);

    const selfDisableAdminRes = await postPartners(
      new NextRequest("http://localhost:3000/api/partners", {
        method: "POST",
        headers: {
          cookie: `bht_session=${partnerAdminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "toggle_user_active", userId: 1 }),
      })
    );
    expect(selfDisableAdminRes.status).toBe(400);

    const selfDisableMgrRes = await postPartners(
      new NextRequest("http://localhost:3000/api/partners", {
        method: "POST",
        headers: {
          cookie: `bht_session=${partnerManagerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "toggle_user_active", userId: 2 }),
      })
    );
    expect(selfDisableMgrRes.status).toBe(403);

    // Transactional check inside BEGIN/ROLLBACK on dev
    const client = await getPool("dev").connect();
    try {
      await client.query("BEGIN");
      const before = await client.query(
        `SELECT is_active FROM erp.app_users WHERE user_id = 3`
      );
      expect(before.rows[0].is_active).toBe(true);
      await client.query(
        `UPDATE erp.app_users SET is_active = FALSE WHERE user_id = 3`
      );
      const after = await client.query(
        `SELECT is_active FROM erp.app_users WHERE user_id = 3`
      );
      expect(after.rows[0].is_active).toBe(false);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("allows only PARTNER_ADMIN to manage users and rejects invalid names", async () => {
    const sellerRes = await postPartners(
      new NextRequest("http://localhost:3000/api/partners", {
        method: "POST",
        headers: {
          cookie: `bht_session=${sellerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update_user_name",
          userId: 1,
          fullName: "Renzo",
        }),
      })
    );
    expect(sellerRes.status).toBe(403);

    const managerRes = await postPartners(
      new NextRequest("http://localhost:3000/api/partners", {
        method: "POST",
        headers: {
          cookie: `bht_session=${partnerManagerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update_user_name",
          userId: 1,
          fullName: "A",
        }),
      })
    );
    expect(managerRes.status).toBe(403);

    const shortRes = await postPartners(
      new NextRequest("http://localhost:3000/api/partners", {
        method: "POST",
        headers: {
          cookie: `bht_session=${partnerAdminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update_user_name",
          userId: 1,
          fullName: "A",
        }),
      })
    );
    expect(shortRes.status).toBe(400);

    const { vi } = await import("vitest");
    const dbMod = await import("../src/lib/db");
    const { resolveHttpError } = await import("../src/lib/http-errors");
    const ordersRoute = await import("../src/app/api/orders/route");
    const collectionsRoute = await import("../src/app/api/collections/route");
    const treasuryRoute = await import("../src/app/api/treasury/route");
    const purchasesRoute = await import("../src/app/api/purchases/route");
    const tripsRoute = await import("../src/app/api/trips/route");
    const quotesRoute = await import("../src/app/api/quotes/route");
    const auditFlagsRoute = await import("../src/app/api/audit-flags/route");

    const pool = dbMod.getPool("dev");
    const client = await pool.connect();
    let spCounter = 0;
    const spyClient = vi
      .spyOn(dbMod, "withClient")
      .mockImplementation(async (fn) => await fn(client));
    const spyTx = vi.spyOn(dbMod, "withTransaction").mockImplementation(async (fn) => {
      const sp = `sp_route_${++spCounter}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const out = await fn(client);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        return out;
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw err;
      }
    });

    try {
      await client.query("BEGIN");

      // 1. Update user name inside isolated transaction (zero committed mutations on dev)
      const okRes = await postPartners(
        new NextRequest("http://localhost:3000/api/partners", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerAdminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update_user_name",
            userId: 3,
            fullName: "Carlos Ruta",
          }),
        })
      );
      expect(okRes.status).toBe(200);
      const okJson = await okRes.json();
      expect(okJson.user.full_name).toBe("Carlos Ruta");

      const createRes = await postPartners(
        new NextRequest("http://localhost:3000/api/partners", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerAdminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create_user",
            username: "prueba.admin.ui",
            fullName: "Usuario de Prueba",
            email: "prueba.admin.ui@example.com",
            role: "EXTERNAL_SELLER",
          }),
        })
      );
      expect(createRes.status).toBe(200);
      const created = (await createRes.json()).user;
      expect(created.role).toBe("EXTERNAL_SELLER");

      const roleRes = await postPartners(
        new NextRequest("http://localhost:3000/api/partners", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerAdminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update_user_role",
            userId: created.user_id,
            role: "WAREHOUSE_DELIVERY",
          }),
        })
      );
      expect(roleRes.status).toBe(200);
      expect((await roleRes.json()).user.role).toBe("WAREHOUSE_DELIVERY");

      const deleteRes = await postPartners(
        new NextRequest("http://localhost:3000/api/partners", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerAdminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "delete_user",
            userId: created.user_id,
          }),
        })
      );
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()).deletedUserId).toBe(created.user_id);
      const deletedRow = await client.query<{
        is_active: boolean;
        email: string | null;
        username: string;
      }>(
        `SELECT is_active, email, username
         FROM erp.app_users
         WHERE user_id = $1`,
        [created.user_id]
      );
      expect(deletedRow.rows[0].is_active).toBe(false);
      expect(deletedRow.rows[0].email).toBeNull();
      expect(deletedRow.rows[0].username).toContain("__deleted_");

      const accessAudit = await client.query<{ action: string }>(
        `SELECT action
         FROM erp.user_access_audit_log
         WHERE target_user_id = $1
         ORDER BY audit_id ASC`,
        [created.user_id]
      );
      expect(accessAudit.rows.map((row) => row.action)).toEqual([
        "USER_CREATED",
        "USER_ROLE_CHANGED",
        "USER_DEACTIVATED",
      ]);

      // Sign fresh version-bound tokens from DB state inside this transaction
      const usersRes = await client.query<{
        user_id: number;
        username: string;
        full_name: string;
        role:
          | "PARTNER_ADMIN"
          | "PARTNER_MANAGER"
          | "EXTERNAL_SELLER"
          | "WAREHOUSE_DELIVERY";
        default_cash_account_id: number | null;
      }>(
        `SELECT user_id, username, full_name, role::text AS role, default_cash_account_id
         FROM erp.app_users WHERE user_id IN (1, 2, 3, 4)`
      );
      const tokenFor = (uid: number) => {
        const u = usersRes.rows.find((r) => Number(r.user_id) === uid)!;
        return signTestSessionToken({
          userId: Number(u.user_id),
          username: String(u.username),
          fullName: String(u.full_name),
          role: u.role,
          defaultCashAccountId:
            u.default_cash_account_id !== null
              ? Number(u.default_cash_account_id)
              : null,
        });
      };
      const adminTok = tokenFor(1);
      const sellerTok = tokenFor(3);
      const whTok = tokenFor(4);

      // Seed MAIN stock product + supplier + accounts
      const whRes = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);
      const prodRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-HTTP-ROUTE-01', 'BOMBA RUTA HTTP TEST', 'NIU', 'STOCKED', 100, 90, 60)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);
      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 25, 60, 'SEED_HTTP_ROUTE_TEST')`,
        [warehouseId, productId]
      );

      const { createSupplier } =
        await import("../src/lib/services/purchases-and-suppliers");
      const { supplier } = await createSupplier(
        client,
        {
          userId: 1,
          username: "socio_admin",
          fullName: "Socio Operativo y Admin",
          role: "PARTNER_ADMIN",
          defaultCashAccountId: 1,
        },
        {
          legalName: "PROVEEDOR HTTP TEST SAC",
          tradeName: "PROVEEDOR HTTP TEST",
          docType: "RUC",
          docNumber: "20987654321",
        }
      );
      const supplierPartyId = supplier.party_id;

      const accRes = await client.query<{ account_id: number; account_type: string }>(
        `SELECT account_id, account_type FROM erp.cash_accounts WHERE is_active = TRUE ORDER BY account_id ASC`
      );
      const nonCustodyAccs = accRes.rows.filter(
        (a) => a.account_type !== "PARTNER_CUSTODY"
      );
      const custodyAcc = accRes.rows.find((a) => a.account_type === "PARTNER_CUSTODY");
      const sellerAccId = Number(nonCustodyAccs[0].account_id);
      const secondAccId = Number(
        (custodyAcc ?? nonCustodyAccs[1] ?? nonCustodyAccs[0]).account_id
      );

      // 2. POST /api/orders: create + below-cost approval + collection blocking + warehouse READY
      const createOrdRes = await ordersRoute.POST(
        new NextRequest("http://localhost:3000/api/orders", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            customerNameRaw: "CLIENTE HTTP CREDIT",
            paymentMode: "CREDIT",
            creditDays: 7,
            initialPaidPen: 50,
            lines: [{ productId, quantity: 3, unitDiscountPen: 0 }],
          }),
        })
      );
      expect(createOrdRes.status).toBe(200);
      const createdOrd = await createOrdRes.json();
      expect(createdOrd.orderId).toBeGreaterThan(0);

      const pendingOrdRes = await ordersRoute.POST(
        new NextRequest("http://localhost:3000/api/orders", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            customerNameRaw: "CLIENTE HTTP FLOOR",
            paymentMode: "CREDIT",
            creditDays: 7,
            lines: [{ productId, quantity: 2, unitDiscountPen: 45 }],
          }),
        })
      );
      expect(pendingOrdRes.status).toBe(200);
      const pendingOrd = await pendingOrdRes.json();
      expect(pendingOrd.operationalStatus).toBe("PENDING_PARTNER_APPROVAL");

      // Collections must reject PENDING_PARTNER_APPROVAL order
      const payPendingRes = await collectionsRoute.POST(
        new NextRequest("http://localhost:3000/api/collections", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "single_order",
            orderId: pendingOrd.orderId,
            amountPen: 20,
            paymentMode: "CASH",
          }),
        })
      );
      expect(payPendingRes.status).toBe(400);

      // Approve discounted order as PARTNER_ADMIN
      const approveRes = await ordersRoute.POST(
        new NextRequest("http://localhost:3000/api/orders", {
          method: "POST",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "approve", orderId: pendingOrd.orderId }),
        })
      );
      expect(approveRes.status).toBe(200);

      // Advance created order to READY so we can dispatch it in a trip
      const readyRes = await ordersRoute.POST(
        new NextRequest("http://localhost:3000/api/orders", {
          method: "POST",
          headers: {
            cookie: `bht_session=${whTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "advance",
            orderId: createdOrd.orderId,
            nextStatus: "READY",
          }),
        })
      );
      expect(readyRes.status).toBe(200);

      // 3. GET/POST /api/trips + IN_ROUTE dispatch + financial RBAC checks
      const createTripRes = await tripsRoute.POST(
        new NextRequest("http://localhost:3000/api/trips", {
          method: "POST",
          headers: {
            cookie: `bht_session=${whTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create_trip",
            zoneName: "CONO SUR",
            driverName: "Almacen Test",
          }),
        })
      );
      expect(createTripRes.status).toBe(200);
      const createdTrip = await createTripRes.json();
      expect(createdTrip.status).toBe("OPEN");

      const assignRes = await tripsRoute.POST(
        new NextRequest("http://localhost:3000/api/trips", {
          method: "POST",
          headers: {
            cookie: `bht_session=${whTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "assign_order",
            tripId: createdTrip.tripId,
            orderId: createdOrd.orderId,
            advanceToInRoute: true,
          }),
        })
      );
      expect(assignRes.status).toBe(200);
      const assignedJson = await assignRes.json();
      expect(assignedJson.operationalStatus).toBe("IN_ROUTE");

      const whTripsGet = await tripsRoute.GET(
        new NextRequest("http://localhost:3000/api/trips", {
          headers: { cookie: `bht_session=${whTok}` },
        })
      );
      expect(whTripsGet.status).toBe(200);
      const whTripsJson = await whTripsGet.json();
      expect(JSON.stringify(whTripsJson)).not.toMatch(
        /computed_sales_pen|declared_gross_sales_pen/
      );

      const whReconcileRes = await tripsRoute.POST(
        new NextRequest("http://localhost:3000/api/trips", {
          method: "POST",
          headers: {
            cookie: `bht_session=${whTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "close_trip",
            tripId: createdTrip.tripId,
            nextStatus: "RECONCILED",
          }),
        })
      );
      expect(whReconcileRes.status).toBe(403);

      // 4. GET/POST /api/quotes + RBAC + convert_to_order
      const whQuoteGet = await quotesRoute.GET(
        new NextRequest("http://localhost:3000/api/quotes", {
          headers: { cookie: `bht_session=${whTok}` },
        })
      );
      expect(whQuoteGet.status).toBe(403);

      const createQuoteRes = await quotesRoute.POST(
        new NextRequest("http://localhost:3000/api/quotes", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create_quote",
            customerNameRaw: "CLIENTE COTIZACION HTTP",
            lines: [{ productId, quantity: 2, unitPricePen: 100 }],
          }),
        })
      );
      expect(createQuoteRes.status).toBe(200);
      const createdQuote = await createQuoteRes.json();
      expect(createdQuote.status).toBe("OPEN");

      const convertQuoteRes = await quotesRoute.POST(
        new NextRequest("http://localhost:3000/api/quotes", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "convert_to_order",
            quoteId: createdQuote.quoteId,
            paymentMode: "CASH",
          }),
        })
      );
      expect(convertQuoteRes.status).toBe(200);
      const convertedJson = await convertQuoteRes.json();
      expect(convertedJson.order.orderId).toBeGreaterThan(0);

      // Already CONVERTED quote cannot transition to CANCELLED
      const cancelConvertedRes = await quotesRoute.POST(
        new NextRequest("http://localhost:3000/api/quotes", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update_status",
            quoteId: createdQuote.quoteId,
            nextStatus: "CANCELLED",
          }),
        })
      );
      expect(cancelConvertedRes.status).toBe(400);

      // 5. POST /api/collections happy path + overpayment rejection
      const abonoRes = await collectionsRoute.POST(
        new NextRequest("http://localhost:3000/api/collections", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "single_order",
            orderId: createdOrd.orderId,
            amountPen: 100,
            paymentMode: "CASH",
            accountId: sellerAccId,
            nextCollectionDays: 5,
          }),
        })
      );
      expect(abonoRes.status).toBe(200);
      const abonoJson = await abonoRes.json();
      expect(abonoJson.newBalanceDuePen).toBe(150);

      const overpayRes = await collectionsRoute.POST(
        new NextRequest("http://localhost:3000/api/collections", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "single_order",
            orderId: createdOrd.orderId,
            amountPen: 9999,
            paymentMode: "CASH",
          }),
        })
      );
      expect(overpayRes.status).toBe(400);

      // 6. POST /api/treasury RBAC & atomic internal transfer
      const sellerTransferRes = await treasuryRoute.POST(
        new NextRequest("http://localhost:3000/api/treasury", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amountPen: 30,
            isInternalTransfer: true,
            accountId: sellerAccId,
            toAccountId: secondAccId,
            expenseCategory: "TRASLADO_INTERNO",
            description: "Intento seller no permitido",
          }),
        })
      );
      expect(sellerTransferRes.status).toBe(403);

      if (custodyAcc) {
        const sellerCustodyRes = await treasuryRoute.POST(
          new NextRequest("http://localhost:3000/api/treasury", {
            method: "POST",
            headers: {
              cookie: `bht_session=${sellerTok}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              amountPen: 15,
              expenseBucket: "ROUTE_OPEX",
              expenseCategory: "MOVILIDAD",
              description: "Intento cuenta custodia",
              accountId: Number(custodyAcc.account_id),
            }),
          })
        );
        expect(sellerCustodyRes.status).toBe(403);
      }

      const routeOpexRes = await treasuryRoute.POST(
        new NextRequest("http://localhost:3000/api/treasury", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amountPen: 25,
            expenseBucket: "ROUTE_OPEX",
            expenseCategory: "COMBUSTIBLE",
            description: "Combustible test ruta",
            accountId: sellerAccId,
            tripId: createdTrip.tripId,
          }),
        })
      );
      expect(routeOpexRes.status).toBe(200);
      const routeOpexJson = await routeOpexRes.json();

      const badTripExpenseRes = await treasuryRoute.POST(
        new NextRequest("http://localhost:3000/api/treasury", {
          method: "POST",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amountPen: 20,
            expenseBucket: "ROUTE_OPEX",
            expenseCategory: "PEAJE",
            description: "Peaje ruta inexistente",
            accountId: sellerAccId,
            tripId: 99999999,
          }),
        })
      );
      expect(badTripExpenseRes.status).toBe(400);

      const treasuryCheckRes = await treasuryRoute.GET(
        new NextRequest("http://localhost:3000/api/treasury", {
          headers: { cookie: `bht_session=${adminTok}` },
        })
      );
      expect(treasuryCheckRes.status).toBe(200);
      const treasuryCheckJson = await treasuryCheckRes.json();
      const recordedTripExpense = treasuryCheckJson.ledger.find(
        (m: { ledger_id: number }) => m.ledger_id === routeOpexJson.ledgerId
      );
      expect(recordedTripExpense).toBeDefined();
      expect(recordedTripExpense.trip_id).toBe(createdTrip.tripId);
      expect(recordedTripExpense.trip_code).toBe(createdTrip.tripCode);

      if (secondAccId !== sellerAccId) {
        const transferRes = await treasuryRoute.POST(
          new NextRequest("http://localhost:3000/api/treasury", {
            method: "POST",
            headers: {
              cookie: `bht_session=${adminTok}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              amountPen: 40,
              isInternalTransfer: true,
              accountId: sellerAccId,
              toAccountId: secondAccId,
              expenseCategory: "TRASLADO_INTERNO",
              description: "Traslado atomico test",
            }),
          })
        );
        expect(transferRes.status).toBe(200);
      }

      // 7. POST /api/purchases (USD + EXCLUDED IGV) & RBAC
      const sellerPurchaseRes = await purchasesRoute.POST(
        new NextRequest("http://localhost:3000/api/purchases", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "register_purchase" }),
        })
      );
      expect(sellerPurchaseRes.status).toBe(403);

      const purchaseRes = await purchasesRoute.POST(
        new NextRequest("http://localhost:3000/api/purchases", {
          method: "POST",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "register_purchase",
            supplierPartyId,
            docType: "FACTURA",
            docSeries: "F099",
            docNumber: "888777",
            paymentCondition: "CREDIT",
            currency: "USD",
            exchangeRate: 3.75,
            taxMode: "EXCLUDED",
            items: [{ productId, quantity: 2, unitCostPen: 10 }],
          }),
        })
      );
      expect(purchaseRes.status).toBe(200);
      const purchaseJson = await purchaseRes.json();
      expect(purchaseJson.totalPen).toBeCloseTo(88.5, 2);

      // 8. GET/POST /api/audit-flags RBAC + ACKNOWLEDGE -> RESOLVED
      const sellerFlagGet = await auditFlagsRoute.GET(
        new NextRequest("http://localhost:3000/api/audit-flags", {
          headers: { cookie: `bht_session=${sellerTok}` },
        })
      );
      expect(sellerFlagGet.status).toBe(403);

      const whFlagPost = await auditFlagsRoute.POST(
        new NextRequest("http://localhost:3000/api/audit-flags", {
          method: "POST",
          headers: {
            cookie: `bht_session=${whTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "resolve", flagId: 1 }),
        })
      );
      expect(whFlagPost.status).toBe(403);

      const flagIns = await client.query<{ flag_id: string }>(
        `INSERT INTO erp.audit_flags (
           flag_code, severity, entity_table, entity_id, message, status, source_origin
         ) VALUES (
           'TEST_HTTP_FLAG', 'WARNING', 'erp.sales_orders', $1, 'Alerta test HTTP', 'OPEN', 'ERP_APP'
         ) RETURNING flag_id::text AS flag_id`,
        [String(createdOrd.orderId)]
      );
      const flagId = Number(flagIns.rows[0].flag_id);

      const getFlagsRes = await auditFlagsRoute.GET(
        new NextRequest("http://localhost:3000/api/audit-flags?status=OPEN", {
          headers: { cookie: `bht_session=${adminTok}` },
        })
      );
      expect(getFlagsRes.status).toBe(200);
      const flagsBody = await getFlagsRes.json();
      expect(
        flagsBody.flags.some((f: { flag_id: number }) => f.flag_id === flagId)
      ).toBe(true);

      const ackFlagRes = await auditFlagsRoute.POST(
        new NextRequest("http://localhost:3000/api/audit-flags", {
          method: "POST",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "acknowledge",
            flagId,
            resolutionNote: "Revisando",
          }),
        })
      );
      expect(ackFlagRes.status).toBe(200);
      expect((await ackFlagRes.json()).status).toBe("ACKNOWLEDGED");

      const resolveFlagRes = await auditFlagsRoute.POST(
        new NextRequest("http://localhost:3000/api/audit-flags", {
          method: "POST",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "resolve",
            flagId,
            resolutionNote: "Cerrado HTTP",
          }),
        })
      );
      expect(resolveFlagRes.status).toBe(200);
      expect((await resolveFlagRes.json()).status).toBe("RESOLVED");

      // 9. POST /api/partners role validation + instant legacy fixture invalidation
      const badRoleRes = await postPartners(
        new NextRequest("http://localhost:3000/api/partners", {
          method: "POST",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update_user_role",
            userId: 3,
            role: "OWNER",
          }),
        })
      );
      expect(badRoleRes.status).toBe(400);

      const goodRoleRes = await postPartners(
        new NextRequest("http://localhost:3000/api/partners", {
          method: "POST",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update_user_role",
            userId: 3,
            role: "WAREHOUSE_DELIVERY",
          }),
        })
      );
      expect(goodRoleRes.status).toBe(200);

      // The old seller fixture must no longer retain seller access after the role change.
      const staleSessionRes = await quotesRoute.GET(
        new NextRequest("http://localhost:3000/api/quotes", {
          headers: { cookie: `bht_session=${sellerTok}` },
        })
      );
      expect(staleSessionRes.status).toBe(403);

      // 10. PG 23505 (unique violation) -> HTTP 409 & PG 23514 (check constraint) -> HTTP 400
      const dupErr = Object.assign(new Error("duplicate key"), { code: "23505" });
      expect(resolveHttpError(dupErr, "fallback").status).toBe(409);
      const chkErr = Object.assign(new Error("check violation"), { code: "23514" });
      expect(resolveHttpError(chkErr, "fallback").status).toBe(400);

      let pgUniqueCaught: unknown = null;
      try {
        await client.query(`SAVEPOINT sp_pg_23505`);
        await client.query(
          `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen)
           VALUES ('TEST-HTTP-ROUTE-01', 'DUP SKU', 'NIU', 'STOCKED', 10, 10)`
        );
      } catch (e) {
        pgUniqueCaught = e;
        await client.query(`ROLLBACK TO SAVEPOINT sp_pg_23505`);
      }
      expect(resolveHttpError(pgUniqueCaught, "fallback").status).toBe(409);

      let pgCheckCaught: unknown = null;
      try {
        await client.query(`SAVEPOINT sp_pg_23514`);
        await client.query(
          `INSERT INTO erp.cash_ledger (tx_date, account_id, direction, amount_pen, description, source_origin)
           VALUES (CURRENT_DATE, $1, 'OUT', -5, 'INVALID NEGATIVE', 'ERP_APP')`,
          [sellerAccId]
        );
      } catch (e) {
        pgCheckCaught = e;
        await client.query(`ROLLBACK TO SAVEPOINT sp_pg_23514`);
      }
      expect(resolveHttpError(pgCheckCaught, "fallback").status).toBe(400);
    } finally {
      spyTx.mockRestore();
      spyClient.mockRestore();
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }, 60_000);

  it("supports customer dual-naming search, geolocation, RBAC, and supplier directory", async () => {
    const { vi } = await import("vitest");
    const dbMod = await import("../src/lib/db");
    const customersRoute = await import("../src/app/api/customers/route");
    const suppliersRoute = await import("../src/app/api/suppliers/route");

    const pool = dbMod.getPool("dev");
    const client = await pool.connect();
    let spCounter = 0;
    const spyClient = vi
      .spyOn(dbMod, "withClient")
      .mockImplementation(async (fn) => await fn(client));
    const spyTx = vi.spyOn(dbMod, "withTransaction").mockImplementation(async (fn) => {
      const sp = `sp_dir_${++spCounter}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const out = await fn(client);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        return out;
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw err;
      }
    });

    try {
      await client.query("BEGIN");

      const usersRes = await client.query<{
        user_id: number;
        username: string;
        full_name: string;
        role:
          | "PARTNER_ADMIN"
          | "PARTNER_MANAGER"
          | "EXTERNAL_SELLER"
          | "WAREHOUSE_DELIVERY";
        default_cash_account_id: number | null;
      }>(
        `SELECT user_id, username, full_name, role::text AS role, default_cash_account_id
         FROM erp.app_users WHERE user_id IN (1, 3, 4)`
      );
      const tokenFor = (uid: number) => {
        const u = usersRes.rows.find((r) => Number(r.user_id) === uid)!;
        return signTestSessionToken({
          userId: Number(u.user_id),
          username: String(u.username),
          fullName: String(u.full_name),
          role: u.role,
          defaultCashAccountId:
            u.default_cash_account_id !== null
              ? Number(u.default_cash_account_id)
              : null,
        });
      };
      const adminTok = tokenFor(1);
      const sellerTok = tokenFor(3);
      const whTok = tokenFor(4);

      // 1. Alias-only customer create by EXTERNAL_SELLER
      const aliasCreateRes = await customersRoute.POST(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tradeName: "Ferretería El Pato Test",
            cityZone: "laberinto",
          }),
        })
      );
      expect(aliasCreateRes.status).toBe(201);
      const aliasJson = await aliasCreateRes.json();
      expect(aliasJson.customer.trade_name).toBe("FERRETERÍA EL PATO TEST");
      expect(aliasJson.customer.legal_name).toBe("FERRETERÍA EL PATO TEST");
      expect(aliasJson.customer.city_zone).toBe("LABERINTO");

      // 2. Dual-name + normalized zone + GPS coordinates
      const dualCreateRes = await customersRoute.POST(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tradeName: "Ferretería Ruta Sur Test",
            legalName: "Inversiones Águila EIRL Test",
            docType: "RUC",
            docNumber: "20554433221",
            cityZone: "  km   110 ",
            phone: "982000999",
            geoLat: -12.7123456,
            geoLng: -69.5841234,
            geoAccuracyM: 12.4,
          }),
        })
      );
      expect(dualCreateRes.status).toBe(201);
      const dualJson = await dualCreateRes.json();
      const dualId = dualJson.customer.party_id;
      expect(dualJson.customer.city_zone).toBe("KM 110");
      expect(dualJson.customer.geo_lat).toBe(-12.712346);
      expect(dualJson.customer.geo_lng).toBe(-69.584123);
      expect(dualJson.customer.geo_accuracy_m).toBe(12);
      expect(dualJson.customer.geo_updated_at).toBeTruthy();

      // Warehouse cannot create customers or list directory
      const whCreateRes = await customersRoute.POST(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "POST",
          headers: {
            cookie: `bht_session=${whTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tradeName: "Bloqueado" }),
        })
      );
      expect(whCreateRes.status).toBe(403);

      const whListRes = await customersRoute.GET(
        new NextRequest("http://localhost:3000/api/customers", {
          headers: { cookie: `bht_session=${whTok}` },
        })
      );
      expect(whListRes.status).toBe(403);

      // 3. Accent-insensitive search across alias, legal_name, and zone
      const byLegal = await customersRoute.GET(
        new NextRequest("http://localhost:3000/api/customers?q=aguila", {
          headers: { cookie: `bht_session=${sellerTok}` },
        })
      );
      expect(byLegal.status).toBe(200);
      const byLegalJson = await byLegal.json();
      expect(
        byLegalJson.customers.some((c: { party_id: number }) => c.party_id === dualId)
      ).toBe(true);

      const byAliasAndZone = await customersRoute.GET(
        new NextRequest(
          "http://localhost:3000/api/customers?q=ruta%20sur&zone=KM%20110&hasGeo=WITH_GEO",
          { headers: { cookie: `bht_session=${sellerTok}` } }
        )
      );
      expect(byAliasAndZone.status).toBe(200);
      const byAliasJson = await byAliasAndZone.json();
      expect(
        byAliasJson.customers.some((c: { party_id: number }) => c.party_id === dualId)
      ).toBe(true);

      // 4. Attach a real sales_order to dualId and test RBAC PATCH rules
      await client.query(
        `INSERT INTO erp.sales_orders (
           order_code, order_date, warehouse_id, customer_party_id, customer_name_raw,
           operational_status, payment_mode, total_pen, paid_pen, source_origin
         ) VALUES (
           'SO-TEST-DIR-001', CURRENT_DATE,
           (SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1),
           $1, 'FERRETERIA RUTA SUR TEST',
           'REGISTERED', 'CASH', 100, 100, 'ERP_APP'
         )`,
        [dualId]
      );

      // Seller CAN update field contact/zone/alias/GPS
      const sellerPatchOk = await customersRoute.PATCH(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partyId: dualId,
            phone: "982111333",
            tradeName: "Ferretería Ruta Sur Renovada",
          }),
        })
      );
      expect(sellerPatchOk.status).toBe(200);
      const sellerPatchJson = await sellerPatchOk.json();
      expect(sellerPatchJson.customer.phone).toBe("982111333");
      expect(sellerPatchJson.customer.trade_name).toBe("FERRETERÍA RUTA SUR RENOVADA");

      // Seller CANNOT change isActive, legalName (with orders), or genuine RUC (with orders)
      const sellerForbiddenActive = await customersRoute.PATCH(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ partyId: dualId, isActive: false }),
        })
      );
      expect(sellerForbiddenActive.status).toBe(403);

      const sellerForbiddenLegal = await customersRoute.PATCH(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ partyId: dualId, legalName: "Otro Nombre SAC" }),
        })
      );
      expect(sellerForbiddenLegal.status).toBe(403);

      const sellerForbiddenDoc = await customersRoute.PATCH(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${sellerTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partyId: dualId,
            docType: "RUC",
            docNumber: "20999888777",
          }),
        })
      );
      expect(sellerForbiddenDoc.status).toBe(403);

      // Warehouse CAN update GPS/notes, CANNOT update phone/cityZone
      const whGeoOk = await customersRoute.PATCH(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${whTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partyId: dualId,
            geoLat: -12.6,
            geoLng: -69.2,
            geoAccuracyM: 8,
            notes: "Frente al grifo Primax",
          }),
        })
      );
      expect(whGeoOk.status).toBe(200);
      const whGeoJson = await whGeoOk.json();
      expect(whGeoJson.customer.geo_lat).toBe(-12.6);
      expect(whGeoJson.customer.notes).toBe("Frente al grifo Primax");

      const whForbiddenZone = await customersRoute.PATCH(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${whTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ partyId: dualId, cityZone: "OTRA" }),
        })
      );
      expect(whForbiddenZone.status).toBe(403);

      // Partner CAN deactivate and rename
      const partnerPatchOk = await customersRoute.PATCH(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partyId: dualId,
            legalName: "INVERSIONES AGUILA RENOVADA SAC",
            isActive: false,
          }),
        })
      );
      expect(partnerPatchOk.status).toBe(200);
      const partnerPatchJson = await partnerPatchOk.json();
      expect(partnerPatchJson.customer.is_active).toBe(false);
      expect(partnerPatchJson.customer.legal_name).toBe(
        "INVERSIONES AGUILA RENOVADA SAC"
      );

      // 5. Suppliers directory endpoints (/api/suppliers)
      const sellerSuppForbidden = await suppliersRoute.GET(
        new NextRequest("http://localhost:3000/api/suppliers", {
          headers: { cookie: `bht_session=${sellerTok}` },
        })
      );
      expect(sellerSuppForbidden.status).toBe(403);

      const suppCreate = await suppliersRoute.POST(
        new NextRequest("http://localhost:3000/api/suppliers", {
          method: "POST",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tradeName: "Proveedor Andino Test",
            legalName: "Distribuidora Andina SAC Test",
            docType: "RUC",
            docNumber: "20441122334",
            cityZone: "LIMA",
            phone: "014445555",
          }),
        })
      );
      expect(suppCreate.status).toBe(201);
      const suppCreateJson = await suppCreate.json();
      const suppId = suppCreateJson.supplier.party_id;

      const suppGet = await suppliersRoute.GET(
        new NextRequest("http://localhost:3000/api/suppliers?q=andino", {
          headers: { cookie: `bht_session=${adminTok}` },
        })
      );
      expect(suppGet.status).toBe(200);
      const suppGetJson = await suppGet.json();
      expect(
        suppGetJson.suppliers.some((s: { party_id: number }) => s.party_id === suppId)
      ).toBe(true);

      const suppPatch = await suppliersRoute.PATCH(
        new NextRequest("http://localhost:3000/api/suppliers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${adminTok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partyId: suppId,
            cityZone: "CUSCO",
            isActive: false,
          }),
        })
      );
      expect(suppPatch.status).toBe(200);
      const suppPatchJson = await suppPatch.json();
      expect(suppPatchJson.supplier.city_zone).toBe("CUSCO");
      expect(suppPatchJson.supplier.is_active).toBe(false);
    } finally {
      spyTx.mockRestore();
      spyClient.mockRestore();
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
