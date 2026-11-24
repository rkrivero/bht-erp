import { describe, expect, it } from "vitest";
import { getPool } from "../src/lib/db";
import type { SessionUser } from "../src/lib/types";
import { createOrder } from "../src/lib/services/orders";
import {
  convertQuoteToOrder,
  createQuote,
  listQuotes,
  updateQuote,
  updateQuoteStatus,
} from "../src/lib/services/operations-and-modules";
import { AuthorizationError } from "../src/lib/types";
import { listPriceOverrides } from "../src/lib/services/price-audit";

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

describe("Quote edits, direct negotiated unit prices, global discounts & price override audit", () => {
  it("records LOWER and HIGHER negotiated prices + global discount on orders and enforces immutability", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const p1 = await client.query<{ product_id: string }>(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-PRICE-LOW', 'TUBO PVC 2 PULG', 'NIU', 'STOCKED', 25.00, 22.00, 18.00)
         RETURNING product_id::text`
      );
      const p2 = await client.query<{ product_id: string }>(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-PRICE-HIGH', 'CEMENTO SOL 42KG', 'NIU', 'STOCKED', 30.00, 28.00, 24.00)
         RETURNING product_id::text`
      );
      const prod1 = Number(p1.rows[0].product_id);
      const prod2 = Number(p2.rows[0].product_id);

      const created = await createOrder(client, sellerActor, {
        customerNameRaw: "FERRETERIA EL SOL",
        paymentMode: "CASH",
        collectOnDelivery: true,
        globalDiscountPen: 5.0,
        notes: "Negociado en tienda",
        lines: [
          { productId: prod1, quantity: 4, unitPricePen: 23.0 }, // 92.00 (-2/u)
          { productId: prod2, quantity: 2, unitPricePen: 32.5 }, // 65.00 (+2.5/u)
        ],
      });

      const orderRow = await client.query(
        `SELECT total_pen, global_discount_pen FROM erp.sales_orders WHERE order_id = $1`,
        [created.orderId]
      );
      // 92 + 65 = 157 - 5 global discount = 152.00
      expect(Number(orderRow.rows[0].total_pen)).toBe(152);
      expect(Number(orderRow.rows[0].global_discount_pen)).toBe(5);

      const overrides = await listPriceOverrides(client, partnerActor, {
        entityType: "ORDER",
        limit: 20,
      });
      const orderOverrides = overrides.filter((o) => o.entity_id === created.orderId);
      expect(orderOverrides).toHaveLength(2);

      const lower = orderOverrides.find((o) => o.product_id === prod1)!;
      expect(lower.direction).toBe("LOWER");
      expect(lower.catalog_price_pen).toBe(25);
      expect(lower.applied_price_pen).toBe(23);
      expect(lower.delta_pen).toBe(-2);
      expect(lower.total_impact_pen).toBe(-8);
      expect(lower.customer_name).toBe("FERRETERIA EL SOL");
      expect(lower.actor_user_id).toBe(sellerActor.userId);

      const higher = orderOverrides.find((o) => o.product_id === prod2)!;
      expect(higher.direction).toBe("HIGHER");
      expect(higher.catalog_price_pen).toBe(30);
      expect(higher.applied_price_pen).toBe(32.5);
      expect(higher.delta_pen).toBe(2.5);
      expect(higher.total_impact_pen).toBe(5);

      // Verify immutability trigger on erp.price_override_log
      await expect(
        client.query(`DELETE FROM erp.price_override_log WHERE override_id = $1`, [
          lower.override_id,
        ])
      ).rejects.toThrow(/inmutable/i);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("edits an OPEN quote with immutable audit history and preserves negotiated prices + global discount on conversion", async () => {
    const pool = getPool("dev");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const p1 = await client.query<{ product_id: string }>(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-Q-EDIT', 'FIERRO CORRUGADO 1/2', 'NIU', 'STOCKED', 40.00, 38.00, 30.00)
         RETURNING product_id::text`
      );
      const prod1 = Number(p1.rows[0].product_id);

      const quote = await createQuote(client, sellerActor, {
        customerNameRaw: "CONSTRUCTORA TAMBOPATA",
        globalDiscountPen: 0,
        lines: [{ productId: prod1, quantity: 10, unitPricePen: 40.0 }],
      });
      expect(quote.totalPen).toBe(400);

      const updated = await updateQuote(client, sellerActor, {
        quoteId: quote.quoteId,
        customerNameRaw: "CONSTRUCTORA TAMBOPATA",
        globalDiscountPen: 15.0,
        reason: "Cliente pidió rebaja unitaria y descuento por volumen",
        lines: [{ productId: prod1, quantity: 12, unitPricePen: 38.5 }], // 462 - 15 = 447
      });
      expect(updated.totalPen).toBe(447);

      const quotes = await listQuotes(client, sellerActor, 50);
      const found = quotes.find((q) => Number(q.quote_id) === quote.quoteId) as
        | {
            total_pen: number;
            global_discount_pen: number;
            audit_history: Array<{ action: string; reason: string }>;
          }
        | undefined;
      expect(found).toBeDefined();
      expect(found!.total_pen).toBe(447);
      expect(found!.global_discount_pen).toBe(15);
      expect(found!.audit_history).toHaveLength(1);
      expect(found!.audit_history[0].action).toBe("EDIT");
      expect(found!.audit_history[0].reason).toContain("volumen");

      // Convert edited quote to order and verify exact total and global discount carried over
      const converted = await convertQuoteToOrder(client, sellerActor, {
        quoteId: quote.quoteId,
        paymentMode: "CASH",
        collectOnDelivery: true,
      });
      const orderRow = await client.query(
        `SELECT total_pen, global_discount_pen FROM erp.sales_orders WHERE order_id = $1`,
        [converted.order.orderId]
      );
      expect(Number(orderRow.rows[0].total_pen)).toBe(447);
      expect(Number(orderRow.rows[0].global_discount_pen)).toBe(15);

      // Ownership IDOR check: another EXTERNAL_SELLER cannot edit/cancel/convert a partner or peer quote
      const partnerQuote = await createQuote(client, partnerActor, {
        customerNameRaw: "CLIENTE DEL SOCIO",
        lines: [{ productId: prod1, quantity: 2, unitPricePen: 40 }],
      });

      await expect(
        updateQuote(client, sellerActor, {
          quoteId: partnerQuote.quoteId,
          lines: [{ productId: prod1, quantity: 1, unitPricePen: 40 }],
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        updateQuoteStatus(client, sellerActor, {
          quoteId: partnerQuote.quoteId,
          nextStatus: "CANCELLED",
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        convertQuoteToOrder(client, sellerActor, {
          quoteId: partnerQuote.quoteId,
          paymentMode: "CASH",
        })
      ).rejects.toThrow(AuthorizationError);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
