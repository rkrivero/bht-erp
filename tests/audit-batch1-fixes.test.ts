import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { saveDailyClosure } from "../src/lib/services/daily-closure";
import { listQuotes } from "../src/lib/services/operations-and-modules";
import { createOrder, updateOrder } from "../src/lib/services/orders";
import {
  payApObligation,
  registerSupplierPurchase,
} from "../src/lib/services/purchases-and-suppliers";
import { getReportSectionData } from "../src/lib/services/report-sections";
import { invalidateSystemSettingsCache } from "../src/lib/services/settings";
import { executeUndoAction } from "../src/lib/services/undo";
import { ValidationError, type SessionUser } from "../src/lib/types";

const sellerActor: SessionUser = {
  userId: 3,
  username: "vendedor1",
  fullName: "Vendedor Externo",
  role: "EXTERNAL_SELLER",
  defaultCashAccountId: 1,
};

const partnerActor: SessionUser = {
  userId: 1,
  username: "socio_admin",
  fullName: "Socio Admin",
  role: "PARTNER_ADMIN",
  defaultCashAccountId: 1,
};

function makeMockClient(
  handler: (sql: string, params?: unknown[]) => {
    rows?: Record<string, unknown>[];
    rowCount?: number;
  }
) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const res = handler(sql, params);
    const rows = res.rows ?? [];
    return {
      rows,
      rowCount: res.rowCount ?? rows.length,
    };
  });
  return {
    client: { query } as unknown as PoolClient,
    calls,
  };
}

