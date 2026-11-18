import { describe, expect, it } from "vitest";
import { projectOrderForRole, projectProductForRole } from "../src/lib/rbac";
import {
  signTestSessionToken,
  verifyTestSessionToken,
} from "../src/lib/auth/test-session";
import { shouldDestroyClientOnError } from "../src/lib/db";
import {
  formatAuditFlagCodeEs,
  formatAuditFlagStatusEs,
  formatEntityTableEs,
  formatExpenseCategoryEs,
  formatOperationalStatusEs,
  formatQuoteStatusEs,
  formatRouteTripStatusEs,
} from "../src/lib/labels-es";
import { OUTFLOW_CATEGORIES_BY_BUCKET } from "../src/lib/treasury-constants";
import { AuthorizationError, ValidationError } from "../src/lib/types";

describe("RBAC Financial Isolation & Session Signing", () => {
  const sampleProduct = {
    product_id: 1,
    sku: "CARPET VERDEX2MT",
    name: "ALFOMBRA LLANA VERDE X 2MT",
    unit_of_measure: "UND",
    fulfillment_mode: "STOCKED" as const,
    stock_on_hand: 12,
    list_sale_price_pen: 70,
    min_sale_price_pen: 68,
    ref_cost_pen: 63.31,
  };

  const sampleOrder = {
    order_id: 10,
    order_code: "SO-2026-11-14-001",
    order_date: "2026-11-14",
    customer_name: "FERRETERIA EL SOL",
    operational_status: "REGISTERED" as const,
    payment_mode: "CREDIT" as const,
    promised_payment_date: "2026-11-24",
    total_pen: 700,
    paid_pen: 200,
    balance_due_pen: 500,
    created_by_name: "Vendedor 1",
    picked_by_name: null,
    delivered_by_name: null,
    lines: [
      {
        order_line_id: 100,
        line_no: 1,
        sku: "CARPET VERDEX2MT",
        raw_description: "ALFOMBRA LLANA VERDE X 2MT",
        unit_of_measure: "MTR",
        quantity: 10,
        base_unit_price_pen: 70,
        unit_discount_pen: 0,
        unit_price_pen: 70,
        line_total_pen: 700,
        unit_cost_snapshot_pen: 63.31,
        fulfillment_mode: "STOCKED" as const,
        fulfillment_status: "FULFILLED" as const,
      },
    ],
  };

  it("strips all money fields from WAREHOUSE_DELIVERY payloads", () => {
    const whProd = projectProductForRole(sampleProduct, "WAREHOUSE_DELIVERY");
    expect(whProd).not.toHaveProperty("list_sale_price_pen");
    expect(whProd).not.toHaveProperty("min_sale_price_pen");
    expect(whProd).not.toHaveProperty("ref_cost_pen");

    const whOrder = projectOrderForRole(sampleOrder, "WAREHOUSE_DELIVERY");
    expect(whOrder).not.toHaveProperty("total_pen");
    expect(whOrder).not.toHaveProperty("paid_pen");
    expect(whOrder).not.toHaveProperty("balance_due_pen");
    expect(whOrder).not.toHaveProperty("payment_mode");
    expect(whOrder).not.toHaveProperty("promised_payment_date");
    const whLine = (whOrder.lines as Record<string, unknown>[])[0];
    expect(whLine).not.toHaveProperty("unit_price_pen");
    expect(whLine).not.toHaveProperty("unit_discount_pen");
    expect(whLine).not.toHaveProperty("line_total_pen");
    expect(whLine).not.toHaveProperty("unit_cost_snapshot_pen");
    expect(whLine.quantity).toBe(10);
    expect(whLine.unit_of_measure).toBe("MTR");
  });

  it("strips cost and margin fields from EXTERNAL_SELLER while keeping prices and min floor", () => {
    const sellerProd = projectProductForRole(sampleProduct, "EXTERNAL_SELLER");
    expect(sellerProd.list_sale_price_pen).toBe(70);
    expect(sellerProd.min_sale_price_pen).toBe(68);
    expect(sellerProd).not.toHaveProperty("ref_cost_pen");

    const sellerOrder = projectOrderForRole(sampleOrder, "EXTERNAL_SELLER");
    expect(sellerOrder.total_pen).toBe(700);
    expect(sellerOrder.balance_due_pen).toBe(500);
    expect(sellerOrder.promised_payment_date).toBe("2026-11-24");
    const sellerLine = (sellerOrder.lines as Record<string, unknown>[])[0];
    expect(sellerLine.unit_price_pen).toBe(70);
    expect(sellerLine.unit_of_measure).toBe("MTR");
    expect(sellerLine).not.toHaveProperty("unit_cost_snapshot_pen");
    expect(sellerLine).not.toHaveProperty("line_margin_pen");
  });

  it("includes cost and computed real margin for PARTNER_ADMIN and PARTNER_MANAGER", () => {
    const partnerOrder = projectOrderForRole(sampleOrder, "PARTNER_ADMIN");
    const partnerLine = (partnerOrder.lines as Record<string, unknown>[])[0];
    expect(partnerLine.unit_of_measure).toBe("MTR");
    expect(partnerLine.unit_cost_snapshot_pen).toBe(63.31);
    expect(partnerLine.line_margin_pen).toBeCloseTo(66.9, 2);
  });

  it("signs and verifies session tokens tamper-proof", () => {
    const token = signTestSessionToken({
      userId: 1,
      username: "socio_admin",
      fullName: "Socio Operativo",
      role: "PARTNER_ADMIN",
      defaultCashAccountId: 1,
    });
    expect(verifyTestSessionToken(token)?.role).toBe("PARTNER_ADMIN");
    expect(verifyTestSessionToken(token + "tampered")).toBeNull();
  });

  it("maps operational, trip, quote, audit-flag, entity, and treasury labels cleanly to Spanish", () => {
    expect(formatOperationalStatusEs("IN_ROUTE")).toBe("En Ruta");
    expect(formatOperationalStatusEs("READY")).toBe("Pedido listo");
    expect(formatRouteTripStatusEs("OPEN")).toBe("En Ruta");
    expect(formatRouteTripStatusEs("CLOSED")).toBe("Cerrada");
    expect(formatRouteTripStatusEs("RECONCILED")).toBe("Cerrada");
    expect(formatQuoteStatusEs("OPEN")).toBe("Abierta");
    expect(formatQuoteStatusEs("CONVERTED")).toBe("Convertida");
    expect(formatQuoteStatusEs("EXPIRED")).toBe("Vencida");
    expect(formatQuoteStatusEs("CANCELLED")).toBe("Anulada");
    expect(formatAuditFlagStatusEs("OPEN")).toBe("Abierta");
    expect(formatAuditFlagStatusEs("ACKNOWLEDGED")).toBe("En Revisión");
    expect(formatAuditFlagStatusEs("RESOLVED")).toBe("Resuelta");
    expect(formatAuditFlagCodeEs("EXEL_QTY_PRICE_SWAPPED_CORRECTED")).toBe(
      "Corrección de columnas invertidas en ruta"
    );
    expect(formatEntityTableEs("erp.sales_orders")).toBe("Pedido");

    for (const options of Object.values(OUTFLOW_CATEGORIES_BY_BUCKET)) {
      for (const opt of options) {
        const mapped = formatExpenseCategoryEs(opt.value);
        expect(mapped).toBeTruthy();
        expect(mapped).not.toContain("_");
        expect(mapped).not.toBe(opt.value);
      }
    }
    expect(formatExpenseCategoryEs("PAGO_CXP")).toBe("Pago a Proveedor (CxP)");
    expect(formatExpenseCategoryEs("FLETE_MERCADERIA")).toBe("Flete de Mercadería");
    expect(formatExpenseCategoryEs("ESTACIONAMIENTO")).toBe(
      "Estacionamiento / Cochera"
    );
    expect(formatExpenseCategoryEs("GASTO_RUTA")).toBe("Gasto General de Ruta");
    expect(formatExpenseCategoryEs("RETIRO")).toBe("Retiro de Socio");
    expect(formatExpenseCategoryEs("LEGAL_NOTARIA")).toBe("Notaría / Trámite Legal");
    expect(formatExpenseCategoryEs("OTRO_NO_OPERATIVO")).toBe(
      "Otro Egreso No Operativo"
    );
    expect(formatExpenseCategoryEs("MERCADERIA")).toBe("Compra de Mercadería");
  });

  it("only destroys pooled DB clients on connection/shutdown errors, never on domain errors", () => {
    expect(shouldDestroyClientOnError(new ValidationError("Cantidad inválida"))).toBe(
      false
    );
    expect(shouldDestroyClientOnError(new AuthorizationError("Sin permiso"))).toBe(
      false
    );
    expect(
      shouldDestroyClientOnError(
        Object.assign(new Error("duplicate"), { code: "23505" })
      )
    ).toBe(false);
    expect(
      shouldDestroyClientOnError(
        Object.assign(new Error("conn lost"), { code: "08006" })
      )
    ).toBe(true);
    expect(
      shouldDestroyClientOnError(
        Object.assign(new Error("admin shutdown"), { code: "57P01" })
      )
    ).toBe(true);
    expect(
      shouldDestroyClientOnError(
        Object.assign(new Error("socket reset"), { code: "ECONNRESET" })
      )
    ).toBe(true);
    expect(
      shouldDestroyClientOnError(new Error("Connection terminated unexpectedly"))
    ).toBe(true);
  });
});
