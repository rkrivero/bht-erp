import { describe, expect, it } from "vitest";
import { getPool } from "../src/lib/db";
import { ValidationError, type SessionUser } from "../src/lib/types";
import {
  advanceWarehouseStatus,
  approveDiscountedOrder,
  cancelOrder,
  createOrder,
  listOrdersForRole,
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

  it("holds EXTERNAL_SELLER order below min_sale_price_pen in PENDING_PARTNER_APPROVAL without deducting stock until Partner approves, and handles cancellation safely", async () => {
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

      // 1. Seller requests S/ 5 per unit discount (80 - 5 = 75 < min 78) with 10-day credit promise
      const created = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE CREDITO 10D",
        paymentMode: "CREDIT",
        creditDays: 10,
        lines: [{ productId, quantity: 4, unitDiscountPen: 5 }],
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
      expect(
        whOrdersBefore.some((o) => Number(o.order_id) === created.orderId)
      ).toBe(false);

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
      await advanceWarehouseStatus(client, warehouseActor, created.orderId, "DELIVERED");

      const orderCheck = await client.query(
        `SELECT operational_status::text AS status, approved_by_user_id, picked_by_user_id, delivered_by_user_id, promised_payment_date
         FROM erp.sales_orders WHERE order_id = $1`,
        [created.orderId]
      );
      expect(orderCheck.rows[0].status).toBe("DELIVERED");
      expect(Number(orderCheck.rows[0].approved_by_user_id)).toBe(partnerActor.userId);
      expect(Number(orderCheck.rows[0].picked_by_user_id)).toBe(warehouseActor.userId);
      expect(Number(orderCheck.rows[0].delivered_by_user_id)).toBe(warehouseActor.userId);
      expect(orderCheck.rows[0].promised_payment_date).not.toBeNull();

      // 4. Verify cancelling an unapproved order does NOT add duplicate RETURN_IN stock
      const unapproved = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE CANCELA SIN APROBAR",
        paymentMode: "CASH",
        lines: [{ productId, quantity: 3, unitDiscountPen: 5 }],
      });
      await cancelOrder(client, partnerActor, unapproved.orderId, "Descuento rechazado");

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

      await advanceWarehouseStatus(client, warehouseActor, contraOrder.orderId, "PICKING");
      await advanceWarehouseStatus(client, warehouseActor, contraOrder.orderId, "READY");
      await advanceWarehouseStatus(client, warehouseActor, contraOrder.orderId, "IN_ROUTE");

      // Issue #5: On IN_ROUTE, delivered_by_user_id is set but delivered_at must still be NULL
      const inRouteCheck = await client.query(
        `SELECT delivered_by_user_id, delivered_at FROM erp.sales_orders WHERE order_id = $1`,
        [contraOrder.orderId]
      );
      expect(Number(inRouteCheck.rows[0].delivered_by_user_id)).toBe(warehouseActor.userId);
      expect(inRouteCheck.rows[0].delivered_at).toBeNull();

      await advanceWarehouseStatus(client, warehouseActor, contraOrder.orderId, "DELIVERED");
      const deliveredCheck = await client.query(
        `SELECT delivered_at FROM erp.sales_orders WHERE order_id = $1`,
        [contraOrder.orderId]
      );
      expect(deliveredCheck.rows[0].delivered_at).not.toBeNull();

      // Issue #6: Reject backwards transition from DELIVERED to PICKING
      await expect(
        advanceWarehouseStatus(client, warehouseActor, contraOrder.orderId, "PICKING")
      ).rejects.toThrow(ValidationError);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
