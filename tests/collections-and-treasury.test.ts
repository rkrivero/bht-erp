import { describe, expect, it } from "vitest";
import { getPool } from "../src/lib/db";
import {
  AuthorizationError,
  ValidationError,
  type SessionUser,
} from "../src/lib/types";
import { createOrder } from "../src/lib/services/orders";
import {
  getOrderPaymentTimeline,
  listDebtors,
  registerCashOutflow,
  registerCustomerFifoPayment,
  registerOrderPayment,
  resetHistoricalNegativeStock,
  updateProductStockAndPricing,
} from "../src/lib/services/collections-and-treasury";

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

describe("Collections, Partial Amortizations, FIFO, Debtors Aging, Treasury & Day-1 Stock Reset", () => {
  it("supports initial Adelanto, multiple partial abonos with collection date rescheduling, payment timeline, and rejects overpayment", async () => {
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
         VALUES ('TEST-ABONO-SKU', 'PRODUCTO ABONO TEST', 'UND', 'STOCKED', 100, 95, 70)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 25, 70, 'TEST_STOCK')`,
        [warehouseId, productId]
      );

      // 1. Create S/ 1,000 credit order with S/ 400 initial Adelanto and 10-day promise
      const order = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE ABONOS MULTIPLES",
        paymentMode: "CREDIT",
        creditDays: 10,
        initialPaidPen: 400,
        lines: [{ productId, quantity: 10, unitDiscountPen: 0 }],
      });

      // Issue #2: Unapproved order (PENDING_PARTNER_APPROVAL) must NOT appear in listDebtors or accept registerOrderPayment
      const unapprovedOrder = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE DESCUENTO PENDIENTE",
        paymentMode: "CREDIT",
        creditDays: 7,
        lines: [{ productId, quantity: 2, unitDiscountPen: 10 }], // 100 - 10 = 90 < min 95
      });
      expect(unapprovedOrder.operationalStatus).toBe("PENDING_PARTNER_APPROVAL");

      const debtorsCheck = await listDebtors(client, partnerActor);
      expect(
        debtorsCheck.byOrder.some((d) => d.orderId === unapprovedOrder.orderId)
      ).toBe(false);

      await expect(
        registerOrderPayment(client, sellerActor, {
          orderId: unapprovedOrder.orderId,
          amountPen: 50,
          paymentMode: "CASH",
        })
      ).rejects.toThrow(ValidationError);

      // 2. Partial Abono #2 of S/ 350 and reschedule next visit in 7 days
      const abono2 = await registerOrderPayment(client, sellerActor, {
        orderId: order.orderId,
        amountPen: 350,
        paymentMode: "YAPE_PLIN",
        nextCollectionDays: 7,
        notes: "Abono parcial Yape",
      });
      expect(abono2.newPaidPen).toBe(750);
      expect(abono2.newBalanceDuePen).toBe(250);
      expect(abono2.isSettled).toBe(false);
      expect(abono2.promisedPaymentDate).not.toBeNull();

      // 3. Reject overpayment (S/ 300 > S/ 250 remaining)
      await expect(
        registerOrderPayment(client, sellerActor, {
          orderId: order.orderId,
          amountPen: 300,
          paymentMode: "CASH",
        })
      ).rejects.toThrow(ValidationError);

      // 4. Final Abono #3 of S/ 250 settles order
      const abono3 = await registerOrderPayment(client, partnerActor, {
        orderId: order.orderId,
        amountPen: 250,
        paymentMode: "CASH",
        notes: "Cancelación final",
      });
      expect(abono3.newPaidPen).toBe(1000);
      expect(abono3.newBalanceDuePen).toBe(0);
      expect(abono3.isSettled).toBe(true);

      // 5. Verify full chronological timeline (3 payments)
      const timeline = await getOrderPaymentTimeline(
        client,
        partnerActor,
        order.orderId
      );
      expect(timeline.length).toBe(3);
      expect(timeline.map((t) => t.amountPen)).toEqual([400, 350, 250]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("distributes FIFO customer payment across multiple open credit orders oldest-first", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const whRes = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);

      const partyRes = await client.query(
        `INSERT INTO erp.parties (canonical_key, party_type, legal_name, trade_name)
         VALUES ('CUST_FIFO_TEST', 'CUSTOMER', 'DISTRIBUIDORA FIFO SAC', 'DISTRIBUIDORA FIFO')
         RETURNING party_id`
      );
      const customerPartyId = Number(partyRes.rows[0].party_id);

      const prodRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-FIFO-SKU', 'PRODUCTO FIFO TEST', 'UND', 'STOCKED', 100, 95, 70)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 30, 70, 'TEST_FIFO_STOCK')`,
        [warehouseId, productId]
      );

      // Older order: S/ 400
      const olderOrder = await createOrder(client, sellerActor, {
        customerPartyId,
        customerNameRaw: "DISTRIBUIDORA FIFO",
        paymentMode: "CREDIT",
        creditDays: 7,
        lines: [{ productId, quantity: 4 }],
      });

      // Newer order: S/ 500
      const newerOrder = await createOrder(client, sellerActor, {
        customerPartyId,
        customerNameRaw: "DISTRIBUIDORA FIFO",
        paymentMode: "CREDIT",
        creditDays: 15,
        lines: [{ productId, quantity: 5 }],
      });

      // Pay S/ 600 lump sum -> settles older (S/ 400) and applies S/ 200 to newer (leaving S/ 300)
      const allocations = await registerCustomerFifoPayment(client, sellerActor, {
        customerPartyId,
        totalAmountPen: 600,
        paymentMode: "TRANSFER",
        nextCollectionDays: 10,
      });

      expect(allocations).toEqual([
        {
          orderId: olderOrder.orderId,
          orderCode: olderOrder.orderCode,
          appliedPen: 400,
        },
        {
          orderId: newerOrder.orderId,
          orderCode: newerOrder.orderCode,
          appliedPen: 200,
        },
      ]);

      const debtors = await listDebtors(client, sellerActor);
      const fifoCust = debtors.byCustomer.find(
        (c) => c.customerPartyId === customerPartyId
      );
      expect(fifoCust?.totalBalanceDuePen).toBe(300);
      const fifoOrder = debtors.byOrder.find(
        (o) => o.orderId === newerOrder.orderId
      );
      expect(fifoOrder?.customerKey).toBe(`PARTY-${customerPartyId}`);
      expect(fifoOrder?.lines.length).toBe(1);
      expect(fifoOrder?.lines[0]).toMatchObject({
        sku: "TEST-FIFO-SKU",
        unitOfMeasure: "UND",
        quantity: 5,
        unitPricePen: 100,
        lineTotalPen: 500,
      });
      expect(fifoOrder?.lines[0]).not.toHaveProperty("unitCostSnapshotPen");
      expect(fifoOrder?.lines[0]).not.toHaveProperty("unit_cost_snapshot_pen");
      expect(fifoCust?.openOrdersCount).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("enforces ROUTE_OPEX restriction on EXTERNAL_SELLER and idempotent Day-1 negative stock reset", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const routeExpense = await registerCashOutflow(client, sellerActor, {
        amountPen: 35,
        expenseBucket: "ROUTE_OPEX",
        expenseCategory: "COMBUSTIBLE",
        description: "Gasolina ruta sur",
      });
      expect(routeExpense.ledgerId).toBeGreaterThan(0);

      await expect(
        registerCashOutflow(client, sellerActor, {
          amountPen: 500,
          expenseBucket: "NON_OPEX_OR_CAPEX",
          expenseCategory: "RETIRO",
          description: "Intento no autorizado",
        })
      ).rejects.toThrow(AuthorizationError);

      // Day-1 negative stock reset: first call resets all 93 negative historical SKUs, second call resets 0
      const firstReset = await resetHistoricalNegativeStock(client, partnerActor);
      expect(firstReset.adjustedSkuCount).toBe(93);

      const secondReset = await resetHistoricalNegativeStock(client, partnerActor);
      expect(secondReset.adjustedSkuCount).toBe(0);

      // Update product physical stock & pricing
      const prodRes = await client.query(
        `SELECT product_id FROM erp.products WHERE sku = 'CARPET VERDEX2MT' LIMIT 1`
      );
      const pid = Number(prodRes.rows[0].product_id);
      await updateProductStockAndPricing(client, partnerActor, {
        productId: pid,
        physicalStock: 45,
        refCostPen: 63.31,
        listSalePricePen: 72,
        minSalePricePen: 69,
      });

      const checkProd = await client.query(
        `SELECT p.list_sale_price_pen, p.min_sale_price_pen, vcs.stock_on_hand
         FROM erp.products p
         JOIN erp.v_current_stock vcs ON vcs.product_id = p.product_id
         JOIN erp.warehouses w ON w.warehouse_id = vcs.warehouse_id AND w.code = 'MAIN'
         WHERE p.product_id = $1`,
        [pid]
      );
      expect(Number(checkProd.rows[0].list_sale_price_pen)).toBe(72);
      expect(Number(checkProd.rows[0].min_sale_price_pen)).toBe(69);
      expect(Number(checkProd.rows[0].stock_on_hand)).toBe(45);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
