import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { inflateRawSync } from "node:zlib";
import { signTestSessionToken } from "../src/lib/auth/test-session";
import { getPool } from "../src/lib/db";
import {
  AuthorizationError,
  ValidationError,
  type SessionUser,
} from "../src/lib/types";
import {
  advanceWarehouseStatus,
  cancelOrder,
  createOrder,
} from "../src/lib/services/orders";
import {
  closeRouteTrip,
  convertQuoteToOrder,
  createQuote,
  createRouteTrip,
  updateAuditFlagStatus,
  updateQuoteStatus,
} from "../src/lib/services/operations-and-modules";
import { registerSupplierPurchase } from "../src/lib/services/purchases-and-suppliers";
import {
  buildRegularizationWorkbookBuffer,
  listUnpurchasedSalesRegularization,
} from "../src/lib/services/purchase-regularization";
import { executeUndoAction, listUndoableActions } from "../src/lib/services/undo";
import { GET as getRegularizationRoute } from "../src/app/api/purchases/regularization/route";
import { GET as getUndoRoute, POST as postUndoRoute } from "../src/app/api/undo/route";

beforeAll(() => {
  process.env.BHT_DB_BRANCH = "dev";
});

const partnerAdmin: SessionUser = {
  userId: 1,
  username: "socio_admin",
  fullName: "Socio Operativo y Admin",
  role: "PARTNER_ADMIN",
  defaultCashAccountId: 1,
};

const partnerManager: SessionUser = {
  userId: 2,
  username: "socio_gerente",
  fullName: "Socio Gerente",
  role: "PARTNER_MANAGER",
  defaultCashAccountId: 1,
};

const sellerActor: SessionUser = {
  userId: 3,
  username: "vendedor1",
  fullName: "Vendedor Externo Ruta",
  role: "EXTERNAL_SELLER",
  defaultCashAccountId: 1,
};

const warehouseActor: SessionUser = {
  userId: 4,
  username: "almacen1",
  fullName: "Encargado de Almacén",
  role: "WAREHOUSE_DELIVERY",
  defaultCashAccountId: null,
};

const adminToken = signTestSessionToken(partnerAdmin);
const managerToken = signTestSessionToken(partnerManager);
const sellerToken = signTestSessionToken(sellerActor);
const warehouseToken = signTestSessionToken(warehouseActor);

function unzipSheetXml(buffer: Buffer, sheetPath: string): string {
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  expect(eocdOffset).toBeGreaterThan(-1);
  const cdCount = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i += 1) {
    const method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    if (name === sheetPath) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buffer.subarray(dataStart, dataStart + compSize);
      return method === 8 ? inflateRawSync(raw).toString("utf8") : raw.toString("utf8");
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`ZIP entry not found: ${sheetPath}`);
}

