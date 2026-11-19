import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signTestSessionToken } from "../src/lib/auth/test-session";
import * as dbMod from "../src/lib/db";
import {
  GET as getDailyClosures,
  POST as postDailyClosures,
} from "../src/app/api/daily-closures/route";
import {
  POST as postCustomers,
  PATCH as patchCustomers,
} from "../src/app/api/customers/route";
import { POST as postPartners } from "../src/app/api/partners/route";
import { POST as postTreasury } from "../src/app/api/treasury/route";
import { listDebtors } from "../src/lib/services/collections-and-treasury";
import {
  createOrder,
  getLimaDateString,
  listCatalogForRole,
} from "../src/lib/services/orders";
import { getReportSectionData } from "../src/lib/services/report-sections";
import type { SessionUser } from "../src/lib/types";

beforeAll(() => {
  process.env.BHT_DB_BRANCH = "dev";
});

const partnerActor: SessionUser = {
  userId: 1,
  username: "socio_admin",
  fullName: "Socio Operativo y Admin",
  role: "PARTNER_ADMIN",
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

const partnerToken = signTestSessionToken(partnerActor);
const sellerToken = signTestSessionToken(sellerActor);
const whToken = signTestSessionToken(warehouseActor);

describe("Bloque B: Financial Truth, Due Dates, Daily Close & Master Data", () => {
  it("enforces cross-month payment dates, ADMIN_OPEX, due_date vs invoice_age_days, daily closures, and master-data RBAC", async () => {
    const pool = dbMod.getPool("dev");
    const client = await pool.connect();
    let spCounter = 0;

    const spyClient = vi
      .spyOn(dbMod, "withClient")
      .mockImplementation(async (fn) => await fn(client));
    const spyTx = vi.spyOn(dbMod, "withTransaction").mockImplementation(async (fn) => {
      const sp = `sp_bloque_b_${++spCounter}`;
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

      const whRes = await client.query<{ warehouse_id: number }>(
        `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
      );
      const warehouseId = Number(whRes.rows[0].warehouse_id);

      const prodRes = await client.query<{ product_id: number }>(
        `INSERT INTO erp.products (
           sku, name, unit_of_measure, fulfillment_mode,
           list_sale_price_pen, min_sale_price_pen, ref_cost_pen
         ) VALUES (
           'TEST-BLOQUE-B-01', 'PRODUCTO BLOQUE B TEST', 'NIU', 'STOCKED',
           100, 90, 40
         ) RETURNING product_id`
      );
      const productId = Number(prodRes.rows[0].product_id);

      await client.query(
        `INSERT INTO erp.inventory_movements (
           warehouse_id, product_id, movement_date, movement_type,
           quantity_delta, unit_cost_pen, notes
         ) VALUES ($1, $2, NOW(), 'ADJUSTMENT', 100, 40, 'SEED_BLOQUE_B')`,
        [warehouseId, productId]
      );

      // 5. Master Data: Customer credit_days_agreed, credit_limit_pen, last_contact_date + RBAC
      const createCustRes = await postCustomers(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tradeName: "Ferreteria Bloque B",
            legalName: "Ferreteria Bloque B SAC",
            cityZone: "PUERTO MALDONADO",
            creditDaysAgreed: 21,
            creditLimitPen: 3500,
            lastContactDate: "2026-08-20",
          }),
        })
      );
      expect(createCustRes.status).toBe(201);
      const createdCust = (await createCustRes.json()).customer;
      const customerPartyId = Number(createdCust.party_id);
      expect(createdCust.credit_days_agreed).toBe(21);
      expect(createdCust.credit_limit_pen).toBe(3500);
      expect(createdCust.last_contact_date).toBe("2026-08-20");

      // EXTERNAL_SELLER cannot edit creditDaysAgreed
      const sellerCreditRes = await patchCustomers(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${sellerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partyId: customerPartyId,
            creditDaysAgreed: 30,
          }),
        })
      );
      expect(sellerCreditRes.status).toBe(403);

      // EXTERNAL_SELLER can update lastContactDate
      const sellerContactRes = await patchCustomers(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${sellerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partyId: customerPartyId,
            lastContactDate: "2026-08-21",
          }),
        })
      );
      expect(sellerContactRes.status).toBe(200);
      expect((await sellerContactRes.json()).customer.last_contact_date).toBe(
        "2026-08-21"
      );

      // WAREHOUSE_DELIVERY is blocked from editing customers
      const whCustRes = await patchCustomers(
        new NextRequest("http://localhost:3000/api/customers", {
          method: "PATCH",
          headers: {
            cookie: `bht_session=${whToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partyId: customerPartyId,
            lastContactDate: "2026-08-22",
          }),
        })
      );
      expect(whCustRes.status).toBe(403);

      // Creating a CREDIT order without explicit promisedPaymentDate defaults from credit_days_agreed (21d)
      const defaultCreditOrder = await createOrder(client, sellerActor, {
        customerPartyId,
        customerNameRaw: "FERRETERIA BLOQUE B",
        paymentMode: "CREDIT",
        lines: [{ productId, quantity: 2 }],
      });
      const defaultOrderRow = await client.query<{
        due_date: string | null;
        promised_payment_date: string | null;
      }>(
        `SELECT due_date::text AS due_date, promised_payment_date::text AS promised_payment_date
         FROM erp.sales_orders WHERE order_id = $1`,
        [defaultCreditOrder.orderId]
      );
      expect(defaultOrderRow.rows[0].promised_payment_date).toBe(getLimaDateString(21));
      expect(defaultOrderRow.rows[0].due_date).toBe(getLimaDateString(21));

      // Product master data + cost_updated_at + RBAC hiding
      const updProdRes = await postPartners(
        new NextRequest("http://localhost:3000/api/partners", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update_product",
            productId,
            refCostPen: 45,
            minStockQty: 12,
            leadTimeDays: 5,
          }),
        })
      );
      expect(updProdRes.status).toBe(200);

      const partnerCat = await listCatalogForRole(client, partnerActor);
      const partnerItem = partnerCat.find(
        (item) => Number(item.product_id) === productId
      )!;
      expect(partnerItem.ref_cost_pen).toBe(45);
      expect(partnerItem.min_stock_qty).toBe(12);
      expect(partnerItem.lead_time_days).toBe(5);
      expect(partnerItem.cost_updated_at).toBeTruthy();

      for (const restrictedActor of [sellerActor, warehouseActor]) {
        const restrictedCat = await listCatalogForRole(client, restrictedActor);
        const restrictedItem = restrictedCat.find(
          (item) => Number(item.product_id) === productId
        )!;
        expect("ref_cost_pen" in restrictedItem).toBe(false);
        expect("cost_updated_at" in restrictedItem).toBe(false);
        expect("default_supplier_party_id" in restrictedItem).toBe(false);
        expect("lead_time_days" in restrictedItem).toBe(false);
        expect("min_stock_qty" in restrictedItem).toBe(false);
      }

      // 1. Cross-month effective payment date in resumen (Order in 2027-03, payment in 2027-04)
      const crossMonthOrder = await createOrder(client, partnerActor, {
        customerPartyId,
        customerNameRaw: "FERRETERIA BLOQUE B",
        paymentMode: "CREDIT",
        promisedPaymentDate: "2027-04-05",
        initialPaidPen: 0,
        lines: [{ productId, quantity: 5 }],
      });
      await client.query(
        `UPDATE erp.sales_orders
         SET order_date = DATE '2027-03-10'
         WHERE order_id = $1`,
        [crossMonthOrder.orderId]
      );
      await client.query(
        `INSERT INTO erp.ar_payments (
           order_id, payment_date, amount_pen, payment_mode,
           account_id, collected_by_user_id, source_origin, notes
         ) VALUES (
           $1, DATE '2027-04-05', 500, 'TRANSFER',
           1, 1, 'ERP_APP', 'Pago mes siguiente Bloque B'
         )`,
        [crossMonthOrder.orderId]
      );

      // 2. ADMIN_OPEX (SUELDO_SOCIO) in 2027-03 + RBAC
      const sellerAdminOpexRes = await postTreasury(
        new NextRequest("http://localhost:3000/api/treasury", {
          method: "POST",
          headers: {
            cookie: `bht_session=${sellerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amountPen: 250,
            expenseBucket: "ADMIN_OPEX",
            expenseCategory: "SUELDO_SOCIO",
            txDate: "2027-03-15",
            description: "Intento bloqueado",
          }),
        })
      );
      expect(sellerAdminOpexRes.status).toBe(403);

      const partnerSalaryRes = await postTreasury(
        new NextRequest("http://localhost:3000/api/treasury", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amountPen: 1500,
            expenseBucket: "ADMIN_OPEX",
            expenseCategory: "SUELDO_SOCIO",
            txDate: "2027-03-15",
            description: "Sueldo socio prueba marzo 2027",
          }),
        })
      );
      expect(partnerSalaryRes.status).toBe(200);

      const resumenAll = await getReportSectionData(client, "resumen", {});
      const marRow = resumenAll.pnlMonthly.find((m) => m.period_month === "2027-03-01");
      const aprRow = resumenAll.pnlMonthly.find((m) => m.period_month === "2027-04-01");
      expect(marRow).toBeDefined();
      expect(aprRow).toBeDefined();
      expect(marRow!.sales_total_pen).toBe(500);
      expect(marRow!.cash_collected_pen).toBe(0);
      expect(marRow!.admin_opex_pen).toBe(1500);
      expect(marRow!.owner_salary_recorded_pen).toBe(1500);
      expect(marRow!.operating_result_pen).toBe(
        Number((marRow!.operating_ebitda_pen - 1500).toFixed(2))
      );
      expect(aprRow!.sales_total_pen).toBe(0);
      expect(aprRow!.cash_collected_pen).toBe(500);

      const resumenMar = await getReportSectionData(client, "resumen", {
        from: "2027-03-01",
        to: "2027-03-31",
      });
      expect(resumenMar.totals.salesTotalPen).toBe(500);
      expect(resumenMar.totals.cashCollectedPen).toBe(0);
      expect(resumenMar.totals.adminOpexPen).toBe(1500);
      expect(resumenMar.totals.ownerSalaryRecordedPen).toBe(1500);

      const resumenApr = await getReportSectionData(client, "resumen", {
        from: "2027-04-01",
        to: "2027-04-30",
      });
      expect(resumenApr.totals.salesTotalPen).toBe(0);
      expect(resumenApr.totals.cashCollectedPen).toBe(500);

      // 3. Invoice age vs explicit due_date in listDebtors & cartera
      const currentOrder = await createOrder(client, partnerActor, {
        customerPartyId,
        customerNameRaw: "FERRETERIA BLOQUE B",
        paymentMode: "CREDIT",
        promisedPaymentDate: getLimaDateString(15),
        lines: [{ productId, quantity: 3 }],
      });
      await client.query(
        `UPDATE erp.sales_orders
         SET order_date = $2::date,
             due_date = $3::date,
             promised_payment_date = $3::date
         WHERE order_id = $1`,
        [currentOrder.orderId, getLimaDateString(-5), getLimaDateString(15)]
      );

      const overdueOrder = await createOrder(client, partnerActor, {
        customerPartyId,
        customerNameRaw: "FERRETERIA BLOQUE B",
        paymentMode: "CREDIT",
        promisedPaymentDate: getLimaDateString(-4),
        lines: [{ productId, quantity: 1 }],
      });
      await client.query(
        `UPDATE erp.sales_orders
         SET order_date = $2::date,
             due_date = $3::date,
             promised_payment_date = $3::date
         WHERE order_id = $1`,
        [overdueOrder.orderId, getLimaDateString(-20), getLimaDateString(-4)]
      );

      const debtors = await listDebtors(client, partnerActor);
      const currentDebtItem = debtors.byOrder.find(
        (d) => d.orderId === currentOrder.orderId
      )!;
      const overdueDebtItem = debtors.byOrder.find(
        (d) => d.orderId === overdueOrder.orderId
      )!;
      expect(currentDebtItem.invoiceAgeDays).toBe(5);
      expect(currentDebtItem.daysPastDue).toBe(0);
      expect(currentDebtItem.dueStatus).toBe("CURRENT");

      expect(overdueDebtItem.invoiceAgeDays).toBe(20);
      expect(overdueDebtItem.daysPastDue).toBe(4);
      expect(overdueDebtItem.dueStatus).toBe("OVERDUE");

      const cartera = await getReportSectionData(client, "cartera", {});
      const carteraCurrent = cartera.collectionSheet.find(
        (r) => r.order_id === currentOrder.orderId
      )!;
      const carteraOverdue = cartera.collectionSheet.find(
        (r) => r.order_id === overdueOrder.orderId
      )!;
      expect(carteraCurrent.invoice_age_days).toBe(5);
      expect(carteraCurrent.days_past_due).toBe(0);
      expect(carteraCurrent.due_status).toBe("CURRENT");

      expect(carteraOverdue.invoice_age_days).toBe(20);
      expect(carteraOverdue.days_past_due).toBe(4);
      expect(carteraOverdue.due_status).toBe("OVERDUE");

      // 4. GET / POST /api/daily-closures + RBAC + variance + CONCILIACION_SALDO exclusion
      for (const tok of [sellerToken, whToken]) {
        const deniedGet = await getDailyClosures(
          new NextRequest("http://localhost:3000/api/daily-closures?date=2027-03-20", {
            headers: { cookie: `bht_session=${tok}` },
          })
        );
        expect(deniedGet.status).toBe(403);

        const deniedPost = await postDailyClosures(
          new NextRequest("http://localhost:3000/api/daily-closures", {
            method: "POST",
            headers: {
              cookie: `bht_session=${tok}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              closureDate: "2027-03-20",
              accounts: [{ accountId: 1, countedBalancePen: 100 }],
            }),
          })
        );
        expect(deniedPost.status).toBe(403);
      }

      const draftRes = await getDailyClosures(
        new NextRequest("http://localhost:3000/api/daily-closures?date=2027-03-20", {
          headers: { cookie: `bht_session=${partnerToken}` },
        })
      );
      expect(draftRes.status).toBe(200);
      const draftJson = await draftRes.json();
      expect(draftJson.accounts.length).toBeGreaterThanOrEqual(1);

      const firstAcct = draftJson.accounts[0];
      const countedFirst = Number((firstAcct.systemBalancePen + 25).toFixed(2));
      const closurePayload = {
        closureDate: "2027-03-20",
        accounts: draftJson.accounts.map(
          (acc: { accountId: number; systemBalancePen: number }, idx: number) => ({
            accountId: acc.accountId,
            countedBalancePen: idx === 0 ? countedFirst : acc.systemBalancePen,
            notes: idx === 0 ? "Sobrante prueba arqueo" : null,
          })
        ),
        applyReconciliationAdjustments: true,
        nextDayNotes: "Priorizar cobranza en la mañana",
        notes: "Cierre de prueba Bloque B",
      };

      const postClosureRes = await postDailyClosures(
        new NextRequest("http://localhost:3000/api/daily-closures", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(closurePayload),
        })
      );
      expect(postClosureRes.status).toBe(200);
      const savedClosure = await postClosureRes.json();
      expect(savedClosure.isClosed).toBe(true);
      expect(savedClosure.existingClosure.varianceTotalPen).toBe(25);
      expect(savedClosure.accounts[0].isReconciled).toBe(true);
      expect(savedClosure.accounts[0].lastReconciledAt).toBeTruthy();
      expect(savedClosure.accounts[0].lastReconciledBalancePen).toBe(countedFirst);

      // Verify CONCILIACION_SALDO entry was recorded in cash_ledger and excluded from OpEx/non-OpEx
      const reconLedger = await client.query<{ amount_pen: string; direction: string }>(
        `SELECT amount_pen, direction::text AS direction
         FROM erp.cash_ledger
         WHERE reference_table = 'erp.daily_closures'
           AND expense_category = 'CONCILIACION_SALDO'
           AND tx_date = DATE '2027-03-20'`
      );
      expect(reconLedger.rowCount).toBe(1);
      expect(Number(reconLedger.rows[0].amount_pen)).toBe(25);
      expect(reconLedger.rows[0].direction).toBe("IN");

      const resumenMarAfterClosure = await getReportSectionData(client, "resumen", {
        from: "2027-03-01",
        to: "2027-03-31",
      });
      expect(resumenMarAfterClosure.totals.adminOpexPen).toBe(1500);
      expect(resumenMarAfterClosure.totals.nonOpexCapexDrainPen).toBe(0);

      const missingReason = await postDailyClosures(
        new NextRequest("http://localhost:3000/api/daily-closures", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(closurePayload),
        })
      );
      expect(missingReason.status).toBe(400);

      const correctedPayload = {
        ...closurePayload,
        correctionReason: "Se verificó un billete adicional en el arqueo",
        accounts: closurePayload.accounts.map(
          (
            acc: { accountId: number; countedBalancePen: number; notes: string | null },
            idx: number
          ) =>
            idx === 0
              ? {
                  ...acc,
                  countedBalancePen: Number((acc.countedBalancePen + 10).toFixed(2)),
                }
              : acc
        ),
      };
      const correctedRes = await postDailyClosures(
        new NextRequest("http://localhost:3000/api/daily-closures", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(correctedPayload),
        })
      );
      expect(correctedRes.status).toBe(200);
      const corrected = await correctedRes.json();
      expect(corrected.existingClosure.varianceTotalPen).toBe(35);
      expect(corrected.hasAppliedAdjustments).toBe(true);
      expect(corrected.corrections).toHaveLength(1);
      expect(corrected.corrections[0].reason).toBe(correctedPayload.correctionReason);
      expect(corrected.corrections[0].beforeData.closure.varianceTotalPen).toBe(25);
      expect(corrected.corrections[0].afterData.closure.varianceTotalPen).toBe(35);

      const adjustmentRows = await client.query<{
        direction: string;
        amount_pen: string;
        is_reversal: boolean;
      }>(
        `SELECT direction::text, amount_pen, is_reversal
         FROM erp.cash_ledger
         WHERE reference_table = 'erp.daily_closures'
           AND reference_id = $1
           AND expense_category = 'CONCILIACION_SALDO'
         ORDER BY ledger_id`,
        [String(corrected.existingClosure.closureId)]
      );
      expect(
        adjustmentRows.rows.map((r) => [
          r.direction,
          Number(r.amount_pen),
          r.is_reversal,
        ])
      ).toEqual([
        ["IN", 25, false],
        ["OUT", 25, true],
        ["IN", 35, false],
      ]);

      const repeatRes = await postDailyClosures(
        new NextRequest("http://localhost:3000/api/daily-closures", {
          method: "POST",
          headers: {
            cookie: `bht_session=${partnerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(correctedPayload),
        })
      );
      expect(repeatRes.status).toBe(200);
      const ledgerCount = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM erp.cash_ledger
         WHERE reference_table = 'erp.daily_closures'
           AND reference_id = $1
           AND expense_category = 'CONCILIACION_SALDO'`,
        [String(corrected.existingClosure.closureId)]
      );
      expect(Number(ledgerCount.rows[0].count)).toBe(3);

      await client.query("SAVEPOINT sp_audit_guard");
      await expect(
        client.query(
          `UPDATE erp.daily_closure_audit_log SET reason = 'alterado' WHERE closure_id = $1`,
          [corrected.existingClosure.closureId]
        )
      ).rejects.toBeTruthy();
      await client.query("ROLLBACK TO SAVEPOINT sp_audit_guard");
    } finally {
      spyClient.mockRestore();
      spyTx.mockRestore();
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
