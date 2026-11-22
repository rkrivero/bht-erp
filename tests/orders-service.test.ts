import { describe, expect, it } from "vitest";
import { getPool } from "../src/lib/db";
import { ValidationError, type SessionUser } from "../src/lib/types";
import {
  advanceWarehouseStatus,
  approveDiscountedOrder,
  cancelOrder,
  createOrder,
  listOrdersForRole,
  updateOrder,
} from "../src/lib/services/orders";

const sellerActor: SessionUser = {
  userId: 3,
  username: "vendedor1",
  fullName: "Vendedor Externo Ruta",
  role: "EXTERNAL_SELLER",
  defaultCashAccountId: 1,
};

const partnerActor: SessionUser = {
  userId: 1,
  username: "socio_admin",
  fullName: "Socio Operativo y Admin",
  role: "PARTNER_ADMIN",
  defaultCashAccountId: 1,
};

const warehouseActor: SessionUser = {
  userId: 4,
  username: "almacen1",
  fullName: "Encargado de Almacén",
  role: "WAREHOUSE_DELIVERY",
  defaultCashAccountId: null,
};

describe("Order Lifecycle Service (Soles Discount Floor, Approval, Stock & 4-Responsible)", () => {
  it("rejects discount >= base_unit_price_pen with ValidationError", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const prodRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-DISC-ZERO', 'PRODUCTO TEST DESCUENTO', 'UND', 'STOCKED', 50, 48, 40)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      await expect(
        createOrder(client, sellerActor, {
          customerNameRaw: "CLIENTE PRUEBA",
          paymentMode: "CASH",
          lines: [{ productId, quantity: 2, unitDiscountPen: 50 }],
        })
      ).rejects.toThrow(ValidationError);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("lets the seller edit an undelivered order without approval above cost and keeps immutable before/after history", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const warehouse = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(warehouse.rows[0].warehouse_id);
      const product = await client.query(
        `INSERT INTO erp.products
           (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen,
            min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-EDIT-AUDIT', 'PRODUCTO EDITABLE', 'UND', 'STOCKED', 100, 95, 70)
         RETURNING product_id`
      );
      const productId = Number(product.rows[0].product_id);
      await client.query(
        `INSERT INTO erp.inventory_movements
           (warehouse_id, product_id, movement_date, movement_type,
            quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 20, 70, 'TEST_EDIT_STOCK')`,
        [warehouseId, productId]
      );

      const created = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE EDITABLE",
        paymentMode: "CREDIT",
        lines: [{ productId, quantity: 2, unitDiscountPen: 10 }],
      });
      expect(created.requiresApproval).toBe(false); // S/ 90 is below minimum, but above cost.

      const updated = await updateOrder(client, sellerActor, created.orderId, {
        reason: "Calidad del producto",
        lines: [{ productId, quantity: 3, unitDiscountPen: 10 }],
      });
      expect(updated.requiresApproval).toBe(false);
      expect(updated.operationalStatus).toBe("REGISTERED");

      const audit = await client.query(
        `SELECT action, actor_user_id, reason, before_data, after_data
         FROM erp.sales_order_audit_log WHERE order_id = $1`,
        [created.orderId]
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].action).toBe("EDIT");
      expect(Number(audit.rows[0].actor_user_id)).toBe(sellerActor.userId);
      expect(audit.rows[0].reason).toBe("Calidad del producto");
      expect(Number(audit.rows[0].before_data.lines[0].quantity)).toBe(2);
      expect(Number(audit.rows[0].after_data.lines[0].quantity)).toBe(3);

      const stock = await client.query(
        `SELECT stock_on_hand FROM erp.v_current_stock
         WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId]
      );
      expect(Number(stock.rows[0].stock_on_hand)).toBe(17);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("voids collections with a compensating cash entry instead of deleting history", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const product = await client.query(
        `INSERT INTO erp.products
           (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen,
            min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-CANCEL-TRACE', 'PRODUCTO CANCELABLE', 'UND', 'ON_DEMAND', 100, 90, 60)
         RETURNING product_id`
      );
      const created = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE REVERSA",
        paymentMode: "CASH",
        collectOnDelivery: false,
        lines: [{ productId: Number(product.rows[0].product_id), quantity: 1 }],
      });

      await cancelOrder(client, partnerActor, created.orderId, "Cambio de opinión");

      const payment = await client.query(
        `SELECT voided_at, voided_by_user_id, void_reason, reversal_ledger_id
         FROM erp.ar_payments WHERE order_id = $1`,
        [created.orderId]
      );
      expect(payment.rowCount).toBe(1);
      expect(payment.rows[0].voided_at).not.toBeNull();
      expect(Number(payment.rows[0].voided_by_user_id)).toBe(partnerActor.userId);
      expect(payment.rows[0].void_reason).toBe("Cambio de opinión");

      const reversal = await client.query(
        `SELECT direction::text, amount_pen, is_reversal, created_by_user_id
         FROM erp.cash_ledger WHERE ledger_id = $1`,
        [payment.rows[0].reversal_ledger_id]
      );
      expect(reversal.rows[0].direction).toBe("OUT");
      expect(Number(reversal.rows[0].amount_pen)).toBe(100);
      expect(reversal.rows[0].is_reversal).toBe(true);
      expect(Number(reversal.rows[0].created_by_user_id)).toBe(partnerActor.userId);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("holds an EXTERNAL_SELLER order below cost for approval without deducting stock, and handles cancellation safely", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const whRes = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);

      const prodRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-FLOOR-SKU', 'ALFOMBRA TEST PISO', 'UND', 'STOCKED', 80, 78, 60)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      // Seed 20 units in MAIN warehouse
      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 20, 60, 'TEST_INITIAL_STOCK')`,
        [warehouseId, productId]
      );

      // 1. Seller requests S/ 25 discount (80 - 25 = 55 < cost 60).
      const created = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE CREDITO 10D",
        paymentMode: "CREDIT",
        creditDays: 10,
        lines: [{ productId, quantity: 4, unitDiscountPen: 25 }],
      });

      expect(created.requiresApproval).toBe(true);
      expect(created.operationalStatus).toBe("PENDING_PARTNER_APPROVAL");

      // Stock must still be 20 while PENDING_PARTNER_APPROVAL
      const stockBeforeRes = await client.query(
        `SELECT stock_on_hand FROM erp.v_current_stock WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId]
      );
      expect(Number(stockBeforeRes.rows[0].stock_on_hand)).toBe(20);

      // Warehouse role must NOT see PENDING_PARTNER_APPROVAL orders
      const whOrdersBefore = await listOrdersForRole(client, warehouseActor);
      expect(whOrdersBefore.some((o) => Number(o.order_id) === created.orderId)).toBe(
        false
      );

      // 2. Partner approves with 1 tap -> transitions to REGISTERED and deducts 4 units (stock = 16)
      const approved = await approveDiscountedOrder(
        client,
        partnerActor,
        created.orderId
      );
      expect(approved.operationalStatus).toBe("REGISTERED");

      const stockAfterApprove = await client.query(
        `SELECT stock_on_hand FROM erp.v_current_stock WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId]
      );
      expect(Number(stockAfterApprove.rows[0].stock_on_hand)).toBe(16);

      // 3. Warehouse advances PICKING -> READY -> IN_ROUTE -> DELIVERED and stamps responsible users
      await advanceWarehouseStatus(client, warehouseActor, created.orderId, "PICKING");
      await advanceWarehouseStatus(client, warehouseActor, created.orderId, "READY");
      await advanceWarehouseStatus(client, warehouseActor, created.orderId, "IN_ROUTE");
      await advanceWarehouseStatus(
        client,
        warehouseActor,
        created.orderId,
        "DELIVERED"
      );

      const orderCheck = await client.query(
        `SELECT operational_status::text AS status, approved_by_user_id, picked_by_user_id, delivered_by_user_id, promised_payment_date
         FROM erp.sales_orders WHERE order_id = $1`,
        [created.orderId]
      );
      expect(orderCheck.rows[0].status).toBe("DELIVERED");
      expect(Number(orderCheck.rows[0].approved_by_user_id)).toBe(partnerActor.userId);
      expect(Number(orderCheck.rows[0].picked_by_user_id)).toBe(warehouseActor.userId);
      expect(Number(orderCheck.rows[0].delivered_by_user_id)).toBe(
        warehouseActor.userId
      );
      expect(orderCheck.rows[0].promised_payment_date).not.toBeNull();

      // 4. Verify cancelling an unapproved order does NOT add duplicate RETURN_IN stock
      const unapproved = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE CANCELA SIN APROBAR",
        paymentMode: "CASH",
        lines: [{ productId, quantity: 3, unitDiscountPen: 25 }],
      });
      await cancelOrder(
        client,
        partnerActor,
        unapproved.orderId,
        "Descuento rechazado"
      );

      const stockAfterUnapprovedCancel = await client.query(
        `SELECT stock_on_hand FROM erp.v_current_stock WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId]
      );
      expect(Number(stockAfterUnapprovedCancel.rows[0].stock_on_hand)).toBe(16);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("supports Contra Entrega (collectOnDelivery) without premature settlement, blocks seller overrideBasePricePen, stamps delivered_at only on DELIVERED, and enforces strict state transitions", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const whRes = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);

      const prodRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-CONTRA-SKU', 'PRODUCTO CONTRA ENTREGA', 'UND', 'STOCKED', 100, 95, 70)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 20, 70, 'TEST_STOCK')`,
        [warehouseId, productId]
      );

      // Issue #1 & #4: Seller passes overrideBasePricePen=50 (must be ignored for EXTERNAL_SELLER) and collectOnDelivery=true on CASH order
      const contraOrder = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE CONTRA ENTREGA",
        paymentMode: "CASH",
        collectOnDelivery: true,
        lines: [{ productId, quantity: 2, overrideBasePricePen: 50 }],
      });

      const checkOrder = await client.query(
        `SELECT total_pen, paid_pen, balance_due_pen, is_settled, promised_payment_date::text AS promised_payment_date
         FROM erp.sales_orders WHERE order_id = $1`,
        [contraOrder.orderId]
      );
      // Must use catalog price 100 * 2 = 200 (ignoring seller's overrideBasePricePen=50)
      expect(Number(checkOrder.rows[0].total_pen)).toBe(200);
      // Contra Entrega: paid_pen must be 0 until collected on delivery
      expect(Number(checkOrder.rows[0].paid_pen)).toBe(0);
      expect(Number(checkOrder.rows[0].balance_due_pen)).toBe(200);
      expect(Boolean(checkOrder.rows[0].is_settled)).toBe(false);

      // Issue #6: Reject skipping from REGISTERED directly to DELIVERED
      await expect(
        advanceWarehouseStatus(client, warehouseActor, contraOrder.orderId, "DELIVERED")
      ).rejects.toThrow(ValidationError);

      await advanceWarehouseStatus(
        client,
        warehouseActor,
        contraOrder.orderId,
        "PICKING"
      );
      await advanceWarehouseStatus(
        client,
        warehouseActor,
        contraOrder.orderId,
        "READY"
      );
      await advanceWarehouseStatus(
        client,
        warehouseActor,
        contraOrder.orderId,
        "IN_ROUTE"
      );

      // Issue #5: On IN_ROUTE, delivered_by_user_id is set but delivered_at must still be NULL
      const inRouteCheck = await client.query(
        `SELECT delivered_by_user_id, delivered_at FROM erp.sales_orders WHERE order_id = $1`,
        [contraOrder.orderId]
      );
      expect(Number(inRouteCheck.rows[0].delivered_by_user_id)).toBe(
        warehouseActor.userId
      );
      expect(inRouteCheck.rows[0].delivered_at).toBeNull();

      await advanceWarehouseStatus(
        client,
        warehouseActor,
        contraOrder.orderId,
        "DELIVERED"
      );
      const deliveredCheck = await client.query(
        `SELECT delivered_at FROM erp.sales_orders WHERE order_id = $1`,
        [contraOrder.orderId]
      );
      expect(deliveredCheck.rows[0].delivered_at).not.toBeNull();

      // Issue #6: Reject backwards transition from DELIVERED to PICKING
      await expect(
        advanceWarehouseStatus(client, warehouseActor, contraOrder.orderId, "PICKING")
      ).rejects.toThrow(ValidationError);

      // Streamlined 3-stage warehouse flow (REGISTERED -> READY -> DELIVERED) stamps actors cleanly
      const fastOrder = await createOrder(client, partnerActor, {
        customerNameRaw: "CLIENTE FLUJO 3 ETAPAS",
        paymentMode: "CASH",
        collectOnDelivery: true,
        lines: [{ productId, quantity: 1 }],
      });
      await advanceWarehouseStatus(client, warehouseActor, fastOrder.orderId, "READY");
      await advanceWarehouseStatus(
        client,
        warehouseActor,
        fastOrder.orderId,
        "DELIVERED"
      );
      const fastCheck = await client.query(
        `SELECT operational_status::text AS status, picked_by_user_id, picked_at, delivered_by_user_id, delivered_at
         FROM erp.sales_orders WHERE order_id = $1`,
        [fastOrder.orderId]
      );
      expect(fastCheck.rows[0].status).toBe("DELIVERED");
      expect(Number(fastCheck.rows[0].picked_by_user_id)).toBe(warehouseActor.userId);
      expect(fastCheck.rows[0].picked_at).not.toBeNull();
      expect(Number(fastCheck.rows[0].delivered_by_user_id)).toBe(
        warehouseActor.userId
      );
      expect(fastCheck.rows[0].delivered_at).not.toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("applies packFactorApplied to SALE_OUT base stock movements and validates packFactorApplied > 0", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const whRes = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);

      const prodRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-PACK-FACTOR-01', 'MANGUERA ROLLO TEST PACK', 'MTR', 'STOCKED', 50, 40, 25)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 20, 25, 'TEST_PACK_STOCK')`,
        [warehouseId, productId]
      );

      // Reject packFactorApplied <= 0
      await expect(
        createOrder(client, sellerActor, {
          customerNameRaw: "CLIENTE PACK INVALIDO",
          paymentMode: "CASH",
          lines: [{ productId, quantity: 2, packFactorApplied: 0 }],
        })
      ).rejects.toThrow(ValidationError);

      // Quantity 2 with packFactorApplied 3 => 6 base units deducted via SALE_OUT
      const ord = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE PACK 3X",
        paymentMode: "CASH",
        lines: [{ productId, quantity: 2, packFactorApplied: 3 }],
      });

      const lineRes = await client.query(
        `SELECT quantity, pack_factor_applied FROM erp.sales_order_lines WHERE order_id = $1`,
        [ord.orderId]
      );
      expect(Number(lineRes.rows[0].quantity)).toBe(2);
      expect(Number(lineRes.rows[0].pack_factor_applied)).toBe(3);

      const movRes = await client.query(
        `SELECT quantity_delta FROM erp.inventory_movements
         WHERE product_id = $1 AND reference_table = 'erp.sales_orders' AND reference_id = $2`,
        [productId, String(ord.orderId)]
      );
      expect(Number(movRes.rows[0].quantity_delta)).toBe(-6);

      const stockRes = await client.query(
        `SELECT stock_on_hand FROM erp.v_current_stock WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId]
      );
      expect(Number(stockRes.rows[0].stock_on_hand)).toBe(14);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("generates atomic consecutive SO-YYYYMMDD-NNNN codes and enforces the credit_limit_pen soft gate with CREDIT_LIMIT_EXCEEDED audit flag", async () => {
    const { createCustomer } = await import("../src/lib/services/customers");
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const whRes = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);

      const prodRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-CREDIT-GATE-01', 'BOMBA CREDITO GATE', 'UND', 'STOCKED', 500, 480, 350)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 30, 350, 'TEST_CREDIT_GATE_STOCK')`,
        [warehouseId, productId]
      );

      const { customer } = await createCustomer(client, partnerActor, {
        tradeName: "Ferretería Límite Crédito",
        legalName: "Ferretería Límite Crédito SAC",
        cityZone: "LABERINTO",
        creditDaysAgreed: 15,
        creditLimitPen: 2000,
      });

      // 1. First CREDIT order for S/ 1,500 (within S/ 2,000 limit) -> REGISTERED, stock deducted (30 -> 27)
      const firstOrder = await createOrder(client, sellerActor, {
        customerPartyId: customer.party_id,
        customerNameRaw: customer.display_name,
        paymentMode: "CREDIT",
        lines: [{ productId, quantity: 3 }],
      });
      expect(firstOrder.orderCode).toMatch(/^SO-\d{8}-\d{4,}$/);
      expect(firstOrder.operationalStatus).toBe("REGISTERED");
      expect(firstOrder.requiresApproval).toBe(false);
      expect(firstOrder.creditLimitExceeded).toBe(false);

      // 2. Second CREDIT order for S/ 1,000 (open AR 1,500 + 1,000 = 2,500 > 2,000 limit)
      // Seller order must enter PENDING_PARTNER_APPROVAL without deducting stock, with credit_limit_exceeded_flag = TRUE
      const secondOrder = await createOrder(client, sellerActor, {
        customerPartyId: customer.party_id,
        customerNameRaw: customer.display_name,
        paymentMode: "CREDIT",
        lines: [{ productId, quantity: 2 }],
      });
      expect(secondOrder.orderCode).toMatch(/^SO-\d{8}-\d{4,}$/);
      expect(secondOrder.orderCode).not.toBe(firstOrder.orderCode);
      expect(secondOrder.operationalStatus).toBe("PENDING_PARTNER_APPROVAL");
      expect(secondOrder.requiresApproval).toBe(true);
      expect(secondOrder.creditLimitExceeded).toBe(true);

      const orderRow = await client.query<{
        credit_limit_exceeded_flag: boolean;
        stock_deducted: boolean;
      }>(
        `SELECT credit_limit_exceeded_flag, stock_deducted
         FROM erp.sales_orders WHERE order_id = $1`,
        [secondOrder.orderId]
      );
      expect(orderRow.rows[0].credit_limit_exceeded_flag).toBe(true);
      expect(orderRow.rows[0].stock_deducted).toBe(false);

      // Stock remains at 27 until partner approves
      const stockBeforeApprove = await client.query(
        `SELECT stock_on_hand FROM erp.v_current_stock WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId]
      );
      expect(Number(stockBeforeApprove.rows[0].stock_on_hand)).toBe(27);

      // Audit flag CREDIT_LIMIT_EXCEEDED is recorded
      const flagRes = await client.query<{ flag_code: string; status: string }>(
        `SELECT flag_code, status::text AS status
         FROM erp.audit_flags
         WHERE entity_table = 'erp.sales_orders'
           AND entity_id = $1
           AND flag_code = 'CREDIT_LIMIT_EXCEEDED'`,
        [String(secondOrder.orderId)]
      );
      expect(flagRes.rowCount).toBe(1);
      expect(flagRes.rows[0].status).toBe("OPEN");

      // Partner approves -> transitions to REGISTERED and deducts 2 units (27 -> 25)
      const approved = await approveDiscountedOrder(
        client,
        partnerActor,
        secondOrder.orderId
      );
      expect(approved.operationalStatus).toBe("REGISTERED");

      const stockAfterApprove = await client.query(
        `SELECT stock_on_hand FROM erp.v_current_stock WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId]
      );
      expect(Number(stockAfterApprove.rows[0].stock_on_hand)).toBe(25);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("serializes concurrent ON_DEMAND purchase fulfillment via FOR UPDATE across parallel DB connections without double-fulfilling", async () => {
    const { registerSupplierPurchase, createSupplier } =
      await import("../src/lib/services/purchases-and-suppliers");
    const pool = getPool("dev");
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const uniqueSku = `TEST-CONC-${suffix}`;

    let productId: number | null = null;
    let supplierPartyId: number | null = null;
    const orderIds: number[] = [];
    const purchaseIds: number[] = [];

    // Commit minimal isolated fixture so two concurrent connections can race on the exact same locked rows
    const setupClient = await pool.connect();
    let orderLineId = 0;
    try {
      await setupClient.query("BEGIN");
      const prodRes = await setupClient.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ($1, 'SKU CONCURRENCIA FOR UPDATE', 'NIU', 'ON_DEMAND', 120, 100, 70)
         RETURNING product_id`,
        [uniqueSku]
      );
      productId = Number(prodRes.rows[0].product_id);

      const { supplier } = await createSupplier(setupClient, partnerActor, {
        legalName: `PROVEEDOR CONC ${suffix}`,
        docType: "NONE",
      });
      supplierPartyId = supplier.party_id;

      const ord = await createOrder(setupClient, sellerActor, {
        customerNameRaw: `CLIENTE CONC ${suffix}`,
        paymentMode: "CREDIT",
        creditDays: 7,
        lines: [{ productId, quantity: 3 }],
      });
      orderIds.push(ord.orderId);

      const olRes = await setupClient.query(
        `SELECT order_line_id FROM erp.sales_order_lines WHERE order_id = $1`,
        [ord.orderId]
      );
      orderLineId = Number(olRes.rows[0].order_line_id);
      await setupClient.query("COMMIT");
    } catch (err) {
      await setupClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      setupClient.release();
    }

    try {
      const runPurchaseRace = async (docNum: string) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const out = await registerSupplierPurchase(c, partnerActor, {
            supplierPartyId: supplierPartyId!,
            docType: "FACTURA",
            docSeries: "F901",
            docNumber: docNum,
            paymentCondition: "CREDIT",
            items: [{ productId: productId!, quantity: 4, unitCostPen: 75 }],
            fulfillOrderLineIds: [orderLineId],
          });
          await c.query("COMMIT");
          purchaseIds.push(out.purchaseId);
          return out;
        } catch (err) {
          await c.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          c.release();
        }
      };

      const results = await Promise.allSettled([
        runPurchaseRace(`RACE1-${suffix}`),
        runPurchaseRace(`RACE2-${suffix}`),
      ]);

      const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      );
      expect(fulfilledCount).toBe(1);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason).toBeInstanceOf(ValidationError);

      // Verify stock_on_hand is exactly 4 - 3 = 1 (never 4 or 8)
      const checkClient = await pool.connect();
      try {
        const stockRes = await checkClient.query(
          `SELECT vcs.stock_on_hand
           FROM erp.v_current_stock vcs
           JOIN erp.warehouses w ON w.warehouse_id = vcs.warehouse_id AND w.code = 'MAIN'
           WHERE vcs.product_id = $1`,
          [productId]
        );
        expect(Number(stockRes.rows[0].stock_on_hand)).toBe(1);
      } finally {
        checkClient.release();
      }
    } finally {
      // Complete deterministic cleanup of temporary concurrency test rows on dev
      const cleanClient = await pool.connect();
      try {
        await cleanClient.query("BEGIN");
        await cleanClient.query(
          "SELECT set_config('bht.allow_hard_delete', 'on', true)"
        );
        if (orderLineId > 0) {
          await cleanClient.query(
            `DELETE FROM erp.audit_flags WHERE entity_table = 'erp.sales_order_lines' AND entity_id = $1`,
            [String(orderLineId)]
          );
        }
        if (orderIds.length > 0) {
          await cleanClient.query(
            `DELETE FROM erp.audit_flags WHERE entity_table = 'erp.sales_orders' AND entity_id = ANY($1)`,
            [orderIds.map(String)]
          );
        }
        if (productId) {
          await cleanClient.query(
            `DELETE FROM erp.inventory_movements WHERE product_id = $1`,
            [productId]
          );
        }
        if (orderIds.length > 0) {
          await cleanClient.query(
            `DELETE FROM erp.sales_order_lines WHERE order_id = ANY($1)`,
            [orderIds]
          );
          await cleanClient.query(
            `DELETE FROM erp.undoable_actions
             WHERE entity_table = 'erp.sales_orders'
               AND entity_id = ANY($1::text[])`,
            [orderIds.map(String)]
          );
          await cleanClient.query(
            `DELETE FROM erp.sales_orders WHERE order_id = ANY($1)`,
            [orderIds]
          );
        }
        if (supplierPartyId) {
          await cleanClient.query(
            `DELETE FROM erp.ap_obligations WHERE supplier_party_id = $1`,
            [supplierPartyId]
          );
        }
        if (productId) {
          await cleanClient.query(
            `DELETE FROM erp.purchase_invoice_lines WHERE product_id = $1`,
            [productId]
          );
        }
        if (purchaseIds.length > 0) {
          await cleanClient.query(
            `DELETE FROM erp.purchase_invoices WHERE purchase_id = ANY($1)`,
            [purchaseIds]
          );
        } else if (supplierPartyId) {
          await cleanClient.query(
            `DELETE FROM erp.purchase_invoices WHERE supplier_party_id = $1`,
            [supplierPartyId]
          );
        }
        if (supplierPartyId) {
          await cleanClient.query(`DELETE FROM erp.parties WHERE party_id = $1`, [
            supplierPartyId,
          ]);
        }
        if (productId) {
          await cleanClient.query(`DELETE FROM erp.products WHERE product_id = $1`, [
            productId,
          ]);
        }
        await cleanClient.query("COMMIT");
      } finally {
        cleanClient.release();
      }
    }
  });
});
