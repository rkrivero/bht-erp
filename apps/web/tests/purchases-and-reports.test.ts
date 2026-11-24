import { describe, expect, it } from "vitest";
import { getPool } from "../src/lib/db";
import { createOrder } from "../src/lib/services/orders";
import {
  createSupplier,
  getPurchasesDashboard,
  payApObligation,
  registerSupplierPurchase,
} from "../src/lib/services/purchases-and-suppliers";
import {
  REPORT_CSV_DATASETS,
  buildCsvWithBom,
  escapeCsvCell,
  getBiSummary,
  getReportDatasetRows,
} from "../src/lib/services/analytics-and-reports";
import {
  REPORT_SECTIONS,
  getReportSectionData,
  parseReportFilters,
} from "../src/lib/services/report-sections";
import {
  AuthorizationError,
  ValidationError,
  type SessionUser,
} from "../src/lib/types";

const partnerActor: SessionUser = {
  userId: 1,
  username: "socio_admin",
  fullName: "Socio Operativo y Admin",
  role: "PARTNER_ADMIN",
  defaultCashAccountId: 1,
};

const partnerManagerActor: SessionUser = {
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

describe("Purchases, Suppliers, ON_DEMAND Fulfillment, AP Payments & BI Reports", () => {
  it("creates generic suppliers, enforces uq_parties_real_doc gracefully, and enforces partner-only RBAC", async () => {
    const client = await getPool("dev").connect();
    try {
      await client.query("BEGIN");

      await expect(
        createSupplier(client, sellerActor, {
          legalName: "PROVEEDOR NO AUTORIZADO SAC",
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        createSupplier(client, warehouseActor, {
          legalName: "PROVEEDOR ALMACEN SAC",
        })
      ).rejects.toThrow(AuthorizationError);

      const createdRuc = await createSupplier(client, partnerManagerActor, {
        legalName: "Importadora Ferretera Andina SAC",
        tradeName: "Ferretera Andina",
        docType: "RUC",
        docNumber: "20999888777",
        phone: "999111222",
      });
      expect(createdRuc.supplier.party_id).toBeGreaterThan(0);
      expect(createdRuc.supplier.display_name).toBe("FERRETERA ANDINA");
      expect(createdRuc.supplier.doc_type).toBe("RUC");
      expect(createdRuc.supplier.doc_number).toBe("20999888777");

      // Duplicate real RUC must raise ValidationError cleanly (not unhandled PG 23505)
      await expect(
        createSupplier(client, partnerActor, {
          legalName: "Otra Razon Social SAC",
          docType: "RUC",
          docNumber: "20999888777",
        })
      ).rejects.toThrow(ValidationError);

      // Generic NONE supplier without docNumber succeeds
      const createdNone = await createSupplier(client, partnerActor, {
        legalName: "Proveedor Local Sin RUC",
        docType: "NONE",
      });
      expect(createdNone.supplier.doc_type).toBe("NONE");
      expect(createdNone.supplier.doc_number).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("registers a PARTIAL supplier purchase, increments MAIN stock, updates ref_cost_pen, triggers ON_DEMAND fulfillment, and processes partial+full AP payments", async () => {
    const client = await getPool("dev").connect();
    try {
      await client.query("BEGIN");

      const whRes = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);

      const { supplier } = await createSupplier(client, partnerActor, {
        legalName: "DISTRIBUIDORA NORTE TEST SAC",
        docType: "RUC",
        docNumber: "20888777666",
      });

      // Create 1 ON_DEMAND SKU (stock=0) and 1 STOCKED SKU (stock=5)
      const onDemandProdRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-ONDEMAND-01', 'BOMBA INDUSTRIAL BAJO PEDIDO TEST', 'UND', 'ON_DEMAND', 120, 110, 80)
         RETURNING product_id`
      );
      const onDemandProductId = Number(onDemandProdRes.rows[0].product_id);

      const stockedProdRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-STOCKED-01', 'LLAVE MIXTA STOCK TEST', 'UND', 'STOCKED', 35, 30, 18)
         RETURNING product_id`
      );
      const stockedProductId = Number(stockedProdRes.rows[0].product_id);

      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 5, 18, 'SEED_TEST_STOCK')`,
        [warehouseId, stockedProductId]
      );

      // Customer orders 3 units of the ON_DEMAND product (creates PENDING_SUPPLIER_PURCHASE + audit flag)
      const order = await createOrder(client, sellerActor, {
        customerNameRaw: "CLIENTE ON DEMAND TEST",
        paymentMode: "CASH",
        lines: [{ productId: onDemandProductId, quantity: 3 }],
      });
      expect(order.operationalStatus).toBe("REGISTERED");

      const olBeforeRes = await client.query(
        `SELECT order_line_id, fulfillment_status::text AS fulfillment_status
         FROM erp.sales_order_lines
         WHERE order_id = $1`,
        [order.orderId]
      );
      const onDemandOrderLineId = Number(olBeforeRes.rows[0].order_line_id);
      expect(olBeforeRes.rows[0].fulfillment_status).toBe("PENDING_SUPPLIER_PURCHASE");

      const flagBeforeRes = await client.query(
        `SELECT status FROM erp.audit_flags
         WHERE flag_code = 'ON_DEMAND_PENDING_PURCHASE'
           AND entity_table = 'erp.sales_order_lines'
           AND entity_id = $1`,
        [String(onDemandOrderLineId)]
      );
      expect(flagBeforeRes.rows[0]?.status).toBe("OPEN");

      const dashBefore = await getPurchasesDashboard(client, partnerActor);
      expect(
        dashBefore.pendingOnDemand.some(
          (od) => Number(od.order_line_id) === onDemandOrderLineId
        )
      ).toBe(true);

      // Register PARTIAL supplier purchase: 4x85 (340) + 10x20 (200) = 540, paying 200 now
      const purchase = await registerSupplierPurchase(client, partnerActor, {
        supplierPartyId: supplier.party_id,
        docType: "FACTURA",
        docSeries: "F001",
        docNumber: "990011",
        paymentCondition: "PARTIAL",
        paidNowPen: 200,
        notes: "Compra mixta test con cierre ON_DEMAND",
        items: [
          { productId: onDemandProductId, quantity: 4, unitCostPen: 85 },
          { productId: stockedProductId, quantity: 10, unitCostPen: 20 },
        ],
        fulfillOrderLineIds: [onDemandOrderLineId],
      });

      expect(purchase.totalPen).toBe(540);
      expect(purchase.paidNowPen).toBe(200);
      expect(purchase.balanceDuePen).toBe(340);
      expect(purchase.apId).toBeGreaterThan(0);
      expect(purchase.ledgerId).toBeGreaterThan(0);
      expect(purchase.fulfilledOrderLineIds).toEqual([onDemandOrderLineId]);

      // Verify stock increments & product ref_cost_pen updates
      const stockCheck = await client.query(
        `SELECT p.product_id, p.ref_cost_pen, p.cost_source, vcs.stock_on_hand
         FROM erp.products p
         JOIN erp.v_current_stock vcs ON vcs.product_id = p.product_id AND vcs.warehouse_id = $1
         WHERE p.product_id = ANY($2::bigint[])`,
        [warehouseId, [onDemandProductId, stockedProductId]]
      );
      const onDemandRow = stockCheck.rows.find(
        (r) => Number(r.product_id) === onDemandProductId
      );
      const stockedRow = stockCheck.rows.find(
        (r) => Number(r.product_id) === stockedProductId
      );
      expect(Number(onDemandRow.stock_on_hand)).toBe(1);
      expect(Number(onDemandRow.ref_cost_pen)).toBe(85);
      expect(onDemandRow.cost_source).toBe("PURCHASE_APP");
      expect(Number(stockedRow.stock_on_hand)).toBe(15);
      expect(Number(stockedRow.ref_cost_pen)).toBeCloseTo(19.3333, 4);

      // Verify ON_DEMAND trigger automatically set FULFILLED and resolved the OPEN audit flag
      const olAfterRes = await client.query(
        `SELECT fulfillment_status::text AS fulfillment_status, fulfilling_purchase_line_id
         FROM erp.sales_order_lines
         WHERE order_line_id = $1`,
        [onDemandOrderLineId]
      );
      expect(olAfterRes.rows[0].fulfillment_status).toBe("FULFILLED");
      expect(Number(olAfterRes.rows[0].fulfilling_purchase_line_id)).toBeGreaterThan(0);

      const flagAfterRes = await client.query(
        `SELECT status FROM erp.audit_flags
         WHERE flag_code = 'ON_DEMAND_PENDING_PURCHASE'
           AND entity_table = 'erp.sales_order_lines'
           AND entity_id = $1`,
        [String(onDemandOrderLineId)]
      );
      expect(flagAfterRes.rows[0]?.status).toBe("RESOLVED");

      // Duplicate invoice number for same supplier rejected cleanly
      await expect(
        registerSupplierPurchase(client, partnerActor, {
          supplierPartyId: supplier.party_id,
          docType: "FACTURA",
          docSeries: "F001",
          docNumber: "990011",
          paymentCondition: "CASH",
          items: [{ productId: stockedProductId, quantity: 1, unitCostPen: 20 }],
        })
      ).rejects.toThrow(ValidationError);

      // Partial AP payment (S/ 140) leaves S/ 200 PARTIAL
      const pay1 = await payApObligation(client, partnerManagerActor, {
        apId: purchase.apId!,
        amountPen: 140,
        notes: "Abono transferencia proveedor",
      });
      expect(pay1.newPaidPen).toBe(340);
      expect(pay1.newBalanceDuePen).toBe(200);
      expect(pay1.status).toBe("PARTIAL");
      expect(pay1.ledgerId).toBeGreaterThan(0);

      // Overpayment (> S/ 200.05) must fail cleanly
      await expect(
        payApObligation(client, partnerActor, {
          apId: purchase.apId!,
          amountPen: 205,
        })
      ).rejects.toThrow(ValidationError);

      // Final AP payment (S/ 200) closes obligation as PAID
      const pay2 = await payApObligation(client, partnerActor, {
        apId: purchase.apId!,
        amountPen: 200,
        notes: "Cancelación total factura",
      });
      expect(pay2.newPaidPen).toBe(540);
      expect(pay2.newBalanceDuePen).toBe(0);
      expect(pay2.status).toBe("PAID");

      // Paying an already PAID obligation must fail
      await expect(
        payApObligation(client, partnerActor, {
          apId: purchase.apId!,
          amountPen: 10,
        })
      ).rejects.toThrow(ValidationError);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("computes BI summary panels and builds valid RFC-4180 UTF-8 BOM CSV exports for all 5 datasets", async () => {
    const client = await getPool("dev").connect();
    try {
      const bi = await getBiSummary(client);
      expect(bi.monthlyPerformance.length).toBeGreaterThanOrEqual(4);
      expect(bi.monthlyPerformance[0].period_month).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(bi.monthlyPerformance[0].pre_route_foundational_outflow_pen).toBe(
        81267.86
      );

      // Migration 029 simplified active cash accounts from 5 to 3 (CAJA_RUTA, BCP, BBVA/etc.)
      expect(bi.cashAccountsSummary.length).toBeGreaterThanOrEqual(3);
      expect(bi.cashAccountsSummary.some((a) => a.code === "CAJA_RUTA")).toBe(true);
      expect(bi.topCustomers.length).toBeGreaterThan(0);
      expect(bi.topCustomers.length).toBeLessThanOrEqual(15);
      expect(bi.lowStockAlerts.length).toBeLessThanOrEqual(25);
      for (const item of bi.lowStockAlerts) {
        expect(item.stock_on_hand).toBeLessThanOrEqual(5);
      }
      expect(bi.marginRiskSkus.length).toBeLessThanOrEqual(25);
      for (const sku of bi.marginRiskSkus) {
        expect(sku.missing_cost_alert || sku.low_margin_below_20pct_alert).toBe(true);
      }
      expect(bi.apSummaryBySupplier.length).toBeGreaterThan(0);
      const totalOpenAp = bi.apSummaryBySupplier.reduce(
        (s, r) => s + r.total_balance_due_pen,
        0
      );
      expect(totalOpenAp).toBe(51457);

      // RFC-4180 escaping + UTF-8 BOM test
      const csvSample = buildCsvWithBom(
        ["sku", "description"],
        [{ sku: 'A"1', description: 'Perno, 1/2"\nLínea 2' }]
      );
      expect(csvSample.startsWith("\uFEFF")).toBe(true);
      expect(csvSample).toBe(
        '\uFEFFsku,description\r\n"A""1","Perno, 1/2""\nLínea 2"\r\n'
      );

      for (const ds of REPORT_CSV_DATASETS) {
        const { headers, rows } = await getReportDatasetRows(client, ds);
        expect(headers.length).toBeGreaterThan(4);
        expect(rows.length).toBeGreaterThan(0);
        const csv = buildCsvWithBom(headers, rows);
        expect(csv.charCodeAt(0)).toBe(0xfeff);
        expect(csv.startsWith(`\uFEFF${headers.join(",")}\r\n`)).toBe(true);
      }
    } finally {
      client.release();
    }
  });

  it("supports USD exchange rates, IGV INCLUDED/EXCLUDED math, weighted-average SKU cost, CSV formula protection, and AP <=0.05 residual filtering", async () => {
    // 1. CSV formula injection sanitization while preserving numeric negative values
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("+1+2")).toBe("'+1+2");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@cmd|calc")).toBe("'@cmd|calc");
    expect(escapeCsvCell("\t=1")).toBe("'\t=1");
    expect(escapeCsvCell("  =cmd")).toBe("'  =cmd");
    expect(escapeCsvCell(-12.5)).toBe("-12.5");
    expect(escapeCsvCell("-12.50")).toBe("-12.50");

    const client = await getPool("dev").connect();
    try {
      await client.query("BEGIN");

      const whRes = await client.query(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);

      const { supplier } = await createSupplier(client, partnerActor, {
        legalName: "IMPORTADORA FX IGV TEST SAC",
        docType: "RUC",
        docNumber: "20777666555",
      });

      const prodRes = await client.query(
        `INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, min_sale_price_pen, ref_cost_pen)
         VALUES ('TEST-FX-IGV-01', 'VALVULA IMPORTADA USD TEST', 'UND', 'STOCKED', 150, 120, 40)
         RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      // Existing MAIN warehouse stock: 4 units @ 40 PEN (total = 160 PEN)
      await client.query(
        `INSERT INTO erp.inventory_movements (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, notes)
         VALUES ($1, $2, NOW(), 'ADJUSTMENT', 4, 40, 'SEED_FX_TEST_STOCK')`,
        [warehouseId, productId]
      );

      // Purchase A: USD, IGV EXCLUDED (+18%) -> 2 units * 10 USD = 20 USD * 3.75 = 75.00 PEN subtotal + 13.50 PEN IGV = 88.50 PEN total
      // Unit cost in PEN (cost basis uses taxable/effective cost stored on line/avg): let's check both invoice totals and weighted ref_cost_pen
      const purchaseExcl = await registerSupplierPurchase(client, partnerActor, {
        supplierPartyId: supplier.party_id,
        docType: "FACTURA",
        docSeries: "F002",
        docNumber: "100201",
        paymentCondition: "CREDIT",
        currency: "USD",
        exchangeRate: 3.75,
        taxMode: "EXCLUDED",
        items: [{ productId, quantity: 2, unitCostPen: 10 }],
      });

      expect(purchaseExcl.origCurrency).toBe("USD");
      expect(purchaseExcl.exchangeRate).toBe(3.75);
      expect(purchaseExcl.taxMode).toBe("EXCLUDED");
      expect(purchaseExcl.subtotalPen).toBeCloseTo(75, 2);
      expect(purchaseExcl.igvPen).toBeCloseTo(13.5, 2);
      expect(purchaseExcl.totalPen).toBeCloseTo(88.5, 2);
      expect(purchaseExcl.origTotal).toBeCloseTo(23.6, 2);

      const invExclRes = await client.query(
        `SELECT orig_currency, exchange_rate, orig_total, subtotal_pen, igv_pen, total_pen
         FROM erp.purchase_invoices
         WHERE purchase_id = $1`,
        [purchaseExcl.purchaseId]
      );
      expect(invExclRes.rows[0].orig_currency).toBe("USD");
      expect(Number(invExclRes.rows[0].exchange_rate)).toBe(3.75);
      expect(Number(invExclRes.rows[0].subtotal_pen)).toBeCloseTo(75, 2);
      expect(Number(invExclRes.rows[0].igv_pen)).toBeCloseTo(13.5, 2);
      expect(Number(invExclRes.rows[0].total_pen)).toBeCloseTo(88.5, 2);
      expect(Number(invExclRes.rows[0].orig_total)).toBeCloseTo(23.6, 2);

      // After Purchase A: 4 units @ 40 + 2 units @ effective PEN cost -> check weighted ref_cost_pen
      const prodAfterExclRes = await client.query(
        `SELECT ref_cost_pen, cost_source FROM erp.products WHERE product_id = $1`,
        [productId]
      );
      const movExclRes = await client.query(
        `SELECT unit_cost_pen FROM erp.inventory_movements
         WHERE product_id = $1 AND reference_table = 'erp.purchase_invoices' AND reference_id = $2`,
        [productId, String(purchaseExcl.purchaseId)]
      );
      const unitCostExcl = Number(movExclRes.rows[0].unit_cost_pen);
      expect(unitCostExcl).toBeGreaterThan(37);
      const expectedAvgExcl = Number(((4 * 40 + 2 * unitCostExcl) / 6).toFixed(4));
      expect(Number(prodAfterExclRes.rows[0].ref_cost_pen)).toBeCloseTo(
        expectedAvgExcl,
        3
      );
      expect(prodAfterExclRes.rows[0].cost_source).toBe("PURCHASE_APP");

      // Purchase B: USD, IGV INCLUDED -> 4 units * 11.80 USD = 47.20 USD * 3.75 = 177.00 PEN total => 150.00 subtotal + 27.00 IGV
      const purchaseIncl = await registerSupplierPurchase(client, partnerActor, {
        supplierPartyId: supplier.party_id,
        docType: "FACTURA",
        docSeries: "F002",
        docNumber: "100202",
        paymentCondition: "CREDIT",
        currency: "USD",
        exchangeRate: 3.75,
        taxMode: "INCLUDED",
        items: [{ productId, quantity: 4, unitCostPen: 11.8 }],
      });
      expect(purchaseIncl.totalPen).toBeCloseTo(177, 2);
      expect(purchaseIncl.subtotalPen).toBeCloseTo(150, 2);
      expect(purchaseIncl.igvPen).toBeCloseTo(27, 2);
      expect(purchaseIncl.origTotal).toBeCloseTo(47.2, 2);

      // 2. apSummaryBySupplier must ignore residual balances <= 0.05 PEN in open_docs_count / total_balance_due_pen
      const { supplier: residualSupplier } = await createSupplier(
        client,
        partnerActor,
        {
          legalName: "PROVEEDOR RESIDUO 004 SAC",
          docType: "NONE",
        }
      );
      await client.query(
        `INSERT INTO erp.ap_obligations (
           supplier_party_id, doc_ref, obligation_type, issue_date,
           original_amount_pen, paid_amount_pen, status, source_origin
         ) VALUES ($1, 'RES-004', 'SUPPLIER_INVOICE', CURRENT_DATE, 100.00, 99.96, 'PARTIAL', 'ERP_APP')`,
        [residualSupplier.party_id]
      );

      const biAfter = await getBiSummary(client);
      const residualRow = biAfter.apSummaryBySupplier.find(
        (row) => row.supplier_party_id === residualSupplier.party_id
      );
      expect(residualRow).toBeDefined();
      expect(residualRow!.open_docs_count).toBe(0);
      expect(residualRow!.total_balance_due_pen).toBe(0);

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("loads all 6 Tier-1 report sections and applies CSV/SQL filters consistently on Neon dev", async () => {
    const client = await getPool("dev").connect();
    try {
      expect(REPORT_CSV_DATASETS).toHaveLength(7);
      expect(REPORT_SECTIONS).toHaveLength(6);

      const augOrders = await getReportDatasetRows(client, "ventas_pedidos", {
        from: "2026-08-01",
        to: "2026-08-31",
      });
      expect(augOrders.rows.length).toBeGreaterThan(0);
      for (const r of augOrders.rows) {
        expect(String(r.order_date)).toMatch(/^2026-08-/);
      }

      const resumen = await getReportSectionData(client, "resumen", {});
      expect(resumen.pnlMonthly.length).toBeGreaterThanOrEqual(4);
      expect(resumen.totals.salesTotalPen).toBeGreaterThan(0);
      expect(resumen.filterOptions.months.length).toBeGreaterThanOrEqual(4);
      expect(resumen.dataCut.lastOrderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof resumen.dataCut.bankReconciled).toBe("boolean");

      const resumenFiltered = await getReportSectionData(client, "resumen", {
        from: "2026-08-01",
        to: "2026-08-31",
        zone: "MADRE DE DIOS / LABERINTO / PUERTO",
        sellerId: "UNASSIGNED",
      });
      expect(resumenFiltered.totals.orderCount).toBeGreaterThan(0);

      const cajaCxp = await getReportSectionData(client, "caja_cxp", {});
      expect(cajaCxp.liquiditySummary.totalOpenApPen).toBe(51457);
      expect(cajaCxp.apMaturityBuckets).toHaveLength(6);
      const bucketApSum = cajaCxp.apMaturityBuckets.reduce(
        (s, b) => s + b.balanceDuePen,
        0
      );
      expect(Number(bucketApSum.toFixed(2))).toBe(51457);

      const cartera = await getReportSectionData(client, "cartera", {});
      expect(cartera.summary.totalReceivablePen).toBe(45745);
      expect(cartera.agingBuckets).toHaveLength(4);
      const bucketArSum = cartera.agingBuckets.reduce((s, b) => s + b.balanceDuePen, 0);
      expect(Number(bucketArSum.toFixed(2))).toBe(45745);
      expect(cartera.collectionSheet.length).toBe(13);

      const comercial = await getReportSectionData(client, "comercial", {});
      expect(comercial.routeProfitability.length).toBeGreaterThanOrEqual(47);
      expect(comercial.byZone.length).toBeGreaterThan(0);
      expect(comercial.bySeller.length).toBeGreaterThan(0);

      const stock = await getReportSectionData(client, "stock", {});
      expect(stock.valuationSummary.totalValuationPen).toBeGreaterThan(0);
      expect(stock.fulfillmentMix.length).toBeGreaterThanOrEqual(1);

      const auditoria = await getReportSectionData(client, "auditoria", {});
      expect(auditoria.closingReadiness.checks).toHaveLength(7);
      expect(auditoria.operationalQuality.registrationCoverage24h).toBeDefined();
      expect(auditoria.operationalQuality.startupChecklist).toHaveLength(6);

      expect(() =>
        parseReportFilters(new URLSearchParams("from=2026-09-30&to=2026-06-01"))
      ).toThrow(ValidationError);
      expect(() => parseReportFilters(new URLSearchParams("from=2026-02-31"))).toThrow(
        ValidationError
      );
    } finally {
      client.release();
    }
  });
});