describe("Audit Batch 1 fixes (#1-#9)", () => {
  beforeEach(() => {
    invalidateSystemSettingsCache();
  });

  it("#1 listQuotes scopes rows to seller when actor is EXTERNAL_SELLER", async () => {
    const { client, calls } = makeMockClient(() => ({ rows: [] }));
    await listQuotes(client, sellerActor, 50);
    expect(calls[0].sql).toContain("q.created_by_user_id = $2");
    expect(calls[0].params).toEqual([50, sellerActor.userId, sellerActor.fullName]);

    const { client: partnerClient, calls: partnerCalls } = makeMockClient(() => ({
      rows: [],
    }));
    await listQuotes(partnerClient, partnerActor, 50);
    expect(partnerCalls[0].sql).not.toContain("q.created_by_user_id = $2");
    expect(partnerCalls[0].params).toEqual([50]);
  });

  it("#2 executeUndoAction blocks non-admin undo when order already has payments", async () => {
    const createUndoClient = makeMockClient((sql) => {
      if (sql.includes("FROM erp.undoable_actions")) {
        return {
          rows: [
            {
              undo_id: "10",
              action_type: "ORDER_CREATE",
              entity_table: "erp.sales_orders",
              entity_id: "55",
              entity_code: "PED-55",
              summary: "Pedido",
              actor_user_id: String(sellerActor.userId),
              undo_payload: { orderId: 55, operationalStatus: "REGISTERED" },
              undone_at: null,
              is_expired: false,
            },
          ],
        };
      }
      if (sql.includes("FROM erp.sales_orders")) {
        return { rows: [{ status: "REGISTERED", paid_pen: 50 }] };
      }
      return { rows: [] };
    });

    await expect(
      executeUndoAction(createUndoClient.client, sellerActor, { undoId: 10 })
    ).rejects.toThrow(/cobros registrados/i);

    const convertUndoClient = makeMockClient((sql) => {
      if (sql.includes("FROM erp.undoable_actions")) {
        return {
          rows: [
            {
              undo_id: "11",
              action_type: "QUOTE_CONVERT_TO_ORDER",
              entity_table: "erp.quotes",
              entity_id: "7",
              entity_code: "COT-7",
              summary: "Cotización",
              actor_user_id: String(sellerActor.userId),
              undo_payload: { quoteId: 7, orderId: 56 },
              undone_at: null,
              is_expired: false,
            },
          ],
        };
      }
      if (sql.includes("FROM erp.quotes")) {
        return { rows: [{ quote_id: 7, quote_code: "COT-7", status: "CONVERTED" }] };
      }
      if (sql.includes("FROM erp.sales_orders")) {
        return { rows: [{ status: "REGISTERED", quote_id: "7", paid_pen: 25 }] };
      }
      return { rows: [] };
    });

    await expect(
      executeUndoAction(convertUndoClient.client, sellerActor, { undoId: 11 })
    ).rejects.toThrow(/cobros registrados/i);
  });

  it("#3 queryCartera emits single-row dso_anchor without FROM sales_orders when to filter is set", async () => {
    const { client, calls } = makeMockClient(() => ({
      rows: [
        {
          filter_options: { zones: [], sellers: [] },
          data_cut: { as_of_lima_date: "2026-11-23" },
          summary_stats: {},
          aging_buckets: [],
          by_zone: [],
          by_customer: [],
          collection_sheet: [],
          dso_ref: {
            ref_sales_pen: 100,
            ref_days: 90,
            win_start: "2026-08-26",
            win_end: "2026-11-23",
          },
        },
      ],
    }));

    await getReportSectionData(client, "cartera", { to: "2026-11-23" });
    const sql = calls[0].sql;
    const anchorBlock = sql.slice(
      sql.indexOf("dso_anchor AS ("),
      sql.indexOf("dso_window AS (")
    );
    expect(anchorBlock).toMatch(/SELECT \$\d+::date AS win_end/);
    expect(anchorBlock).not.toContain("FROM erp.sales_orders");
  });

  it("#4 registerSupplierPurchase ignores exchangeRate when currency is PEN", async () => {
    const { client, calls } = makeMockClient((sql) => {
      if (sql.includes("FROM erp.parties")) {
        return { rows: [{ party_id: 9, display_name: "PROVEEDOR" }] };
      }
      if (sql.includes("FROM erp.warehouses")) {
        return { rows: [{ warehouse_id: 1 }] };
      }
      if (sql.includes("FROM erp.products")) {
        return {
          rows: [
            {
              product_id: 1,
              sku: "SKU-1",
              name: "Item",
              unit_of_measure: "NIU",
              fulfillment_mode: "STOCKED",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO erp.purchase_invoices")) {
        return { rows: [{ purchase_id: 101 }] };
      }
      if (sql.includes("INSERT INTO erp.ap_obligations")) {
        return { rows: [{ ap_id: 201 }] };
      }
      return { rows: [] };
    });

    const result = await registerSupplierPurchase(client, partnerActor, {
      supplierPartyId: 9,
      docType: "FACTURA",
      docSeries: "F001",
      docNumber: "0001",
      currency: "PEN",
      exchangeRate: 3.75,
      taxMode: "NONE",
      paymentCondition: "CREDIT",
      items: [{ productId: 1, quantity: 10, unitCostPen: 20 }],
    });

    expect(result.totalPen).toBe(200);
    const invInsert = calls.find((c) =>
      c.sql.includes("INSERT INTO erp.purchase_invoices")
    );
    expect(invInsert?.params).toContain(1);
    expect(invInsert?.params).not.toContain(3.75);
    expect(invInsert?.params).toContain(200);
  });

  it("#5 & #7 createOrder multiplies cost by packFactorApplied and drops initialPaidPen from exposure when approval is required", async () => {
    const { client, calls } = makeMockClient((sql) => {
      if (sql.includes("FROM erp.warehouses")) return { rows: [{ warehouse_id: 1 }] };
      if (sql.includes("FROM erp.products")) {
        return {
          rows: [
            {
              product_id: 1,
              sku: "PACK-12",
              name: "Caja x12",
              list_sale_price_pen: 150,
              min_sale_price_pen: 15,
              ref_cost_pen: 10,
              fulfillment_mode: "STOCKED",
              stock_on_hand: 100,
            },
          ],
        };
      }
      if (sql.includes("FROM erp.parties pa")) {
        return {
          rows: [
            {
              party_id: 4,
              credit_days_agreed: 7,
              credit_limit_pen: 10,
              open_ar_balance_pen: 0,
            },
          ],
        };
      }
      if (sql.includes("FROM erp.system_settings")) {
        return {
          rows: [
            {
              setting_key: "credit_limit_mode",
              value_json: "AUDIT_ONLY",
              value_type: "string",
              label_es: "Modo",
              description_es: "",
              updated_by_user_id: 1,
              updated_by_name: "Admin",
              updated_at: "2026-11-23",
            },
          ],
        };
      }
      if (sql.includes("AS code")) {
        return { rows: [{ code: "PED-77" }] };
      }
      if (sql.includes("INSERT INTO erp.sales_orders")) {
        return { rows: [{ order_id: 77 }] };
      }
      if (sql.includes("INSERT INTO erp.undoable_actions")) {
        return {
          rows: [
            {
              undo_id: "1",
              created_at: "2026-11-23T00:00:00Z",
              expires_at: "2026-11-23T00:15:00Z",
            },
          ],
        };
      }
      if (sql.includes("FROM erp.sales_order_lines")) {
        return {
          rows: [
            {
              order_line_id: 1,
              line_no: 1,
              product_id: 1,
              sku: "PACK-12",
              raw_description: "Caja x12",
              unit_of_measure: "NIU",
              quantity: 1,
              pack_factor_applied: 12,
              base_unit_price_pen: 150,
              unit_discount_pen: 135,
              unit_price_pen: 15,
              line_total_pen: 15,
              unit_cost_snapshot_pen: 10,
              fulfillment_mode: "STOCKED",
              fulfillment_status: "FULFILLED",
              below_min_price_flag: false,
            },
          ],
        };
      }
      if (sql.includes("WHERE so.order_id = $1")) {
        return {
          rows: [
            {
              order_id: 77,
              order_code: "PED-77",
              order_date: "2026-11-23",
              customer_party_id: 4,
              customer_name: "CLIENTE",
              operational_status: "PENDING_PARTNER_APPROVAL",
              payment_mode: "CREDIT",
              total_pen: 15,
              paid_pen: 0,
              balance_due_pen: 15,
              is_settled: false,
              credit_limit_exceeded_flag: true,
              created_by_name: sellerActor.fullName,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const created = await createOrder(client, sellerActor, {
      customerPartyId: 4,
      customerNameRaw: "CLIENTE",
      paymentMode: "CREDIT",
      initialPaidPen: 15,
      lines: [{ productId: 1, quantity: 1, packFactorApplied: 12, unitPricePen: 15 }],
    });

    expect(created.requiresApproval).toBe(true);
    const orderInsert = calls.find((c) => c.sql.includes("INSERT INTO erp.sales_orders"));
    expect(orderInsert?.params).toContain("PENDING_PARTNER_APPROVAL");
    expect(orderInsert?.params).toContain(true);
  });

  it("#6 updateOrder enforces credit_limit_mode STRICT_BLOCK for external sellers", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("FROM erp.sales_orders") && sql.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              order_id: 88,
              order_code: "PED-88",
              order_date: "2026-11-23",
              status: "REGISTERED",
              operational_status: "REGISTERED",
              payment_mode: "CREDIT",
              source_origin: "ERP_APP",
              created_by_user_id: sellerActor.userId,
              customer_party_id: 5,
              customer_name_raw: "CLIENTE",
              warehouse_id: 1,
              paid_pen: 0,
              global_discount_pen: 0,
              stock_deducted: false,
            },
          ],
        };
      }
      if (sql.includes("FROM erp.products p")) {
        return {
          rows: [
            {
              product_id: 1,
              sku: "SKU-1",
              name: "Item",
              list_sale_price_pen: 100,
              min_sale_price_pen: 80,
              ref_cost_pen: 50,
              fulfillment_mode: "STOCKED",
              stock_on_hand: 100,
            },
          ],
        };
      }
      if (sql.includes("FROM erp.parties pa")) {
        return {
          rows: [{ credit_limit_pen: 500, open_ar_balance_pen: 0 }],
        };
      }
      if (sql.includes("FROM erp.system_settings")) {
        return {
          rows: [
            {
              setting_key: "credit_limit_mode",
              value_json: "STRICT_BLOCK",
              value_type: "string",
              label_es: "Modo",
              description_es: "",
              updated_by_user_id: 1,
              updated_by_name: "Admin",
              updated_at: "2026-11-23",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      updateOrder(client, sellerActor, 88, {
        lines: [{ productId: 1, quantity: 6 }],
        reason: "Aumento de cantidad",
      })
    ).rejects.toThrow(/límite de crédito/i);
  });

  it("#8 saveDailyClosure locks cash_accounts before reading balances and skips last_reconciled update when unreconciled", async () => {
    const { client, calls } = makeMockClient((sql) => {
      if (sql.includes("FROM erp.daily_closures WHERE closure_date = $1::date FOR UPDATE")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT account_id") && sql.includes("FOR UPDATE")) {
        return { rows: [{ account_id: 1 }] };
      }
      if (sql.includes("AS day_summary")) {
        return {
          rows: [
            {
              existing_closure: null,
              has_ledger_activity: false,
              day_summary: {
                sales_count: 1,
                sales_total_pen: 100,
                collections_total_pen: 100,
                expenses_total_pen: 0,
                deposits_total_pen: 0,
              },
              pending_items: {
                deliveries_count: 0,
                collections_count: 0,
                ap_7d_count: 0,
                incomplete_orders_24h: 0,
              },
              accounts: [
                {
                  account_id: 1,
                  code: "CAJA_RUTA",
                  name: "Caja Ruta",
                  account_type: "CASH_BOX",
                  system_balance_pen: 100,
                  counted_balance_pen: null,
                  variance_pen: null,
                  is_reconciled: false,
                  notes: null,
                  last_reconciled_at: null,
                  last_reconciled_balance_pen: null,
                },
              ],
              recent_closures: [],
            },
          ],
        };
      }
      if (sql.includes("AS system_balance_pen")) {
        return { rows: [{ account_id: 1, code: "CAJA_RUTA", system_balance_pen: "100.00" }] };
      }
      if (sql.includes("INSERT INTO erp.daily_closures")) {
        return { rows: [{ closure_id: "1" }] };
      }
      return { rows: [] };
    });

    await saveDailyClosure(client, partnerActor, {
      closureDate: "2026-11-23",
      accounts: [{ accountId: 1, countedBalancePen: 80 }],
      applyReconciliationAdjustments: false,
    });

    const lockIdx = calls.findIndex(
      (c) => c.sql.includes("FROM erp.cash_accounts") && c.sql.includes("FOR UPDATE")
    );
    const balanceIdx = calls.findIndex((c) => c.sql.includes("AS system_balance_pen"));
    expect(lockIdx).toBeGreaterThan(-1);
    expect(balanceIdx).toBeGreaterThan(lockIdx);
    const reconciledUpdates = calls.filter((c) =>
      c.sql.includes("UPDATE erp.cash_accounts")
    );
    expect(reconciledUpdates).toHaveLength(0);
  });

  it("#9 payApObligation rejects sub-cent amounts and > balance overpayments; partial purchase rejects sub-cent", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("FROM erp.ap_obligations ap")) {
        return {
          rows: [
            {
              ap_id: 1,
              supplier_party_id: 9,
              doc_ref: "F001-1",
              original_amount_pen: 100,
              paid_amount_pen: 0,
              balance_due_pen: 100,
              status: "OPEN",
              supplier_name: "PROVEEDOR",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      payApObligation(client, partnerActor, { apId: 1, amountPen: 0.004 })
    ).rejects.toThrow(ValidationError);

    await expect(
      payApObligation(client, partnerActor, { apId: 1, amountPen: 100.05 })
    ).rejects.toThrow(/supera el saldo pendiente/i);

    await expect(
      registerSupplierPurchase(client, partnerActor, {
        supplierPartyId: 9,
        docType: "FACTURA",
        docSeries: "F001",
        docNumber: "0002",
        currency: "PEN",
        taxMode: "NONE",
        paymentCondition: "PARTIAL",
        paidNowPen: 0.004,
        items: [{ productId: 1, quantity: 1, unitCostPen: 100 }],
      })
    ).rejects.toThrow(ValidationError);

    await expect(
      registerSupplierPurchase(client, partnerActor, {
        supplierPartyId: 9,
        docType: "FACTURA",
        docSeries: "F001",
        docNumber: "0003",
        currency: "PEN",
        taxMode: "NONE",
        paymentCondition: "PARTIAL",
        paidNowPen: 99.999,
        items: [{ productId: 1, quantity: 1, unitCostPen: 100 }],
      })
    ).rejects.toThrow(ValidationError);
  });
});