describe("Catalog Consolidation, Flexible Stock Regularization & Excel Export (Neon dev)", () => {
  it("verifies consolidated calipers, removed side-specific brake pumps, and D562-SET opening stock", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      const obsolete = await client.query(
        `SELECT sku FROM erp.products
         WHERE sku IN ('47750-26120', '47750-20480', '31410-20150 LEFT-NEW', '31410-20150 RIGHT-NEW')`
      );
      expect(obsolete.rowCount).toBe(0);

      const canonical = await client.query<{ sku: string; name: string }>(
        `SELECT sku, name FROM erp.products
         WHERE sku IN ('47730-26120', '47730-20480', '31410-20150', 'D562-SET')
         ORDER BY sku`
      );
      const bySku = new Map(canonical.rows.map((r) => [r.sku, r.name]));
      expect(bySku.get("47730-26120")).toBe("CALIPER PARA TOYOTA BUFALO");
      expect(bySku.get("47730-20480")).toBe("CALIPER PARA TOYOTA 57-25");
      expect(bySku.has("31410-20150")).toBe(true);
      expect(bySku.has("D562-SET")).toBe(true);

      const opening = await client.query<{ sku: string; qty: string }>(
        `SELECT p.sku, COALESCE(SUM(im.quantity_delta), 0)::text AS qty
         FROM erp.inventory_movements im
         JOIN erp.products p ON p.product_id = im.product_id
         WHERE p.sku IN ('D562-SET', '47730-20480') AND im.movement_type = 'OPENING'
         GROUP BY p.sku`
      );
      const openingBySku = new Map(opening.rows.map((r) => [r.sku, Number(r.qty)]));
      expect(openingBySku.get("D562-SET")).toBe(4210);
      expect(openingBySku.get("47730-20480")).toBe(4);

      const mainStock = await client.query<{ stock_on_hand: string }>(
        `SELECT vcs.stock_on_hand::text
         FROM erp.v_current_stock vcs
         JOIN erp.products p ON p.product_id = vcs.product_id
         JOIN erp.warehouses w ON w.warehouse_id = vcs.warehouse_id AND w.code = 'MAIN'
         WHERE p.sku = '47730-20480'`
      );
      expect(Number(mainStock.rows[0]?.stock_on_hand ?? -1)).toBe(0);
    } finally {
      client.release();
    }
  });

  it("allows selling STOCKED items past formal invoices, tracks exact excess in regularization view, and clears deficit once formal purchase is registered", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const prodRes = await client.query<{ product_id: number }>(
        `INSERT INTO erp.products
           (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('00099887766', 'TEST SKU CON CEROS', 'UND', 'STOCKED', 100, 90, 50)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      const supRes = await client.query<{ party_id: number }>(
        `SELECT party_id FROM erp.parties WHERE party_type IN ('SUPPLIER', 'BOTH') AND is_active = TRUE LIMIT 1`
      );
      const supplierPartyId = Number(supRes.rows[0].party_id);

      // Step 1: Register formal invoice for 5 units first (invoice-backed stock priority)
      await registerSupplierPurchase(client, partnerAdmin, {
        supplierPartyId,
        docType: "FACTURA",
        docSeries: "FT01",
        docNumber: "900001",
        paymentCondition: "CREDIT",
        items: [{ productId, quantity: 5, unitCostPen: 50 }],
      });

      // Step 2: Sell 8 units (exceeds formal invoice by 3 units — must NOT block!)
      const order = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE REGULARIZACION TEST",
        paymentMode: "CREDIT",
        lines: [{ productId, quantity: 8, unitDiscountPen: 0 }],
      });
      expect(order.orderId).toBeGreaterThan(0);

      // Verify UNPURCHASED_STOCK_DEFICIT warning flag was logged
      const flagRes = await client.query<{ status: string; severity: string }>(
        `SELECT status, severity
         FROM erp.audit_flags
         WHERE flag_code = 'UNPURCHASED_STOCK_DEFICIT'
           AND entity_table = 'erp.products'
           AND entity_id LIKE ($1 || '@%')`,
        [String(productId)]
      );
      expect(flagRes.rowCount).toBe(1);
      expect(flagRes.rows[0].status).toBe("OPEN");
      expect(flagRes.rows[0].severity).toBe("WARNING");

      // Verify regularization view shows ONLY excess over formal invoices (8 - 5 = 3)
      const reg = await listUnpurchasedSalesRegularization(client, partnerAdmin, {
        mode: "sold",
        search: "00099887766",
      });
      expect(reg.items).toHaveLength(1);
      expect(reg.items[0].sku).toBe("00099887766");
      expect(reg.items[0].purchased_qty).toBe(5);
      expect(reg.items[0].sold_qty).toBe(8);
      expect(reg.items[0].qty_to_regularize).toBe(3);
      expect(reg.items[0].estimated_purchase_pen).toBe(150);

      // Verify Excel buffer preserves leading zeros for this SKU
      const xlsxBuf = buildRegularizationWorkbookBuffer(reg, {
        generatedDateLima: "2026-11-19",
      });
      const sheet1 = unzipSheetXml(xlsxBuf, "xl/worksheets/sheet1.xml");
      expect(sheet1).toContain('<t xml:space="preserve">00099887766</t>');

      // Step 3: Register formal supplier purchase covering the remaining 3 units
      await registerSupplierPurchase(client, partnerAdmin, {
        supplierPartyId,
        docType: "FACTURA",
        docSeries: "FT01",
        docNumber: "900002",
        paymentCondition: "CREDIT",
        items: [{ productId, quantity: 3, unitCostPen: 50 }],
      });

      // Regularization deficit drops to 0 and audit flag auto-resolves!
      const regAfter = await listUnpurchasedSalesRegularization(client, partnerAdmin, {
        mode: "sold",
        search: "00099887766",
      });
      expect(regAfter.items).toHaveLength(0);

      const flagAfter = await client.query<{ status: string }>(
        `SELECT status
         FROM erp.audit_flags
         WHERE flag_code = 'UNPURCHASED_STOCK_DEFICIT'
           AND entity_table = 'erp.products'
           AND entity_id LIKE ($1 || '@%')`,
        [String(productId)]
      );
      expect(flagAfter.rows[0]?.status).toBe("RESOLVED");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("converts an existing OPEN quote containing a zero/negative-stock STOCKED product without blocking", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const openQuoteRes = await client.query<{ quote_id: number }>(
        `SELECT q.quote_id
         FROM erp.quotes q
         JOIN erp.quote_lines ql ON ql.quote_id = q.quote_id
         JOIN erp.products p ON p.product_id = ql.product_id
         LEFT JOIN (
           SELECT product_id, COALESCE(SUM(quantity_delta), 0) AS qty
           FROM erp.inventory_movements
           GROUP BY product_id
         ) s ON s.product_id = p.product_id
         WHERE q.status = 'OPEN'
           AND p.fulfillment_mode = 'STOCKED'
           AND COALESCE(s.qty, 0) <= 0
         ORDER BY q.quote_id DESC
         LIMIT 1`
      );
      expect(openQuoteRes.rowCount).toBe(1);
      const quoteId = Number(openQuoteRes.rows[0].quote_id);

      const converted = await convertQuoteToOrder(client, partnerAdmin, {
        quoteId,
        paymentMode: "CREDIT",
        creditDays: 7,
      });
      expect(converted.quoteId).toBe(quoteId);
      expect(converted.order.orderId).toBeGreaterThan(0);
      expect(converted.undoAction?.actionType).toBe("QUOTE_CONVERT_TO_ORDER");

      const qCheck = await client.query<{ status: string; related_cpe: string | null }>(
        `SELECT status::text AS status, related_cpe FROM erp.quotes WHERE quote_id = $1`,
        [quoteId]
      );
      expect(qCheck.rows[0].status).toBe("CONVERTED");
      expect(qCheck.rows[0].related_cpe).toBe(converted.order.orderCode);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("enforces RBAC on /api/purchases/regularization and streams valid .xlsx with leading-zero SKUs", async () => {
    const sellerReq = new NextRequest(
      "http://localhost:3000/api/purchases/regularization",
      {
        headers: { cookie: `bht_session=${sellerToken}` },
      }
    );
    expect((await getRegularizationRoute(sellerReq)).status).toBe(403);

    const whReq = new NextRequest(
      "http://localhost:3000/api/purchases/regularization",
      {
        headers: { cookie: `bht_session=${warehouseToken}` },
      }
    );
    expect((await getRegularizationRoute(whReq)).status).toBe(403);

    const jsonReq = new NextRequest(
      "http://localhost:3000/api/purchases/regularization?mode=sold",
      { headers: { cookie: `bht_session=${managerToken}` } }
    );
    const jsonRes = await getRegularizationRoute(jsonReq);
    expect(jsonRes.status).toBe(200);
    const jsonBody = await jsonRes.json();
    expect(jsonBody.summary.soldDeficitSkus).toBe(91);
    expect(Array.isArray(jsonBody.items)).toBe(true);

    const xlsxReq = new NextRequest(
      "http://localhost:3000/api/purchases/regularization?mode=sold&format=xlsx",
      { headers: { cookie: `bht_session=${adminToken}` } }
    );
    const xlsxRes = await getRegularizationRoute(xlsxReq);
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const arrayBuf = await xlsxRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    expect(buf.subarray(0, 4).toString("binary")).toBe("PK\x03\x04");

    const sheet1Xml = unzipSheetXml(buf, "xl/worksheets/sheet1.xml");
    // Leading-zero SKU from real dev data is preserved verbatim as text; 47730-20480 is cleared by 024
    expect(sheet1Xml).toContain('<t xml:space="preserve">000100340200</t>');
    expect(sheet1Xml).not.toContain('<t xml:space="preserve">47730-20480</t>');
    const sheet2Xml = unzipSheetXml(buf, "xl/worksheets/sheet2.xml");
    expect(sheet2Xml).toContain("Fecha de generación (Lima)");
    expect(sheet2Xml).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("Operational Undo System — All Action Types, Safety Guards & Timed RBAC Window (Neon dev)", () => {
  it("undoes quote cancellation and rejects double-undo or stale state", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const prodRes = await client.query<{ product_id: number }>(
        `SELECT product_id FROM erp.products WHERE is_active = TRUE LIMIT 1`
      );
      const productId = Number(prodRes.rows[0].product_id);

      const created = await createQuote(client, sellerActor, {
        customerNameRaw: "CLIENTE COTIZACION UNDO",
        lines: [
          {
            productId,
            rawDescription: "REPUESTO UNDO",
            quantity: 2,
            unitPricePen: 45,
          },
        ],
      });

      // Seller cancels quote by mistake
      const cancelled = await updateQuoteStatus(client, sellerActor, {
        quoteId: created.quoteId,
        nextStatus: "CANCELLED",
      });
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.undoAction).toBeDefined();
      expect(cancelled.undoAction?.actionType).toBe("QUOTE_STATUS_CHANGE");

      // Seller undoes within 15-minute window
      const undone = await executeUndoAction(client, sellerActor, {
        undoId: cancelled.undoAction!.undoId,
      });
      expect(undone.ok).toBe(true);

      const qAfter = await client.query<{ status: string }>(
        `SELECT status FROM erp.quotes WHERE quote_id = $1`,
        [created.quoteId]
      );
      expect(qAfter.rows[0].status).toBe("OPEN");

      // Double undo must be rejected
      await expect(
        executeUndoAction(client, sellerActor, {
          undoId: cancelled.undoAction!.undoId,
        })
      ).rejects.toThrow(ValidationError);

      // Re-cancel then externally mutate state -> undo must be rejected
      const cancelled2 = await updateQuoteStatus(client, sellerActor, {
        quoteId: created.quoteId,
        nextStatus: "CANCELLED",
      });
      expect(cancelled2.undoAction).toBeDefined();
      await client.query(
        `UPDATE erp.quotes SET status = 'EXPIRED' WHERE quote_id = $1`,
        [created.quoteId]
      );
      await expect(
        executeUndoAction(client, sellerActor, {
          undoId: cancelled2.undoAction!.undoId,
        })
      ).rejects.toThrow(ValidationError);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("undoes quote conversion, order cancellation (with stock & cash restoration), warehouse advance, order create, trip close & audit flag status", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const prodRes = await client.query<{ product_id: number }>(
        `INSERT INTO erp.products
           (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-UNDO-SKU', 'PRODUCTO TEST UNDO', 'UND', 'STOCKED', 100, 90, 50)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      const whRes = await client.query<{ warehouse_id: number }>(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);
      await client.query(
        `INSERT INTO erp.inventory_movements
           (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 20, 50, 'TEST_UNDO_SEED')`,
        [warehouseId, productId]
      );

      // 1) Quote convert -> undo reopens quote & cancels generated order & restores stock
      const quote = await createQuote(client, sellerActor, {
        customerNameRaw: "CLIENTE UNDO CONVERT",
        lines: [
          {
            productId,
            rawDescription: "PRODUCTO TEST UNDO",
            quantity: 3,
            unitPricePen: 100,
          },
        ],
      });
      const conv = await convertQuoteToOrder(client, sellerActor, {
        quoteId: quote.quoteId,
        paymentMode: "CREDIT",
        creditDays: 7,
      });
      await executeUndoAction(client, sellerActor, {
        undoId: conv.undoAction!.undoId,
      });

      const qState = await client.query<{ status: string; related_cpe: string | null }>(
        `SELECT status::text AS status, related_cpe FROM erp.quotes WHERE quote_id = $1`,
        [quote.quoteId]
      );
      expect(qState.rows[0].status).toBe("OPEN");
      expect(qState.rows[0].related_cpe).toBeNull();

      const oState = await client.query<{ operational_status: string }>(
        `SELECT operational_status FROM erp.sales_orders WHERE order_id = $1`,
        [conv.order.orderId]
      );
      expect(oState.rows[0].operational_status).toBe("CANCELLED");

      // Stock must be back to 20
      const stockAfterConvUndo = await client.query<{ qty: string }>(
        `SELECT COALESCE(SUM(quantity_delta), 0)::text AS qty
         FROM erp.inventory_movements WHERE product_id = $1`,
        [productId]
      );
      expect(Number(stockAfterConvUndo.rows[0].qty)).toBe(20);

      // 2) Order create -> undo cancels new order
      const createdOrder = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE UNDO CREATE",
        paymentMode: "CASH",
        collectOnDelivery: false,
        lines: [{ productId, quantity: 2, unitDiscountPen: 0 }],
      });
      expect(createdOrder.undoAction?.actionType).toBe("ORDER_CREATE");
      await executeUndoAction(client, sellerActor, {
        undoId: createdOrder.undoAction!.undoId,
      });

      const afterCreateUndo = await client.query<{ operational_status: string }>(
        `SELECT operational_status FROM erp.sales_orders WHERE order_id = $1`,
        [createdOrder.orderId]
      );
      expect(afterCreateUndo.rows[0].operational_status).toBe("CANCELLED");

      // 3) Order cancel (with upfront cash payment) -> undo restores order, stock deduction & cash payment
      const cashOrder = await createOrder(client, partnerAdmin, {
        customerNameRaw: "CLIENTE UNDO CANCEL",
        paymentMode: "CASH",
        collectOnDelivery: false,
        lines: [{ productId, quantity: 4, unitDiscountPen: 0 }],
      });
      const cancelledOrder = await cancelOrder(
        client,
        partnerAdmin,
        cashOrder.orderId,
        "Anulación accidental"
      );
      expect(cancelledOrder.undoAction).toBeDefined();
      expect(cancelledOrder.undoAction?.actionType).toBe("ORDER_CANCEL");
      await executeUndoAction(client, partnerAdmin, {
        undoId: cancelledOrder.undoAction!.undoId,
      });

      const restoredOrder = await client.query<{
        operational_status: string;
        paid_pen: string;
        balance_due_pen: string;
      }>(
        `SELECT operational_status, paid_pen::text, balance_due_pen::text
         FROM erp.sales_orders WHERE order_id = $1`,
        [cashOrder.orderId]
      );
      expect(restoredOrder.rows[0].operational_status).toBe("REGISTERED");
      expect(Number(restoredOrder.rows[0].paid_pen)).toBe(400);
      expect(Number(restoredOrder.rows[0].balance_due_pen)).toBe(0);

      // Stock reflects the restored 4-unit sale (20 - 4 = 16)
      const stockAfterCancelUndo = await client.query<{ qty: string }>(
        `SELECT COALESCE(SUM(quantity_delta), 0)::text AS qty
         FROM erp.inventory_movements WHERE product_id = $1`,
        [productId]
      );
      expect(Number(stockAfterCancelUndo.rows[0].qty)).toBe(16);

      // Audit log recorded UNDO_CANCEL
      const auditActions = await client.query<{ action: string }>(
        `SELECT action FROM erp.sales_order_audit_log WHERE order_id = $1 ORDER BY audit_id`,
        [cashOrder.orderId]
      );
      expect(auditActions.rows.map((r) => r.action)).toEqual(["CANCEL", "UNDO_CANCEL"]);

      // 4) Warehouse advance REGISTERED -> PICKING -> undo restores REGISTERED
      const adv = await advanceWarehouseStatus(
        client,
        warehouseActor,
        cashOrder.orderId,
        "PICKING"
      );
      expect(adv.undoAction).toBeDefined();
      expect(adv.undoAction?.actionType).toBe("ORDER_STATUS_ADVANCE");
      await executeUndoAction(client, warehouseActor, {
        undoId: adv.undoAction!.undoId,
      });

      const afterAdvUndo = await client.query<{ operational_status: string }>(
        `SELECT operational_status FROM erp.sales_orders WHERE order_id = $1`,
        [cashOrder.orderId]
      );
      expect(afterAdvUndo.rows[0].operational_status).toBe("REGISTERED");

      // 5) Trip close -> undo reopens OPEN
      const trip = await createRouteTrip(client, warehouseActor, {
        zoneName: "RUTA UNDO TEST",
      });
      const closedTrip = await closeRouteTrip(client, warehouseActor, {
        tripId: trip.tripId,
        nextStatus: "CLOSED",
      });
      expect(closedTrip.undoAction).toBeDefined();
      await executeUndoAction(client, warehouseActor, {
        undoId: closedTrip.undoAction!.undoId,
      });
      const tripState = await client.query<{ status: string }>(
        `SELECT status FROM erp.route_trips WHERE trip_id = $1`,
        [trip.tripId]
      );
      expect(tripState.rows[0].status).toBe("OPEN");

      // 6) Audit flag status change -> undo restores OPEN
      const insertedFlag = await client.query<{ flag_id: number }>(
        `INSERT INTO erp.audit_flags
           (flag_code, severity, entity_table, entity_id, message, status, source_origin)
         VALUES ('TEST_UNDO_FLAG', 'WARNING', 'products', $1, 'Alerta prueba undo', 'OPEN', 'ERP_APP')
         RETURNING flag_id`,
        [String(productId)]
      );
      const flagId = Number(insertedFlag.rows[0].flag_id);
      const resolvedFlag = await updateAuditFlagStatus(client, partnerManager, {
        flagId,
        nextStatus: "RESOLVED",
        resolutionNote: "Prueba",
      });
      expect(resolvedFlag.undoAction).toBeDefined();
      await executeUndoAction(client, partnerManager, {
        undoId: resolvedFlag.undoAction!.undoId,
      });
      const flagState = await client.query<{ status: string }>(
        `SELECT status FROM erp.audit_flags WHERE flag_id = $1`,
        [flagId]
      );
      expect(flagState.rows[0].status).toBe("OPEN");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("enforces strict 15-minute window and ownership for non-admins while allowing PARTNER_ADMIN unrestricted team undo", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const prodRes = await client.query<{ product_id: number }>(
        `SELECT product_id FROM erp.products WHERE is_active = TRUE LIMIT 1`
      );
      const productId = Number(prodRes.rows[0].product_id);

      const quote = await createQuote(client, sellerActor, {
        customerNameRaw: "CLIENTE VENTANA TIEMPO",
        lines: [
          { productId, rawDescription: "ITEM TIEMPO", quantity: 1, unitPricePen: 50 },
        ],
      });
      const cancelled = await updateQuoteStatus(client, sellerActor, {
        quoteId: quote.quoteId,
        nextStatus: "CANCELLED",
      });
      expect(cancelled.undoAction).toBeDefined();
      const undoId = cancelled.undoAction!.undoId;

      // Non-admin cannot list scope=all
      await expect(
        listUndoableActions(client, sellerActor, { scope: "all" })
      ).rejects.toThrow(AuthorizationError);
      await expect(
        listUndoableActions(client, partnerManager, { scope: "all" })
      ).rejects.toThrow(AuthorizationError);

      // Partner Manager cannot undo Seller's action (not owner, not admin)
      await expect(
        executeUndoAction(client, partnerManager, { undoId })
      ).rejects.toThrow(AuthorizationError);

      // Insert an already-expired action by Seller (created 35m ago, expired 20m ago)
      const quote2 = await createQuote(client, sellerActor, {
        customerNameRaw: "CLIENTE EXPIRADO",
        lines: [
          { productId, rawDescription: "ITEM EXP", quantity: 1, unitPricePen: 50 },
        ],
      });
      await client.query(
        `UPDATE erp.quotes SET status = 'CANCELLED' WHERE quote_id = $1`,
        [quote2.quoteId]
      );
      const expiredIns = await client.query<{ undo_id: number }>(
        `INSERT INTO erp.undoable_actions
           (action_type, entity_table, entity_id, entity_code, summary,
            actor_user_id, actor_role, undo_payload, created_at, expires_at)
         VALUES
           ('QUOTE_STATUS_CHANGE', 'erp.quotes', $1, $2, 'Anulación expirada',
            $3, $4, $5::jsonb,
            NOW() - INTERVAL '35 minutes', NOW() - INTERVAL '20 minutes')
         RETURNING undo_id`,
        [
          String(quote2.quoteId),
          quote2.quoteCode,
          sellerActor.userId,
          sellerActor.role,
          JSON.stringify({
            quoteId: quote2.quoteId,
            quoteCode: quote2.quoteCode,
            previousStatus: "OPEN",
            nextStatus: "CANCELLED",
          }),
        ]
      );
      const expiredUndoId = Number(expiredIns.rows[0].undo_id);

      // Seller CANNOT undo own expired action
      await expect(
        executeUndoAction(client, sellerActor, { undoId: expiredUndoId })
      ).rejects.toThrow(ValidationError);

      // PARTNER_ADMIN sees it in scope='all' with can_undo=true and CAN undo it!
      const adminList = await listUndoableActions(client, partnerAdmin, {
        scope: "all",
        status: "PENDING",
      });
      const foundExpired = adminList.actions.find((a) => a.undo_id === expiredUndoId);
      expect(foundExpired).toBeDefined();
      expect(foundExpired?.is_expired).toBe(true);
      expect(foundExpired?.can_undo).toBe(true);

      const adminUndone = await executeUndoAction(client, partnerAdmin, {
        undoId: expiredUndoId,
        reason: "Reversión fuera de ventana autorizada por Admin",
      });
      expect(adminUndone.ok).toBe(true);

      const q2After = await client.query<{ status: string }>(
        `SELECT status FROM erp.quotes WHERE quote_id = $1`,
        [quote2.quoteId]
      );
      expect(q2After.rows[0].status).toBe("OPEN");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("enforces RBAC on GET /api/undo?scope=all (403 for non-admin, 200 for PARTNER_ADMIN)", async () => {
    const sellerAllReq = new NextRequest("http://localhost:3000/api/undo?scope=all", {
      headers: { cookie: `bht_session=${sellerToken}` },
    });
    expect((await getUndoRoute(sellerAllReq)).status).toBe(403);

    const managerAllReq = new NextRequest("http://localhost:3000/api/undo?scope=all", {
      headers: { cookie: `bht_session=${managerToken}` },
    });
    expect((await getUndoRoute(managerAllReq)).status).toBe(403);

    const sellerMineReq = new NextRequest("http://localhost:3000/api/undo?scope=mine", {
      headers: { cookie: `bht_session=${sellerToken}` },
    });
    expect((await getUndoRoute(sellerMineReq)).status).toBe(200);

    const adminAllReq = new NextRequest("http://localhost:3000/api/undo?scope=all", {
      headers: { cookie: `bht_session=${adminToken}` },
    });
    const adminRes = await getUndoRoute(adminAllReq);
    expect(adminRes.status).toBe(200);
    const body = await adminRes.json();
    expect(body.isAdmin).toBe(true);
    expect(body.windowSeconds).toBe(900);
  });

  it("computes accurate projectedDeficitSkus in sold mode, emits UTC ISO timestamps, localizes undo messages in Spanish, and resolves legacy supplier aliases on purchase registration", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) Projected deficit summary in mode=sold matches mode=projected
      const regSold = await listUnpurchasedSalesRegularization(client, partnerAdmin, {
        mode: "sold",
      });
      const regProjected = await listUnpurchasedSalesRegularization(
        client,
        partnerAdmin,
        { mode: "projected" }
      );
      expect(regSold.summary.projectedDeficitSkus).toBeGreaterThanOrEqual(
        regSold.summary.soldDeficitSkus
      );
      expect(regSold.summary.projectedDeficitSkus).toBe(
        regProjected.summary.projectedDeficitSkus
      );

      // 2) Supplier purchase using legacy/side-specific SKU & description without productId
      const supRes = await client.query<{ party_id: number }>(
        `SELECT party_id FROM erp.parties WHERE party_type IN ('SUPPLIER', 'BOTH') AND is_active = TRUE LIMIT 1`
      );
      const supplierPartyId = Number(supRes.rows[0].party_id);

      const baseline5725 = await listUnpurchasedSalesRegularization(
        client,
        partnerAdmin,
        { mode: "sold", search: "47730-20480" }
      );
      expect(
        baseline5725.items.find((item) => item.sku === "47730-20480")
          ?.qty_to_regularize ?? 0
      ).toBe(0);

      const canonicalIds = await client.query<{ sku: string; product_id: number }>(
        `SELECT sku, product_id FROM erp.products WHERE sku IN ('47730-26120', '47730-20480')`
      );
      const idBySku = new Map(canonicalIds.rows.map((r) => [r.sku, Number(r.product_id)]));

      await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE TEST REGULARIZACION ALIAS",
        paymentMode: "CREDIT",
        lines: [{ productId: idBySku.get("47730-20480")!, quantity: 5, unitDiscountPen: 0 }],
      });

      const before5725 = await listUnpurchasedSalesRegularization(
        client,
        partnerAdmin,
        { mode: "sold", search: "47730-20480" }
      );
      const qtyBefore5725 =
        before5725.items.find((item) => item.sku === "47730-20480")
          ?.qty_to_regularize ?? 0;
      expect(qtyBefore5725).toBe(5);

      const aliasPurchase = await registerSupplierPurchase(client, partnerAdmin, {
        supplierPartyId,
        docType: "FACTURA",
        docSeries: "FT99",
        docNumber: "900888",
        paymentCondition: "CREDIT",
        items: [
          {
            rawDescription: "CALIPER PARA TOYOTA BUFALO LADO DERECHO",
            quantity: 2,
            unitCostPen: 95,
          },
          {
            sku: "47750-20480",
            rawDescription: 'CALIPER PARA TOYOTA LASER 57-25 LADO IZQUIERDO "NUEVO"',
            quantity: 2,
            unitCostPen: 80,
          },
        ],
      });

      expect(aliasPurchase.lines[0].productId).toBe(idBySku.get("47730-26120"));
      expect(aliasPurchase.lines[1].productId).toBe(idBySku.get("47730-20480"));

      const after5725 = await listUnpurchasedSalesRegularization(
        client,
        partnerAdmin,
        { mode: "sold", search: "47730-20480" }
      );
      expect(
        after5725.items.find((item) => item.sku === "47730-20480")
          ?.qty_to_regularize ?? 0
      ).toBe(3);

      // 3) Strict UTC ISO-8601 timestamps & Spanish localization without raw DB enums
      const prodRes = await client.query<{ product_id: number }>(
        `SELECT product_id
         FROM erp.products
         WHERE is_active = TRUE AND COALESCE(list_sale_price_pen, 0) > 0
         ORDER BY product_id ASC
         LIMIT 1`
      );
      const prodId = Number(prodRes.rows[0].product_id);
      const order = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE ESPAÑOL ISO",
        paymentMode: "CREDIT",
        lines: [{ productId: prodId, quantity: 1, unitDiscountPen: 0 }],
      });
      const isoUtcRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(order.undoAction?.createdAt).toMatch(isoUtcRe);
      expect(order.undoAction?.expiresAt).toMatch(isoUtcRe);

      const adv = await advanceWarehouseStatus(
        client,
        warehouseActor,
        order.orderId,
        "PICKING"
      );
      expect(adv.undoAction?.summary).not.toMatch(/\b(REGISTERED|PICKING|CANCELLED|OPEN)\b/);

      const advUndo = await executeUndoAction(client, partnerAdmin, {
        undoId: adv.undoAction!.undoId,
      });
      expect(advUndo.restoredMessage).toContain("Alistando");
      expect(advUndo.restoredMessage).not.toMatch(/\bREGISTERED\b/);

      const listed = await listUndoableActions(client, partnerAdmin, {
        scope: "all",
        status: "ALL",
        limit: 10,
      });
      const listedAdv = listed.actions.find((a) => a.undo_id === adv.undoAction!.undoId);
      expect(listedAdv?.created_at).toMatch(isoUtcRe);
      expect(listedAdv?.expires_at).toMatch(isoUtcRe);
      expect(listedAdv?.undone_at).toMatch(isoUtcRe);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("serializes concurrent POST /api/undo requests cleanly (only one succeeds, zero residue)", async () => {
    const pool = getPool("dev");
    const setupClient = await pool.connect();
    let createdQuoteId: number | null = null;
    let createdUndoId: number | null = null;

    try {
      await setupClient.query("BEGIN");
      const prodRes = await setupClient.query<{ product_id: number }>(
        `SELECT product_id FROM erp.products WHERE is_active = TRUE LIMIT 1`
      );
      const prodId = Number(prodRes.rows[0].product_id);
      const quote = await createQuote(setupClient, sellerActor, {
        customerNameRaw: "CLIENTE CONCURRENCIA UNDO",
        lines: [
          {
            productId: prodId,
            rawDescription: "ITEM CONCURRENCIA",
            quantity: 1,
            unitPricePen: 50,
          },
        ],
      });
      createdQuoteId = quote.quoteId;
      const cancelled = await updateQuoteStatus(setupClient, sellerActor, {
        quoteId: quote.quoteId,
        nextStatus: "CANCELLED",
      });
      createdUndoId = cancelled.undoAction!.undoId;
      await setupClient.query("COMMIT");

      const makeReq = () =>
        new NextRequest("http://localhost:3000/api/undo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `bht_session=${adminToken}`,
          },
          body: JSON.stringify({
            undoId: createdUndoId,
            reason: "Prueba de concurrencia",
          }),
        });

      const [resA, resB] = await Promise.all([
        postUndoRoute(makeReq()),
        postUndoRoute(makeReq()),
      ]);
      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 400]);

      const errRes = resA.status === 400 ? resA : resB;
      const errBody = await errRes.json();
      expect(String(errBody.error)).toContain("ya fue deshecha");
    } finally {
      try {
        await setupClient.query("BEGIN");
        await setupClient.query("SET LOCAL bht.allow_hard_delete = 'on'");
        if (createdUndoId !== null) {
          await setupClient.query(`DELETE FROM erp.undoable_actions WHERE undo_id = $1`, [
            createdUndoId,
          ]);
        }
        if (createdQuoteId !== null) {
          await setupClient.query(`DELETE FROM erp.quotes WHERE quote_id = $1`, [
            createdQuoteId,
          ]);
        }
        await setupClient.query("COMMIT");
      } catch {
        await setupClient.query("ROLLBACK").catch(() => undefined);
      } finally {
        setupClient.release();
      }
    }
  });
});
