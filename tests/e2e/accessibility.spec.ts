import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("login is usable without horizontal overflow and has no serious Axe findings", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Blue Horizon Trade" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);

  const layout = await page.locator("main > section").evaluate((card) => {
    const rect = card.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      borderRadius: Number.parseFloat(getComputedStyle(card).borderRadius),
    };
  });
  if (layout.viewportWidth < 640) {
    expect(layout.width).toBeGreaterThanOrEqual(layout.viewportWidth - 1);
    expect(layout.height).toBeGreaterThanOrEqual(layout.viewportHeight - 1);
    expect(layout.borderRadius).toBe(0);
  } else {
    expect(layout.width).toBeLessThanOrEqual(464);
    expect(layout.height).toBeLessThan(layout.viewportHeight);
    expect(layout.borderRadius).toBe(16);
  }

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact || "")
  );
  expect(serious).toEqual([]);
});

test("authenticated warehouse header remains usable without clipping", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });

  await page.route("**/api/orders", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        orders: [],
        currentUser: {
          userId: 4,
          username: "warehouse-e2e",
          fullName: "Prueba de Almacén",
          role: "WAREHOUSE_DELIVERY",
        },
      }),
    });
  });
  await page.route("**/api/trips", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trips: [] }),
    });
  });
  await page.route("**/api/sync**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "e2e-static",
        changedScopes: [],
        allowedScopes: ["orders", "inventory"],
      }),
    });
  });

  await page.goto("/almacen");
  await expect(
    page.getByRole("heading", { name: "Cola de Pedidos y Despacho" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Por alistar 0/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Listos \/ En ruta 0/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sin empezar" })).toBeVisible();
  await expect(page.locator("#route-control")).toHaveCount(0);
  await page.getByRole("button", { name: /Listos \/ En ruta 0/ }).click();
  await expect(page.locator("#route-control")).toBeVisible();
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact || "")
    )
  ).toEqual([]);
});

test("partner today view keeps the priority queue visible and accessible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });

  const fixtures: Record<string, unknown> = {
    orders: { orders: [], catalog: [], accounts: [], pagination: { totalCount: 0 } },
    collections: { byOrder: [], byCustomer: [] },
    partners: {
      currentUser: {
        userId: 1,
        username: "partner-e2e",
        fullName: "Socio de prueba",
        role: "PARTNER_MANAGER",
      },
      kpiQ1: {},
      pendingOnDemand: [],
      negativeStockSkuCount: 0,
    },
    treasury: { accounts: [], ledger: [], apObligations: [] },
    purchases: { suppliers: [], recentPurchases: [], pendingOnDemand: [] },
    trips: { trips: [] },
    quotes: { quotes: [] },
  };

  for (const [endpoint, body] of Object.entries(fixtures)) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }
  await page.route("**/api/sync**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "e2e-static",
        changedScopes: [],
        allowedScopes: [
          "orders",
          "inventory",
          "collections",
          "treasury",
          "purchases",
          "partners",
        ],
      }),
    });
  });

  await page.goto("/socios?tab=control");
  await expect(
    page.getByRole("heading", { name: "Primero, resuelve lo que bloquea la operación" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cola priorizada" })).toBeVisible();
  await expect(page).toHaveURL(/tab=today/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact || "")
    )
  ).toEqual([]);
});

test("partner reports expose the data cut and cautious financial language", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });

  const fixtures: Record<string, unknown> = {
    orders: { orders: [], catalog: [], accounts: [], pagination: { totalCount: 0 } },
    collections: { byOrder: [], byCustomer: [] },
    partners: {
      currentUser: {
        userId: 1,
        username: "partner-e2e",
        fullName: "Socio de prueba",
        role: "PARTNER_MANAGER",
      },
      pendingOnDemand: [],
      negativeStockSkuCount: 0,
    },
    treasury: { accounts: [], ledger: [], apObligations: [] },
    purchases: { suppliers: [], recentPurchases: [] },
    trips: { trips: [] },
    quotes: { quotes: [] },
  };

  for (const [endpoint, body] of Object.entries(fixtures)) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }
  await page.route("**/api/sync**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "e2e-static",
        changedScopes: [],
        allowedScopes: [
          "orders",
          "inventory",
          "collections",
          "treasury",
          "purchases",
          "partners",
        ],
      }),
    });
  });
  await page.route("**/api/reports?section=resumen**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          filterOptions: { zones: [], sellers: [], months: ["2026-09-01"] },
          dataCut: {
            asOfLimaDate: "2026-11-18",
            lastOrderDate: "2026-09-29",
            lastPaymentDate: "2026-09-29",
            lastCashLedgerDate: "2026-09-29",
            lastPurchaseDate: "2026-09-25",
            lastQuoteDate: "2026-11-12",
            daysSinceLastOrder: 50,
            isStale: true,
            bankReconciled: false,
          },
          pnlMonthly: [],
          totals: {
            orderCount: 0,
            salesTotalPen: 0,
            costCoveredSalesPen: 0,
            costCoveragePct: null,
            cogsPen: 0,
            grossMarginPen: 0,
            grossMarginPct: null,
            routeOpexPen: 0,
            routeOpexPct: null,
            operatingEbitdaPen: 0,
            operatingEbitdaPct: null,
            adminOpexPen: 0,
            totalOpexPen: 0,
            operatingResultPen: 0,
            operatingResultPct: null,
            ownerSalaryRecordedPen: 0,
            cashCollectedPen: 0,
            arPendingPen: 0,
            merchandiseOutflowPen: 0,
            nonOpexCapexDrainPen: 0,
            internalDepositsPen: 0,
            preRouteFoundationalOutflowPen: 0,
            netCashFlowPen: 0,
            nonOpexVsReinvestmentPct: 0,
          },
          momComparison: null,
          openDebtorsCount: 0,
        },
      }),
    });
  });
  await page.route("**/api/reports?section=auditoria**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          filterOptions: { zones: [], sellers: [], months: ["2026-09-01"] },
          dataCut: {
            asOfLimaDate: "2026-11-18",
            lastOrderDate: "2026-09-29",
            lastPaymentDate: "2026-09-29",
            lastCashLedgerDate: "2026-09-29",
            lastPurchaseDate: "2026-09-25",
            lastQuoteDate: "2026-11-12",
            daysSinceLastOrder: 50,
            isStale: true,
            bankReconciled: false,
          },
          operationalQuality: {
            registrationCoverage24h: {
              numerator: 0,
              denominator: 0,
              coveragePct: null,
              baselineMode: "NO_APP_ORDERS",
              incompleteOrders: [],
              correctionRatePct: 0,
              weeklyCohorts: [],
            },
            erpAppOrdersCount: 0,
            totalOrdersCount: 152,
            ordersMissingSellerCount: 152,
            activeProductsCount: 194,
            productsMissingCostCount: 42,
            soldSkusMissingCostCount: 10,
            soldSkusMissingCostPen: 19550,
            purchasesTotalCount: 72,
            purchasesWithoutDetailCount: 52,
            activeCustomersCount: 110,
            customersMissingPhoneCount: 110,
            customersMissingZoneCount: 110,
            customersMissingGeoCount: 110,
            tripsTotalCount: 47,
            tripsWithoutReconciliationCount: 45,
            assumedCashOrdersCount: 97,
            assumedCashOrdersPen: 248981.1,
            negativeStockSkuCount: 0,
            openBankAuditFlagsCount: 1,
            apNoDueDateCount: 1,
            latestDailyClosure: null,
            startupChecklist: [
              {
                code: "ERP_OPERATIONS_STARTED",
                label: "Operación diaria iniciada en el ERP",
                done: false,
                pendingCount: 1,
                detail: "Aún hay 0 ventas registradas desde el ERP.",
                targetTab: "vendedor",
              },
              {
                code: "SOLD_SKU_COSTS",
                label: "Costos completos en SKUs vendidos",
                done: false,
                pendingCount: 10,
                detail: "10 SKU(s) vendidos sin costo conocido.",
                targetTab: "stock",
              },
              {
                code: "INVENTORY_BASELINE",
                label: "Conteo físico y stock regularizado",
                done: true,
                pendingCount: 0,
                detail: "Sin saldos negativos pendientes en almacén principal.",
                targetTab: "stock",
              },
              {
                code: "BANK_RECONCILIATION",
                label: "Bancos y extractos conciliados",
                done: false,
                pendingCount: 1,
                detail: "Faltan extractos bancarios históricos.",
                targetTab: "caja",
              },
              {
                code: "ASSUMED_CASH_CONFIRMED",
                label: "Ventas históricas asumidas revisadas",
                done: false,
                pendingCount: 97,
                detail: "97 venta(s) históricas siguen asumidas como contado.",
                targetTab: "deudores",
              },
              {
                code: "CUSTOMERS_CONTACT_DATA",
                label: "Teléfono y zona en clientes activos",
                done: false,
                pendingCount: 110,
                detail: "110 sin teléfono y 110 sin zona.",
                targetTab: "directorio",
              },
            ],
          },
          closingReadiness: { status: "BLOCKED", checks: [] },
          qualityGaps: [],
          auditFlags: [],
          auditFlagCounts: { open: 0, acknowledged: 0, resolved: 0 },
        },
      }),
    });
  });

  await page.goto("/socios?tab=finance&view=analytics");
  await expect(
    page.getByRole("heading", { name: "Reportes para decidir" })
  ).toBeVisible();
  await expect(page.getByText("Ventas actualizadas hasta: 29/09/2026")).toBeVisible();
  await expect(
    page.getByText(/No reemplaza un estado de resultados ni una conciliación bancaria/)
  ).toBeVisible();
  await expect(page.getByText("Contribución después de gastos de ruta")).toBeVisible();
  await expect(page.getByText("EBITDA Operativo Estimado")).toHaveCount(0);

  await page
    .getByRole("button", { name: /Margen bruto sobre ventas con costo/ })
    .click();
  const conceptDialog = page.getByRole("dialog");
  await expect(conceptDialog).toBeVisible();
  await expect(conceptDialog).toContainText("¿Qué significa en simple?");
  await expect(conceptDialog).toContainText("Fundamento teórico");
  await conceptDialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(conceptDialog).toHaveCount(0);

  await page.getByRole("tab", { name: "Auditoría" }).click();
  await expect(
    page.getByRole("heading", { name: "Cobertura de registro completo en 24 h" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lista de Verificación de Inicio Operativo" })
  ).toBeVisible();
  await expect(page.getByText("Operación diaria iniciada en el ERP")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact || "")
    )
  ).toEqual([]);
});

test("daily close correction stays usable on mobile and desktop", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });
  const fixtures: Record<string, unknown> = {
    orders: { orders: [], catalog: [], accounts: [], pagination: { totalCount: 0 } },
    collections: { byOrder: [], byCustomer: [] },
    partners: {
      currentUser: {
        userId: 1,
        username: "partner-e2e",
        fullName: "Socio de prueba",
        role: "PARTNER_MANAGER",
      },
      kpiQ1: {},
      pendingOnDemand: [],
      negativeStockSkuCount: 0,
    },
    treasury: { accounts: [], ledger: [], apObligations: [] },
    purchases: { suppliers: [], recentPurchases: [], pendingOnDemand: [] },
    trips: { trips: [] },
    quotes: { quotes: [] },
  };
  for (const [endpoint, body] of Object.entries(fixtures)) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }
  await page.route("**/api/sync**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "e2e-static",
        changedScopes: [],
        allowedScopes: ["orders", "treasury", "partners"],
      }),
    });
  });
  const closure = {
    closureId: 10,
    closureDate: "2026-11-18",
    status: "CLOSED",
    closedByName: "Socio de prueba",
    salesCount: 1,
    salesTotalPen: 100,
    collectionsTotalPen: 100,
    expensesTotalPen: 10,
    depositsTotalPen: 0,
    expectedCashTotalPen: 100,
    countedCashTotalPen: 105,
    varianceTotalPen: 5,
    pendingDeliveriesCount: 0,
    pendingCollectionsCount: 0,
    pendingAp7dCount: 0,
    incompleteOrders24h: 0,
    nextDayNotes: null,
    notes: null,
    updatedAt: "2026-11-18T23:00:00Z",
  };
  const account = {
    accountId: 1,
    code: "CAJA_RUTA",
    name: "Caja de Ruta",
    accountType: "CASH",
    systemBalancePen: 100,
    dayInPen: 100,
    dayOutPen: 0,
    countedBalancePen: 105,
    variancePen: 5,
    isReconciled: true,
    notes: null,
    lastReconciledAt: "2026-11-18T23:00:00Z",
    lastReconciledBalancePen: 105,
  };
  await page.route("**/api/daily-closures**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        closureDate: "2026-11-18",
        isClosed: true,
        hasAppliedAdjustments: true,
        existingClosure: closure,
        daySummary: {
          salesCount: 1,
          salesTotalPen: 100,
          collectionsTotalPen: 100,
          expensesTotalPen: 10,
          depositsTotalPen: 0,
          expectedCashTotalPen: 100,
        },
        accounts: [account],
        pendingItems: {
          deliveriesCount: 0,
          deliveries: [],
          collectionsCount: 0,
          collectionsTotalPen: 0,
          collections: [],
          ap7dCount: 0,
          ap7dTotalPen: 0,
          ap7d: [],
          incompleteOrders24h: 0,
        },
        recentClosures: [closure],
        corrections: [
          {
            auditId: 1,
            actorName: "Socio de prueba",
            actorRole: "PARTNER_MANAGER",
            reason: "Conteo físico verificado",
            createdAt: "2026-11-18T23:00:00Z",
            beforeData: {
              closure: { ...closure, countedCashTotalPen: 100, varianceTotalPen: 0 },
              accounts: [{ ...account, countedBalancePen: 100, variancePen: 0 }],
            },
            afterData: { closure, accounts: [account] },
          },
        ],
      }),
    });
  });

  await page.goto("/socios?tab=finance&view=operations");
  await page.getByRole("radio", { name: "Cierre diario" }).click();
  await expect(
    page.getByRole("heading", { name: "Cierre diario de 10 minutos" })
  ).toBeVisible();
  await expect(page.getByLabel("Motivo de la corrección (obligatorio)")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Historial de correcciones" })
  ).toBeVisible();
  await expect(page.getByText("Conteo físico verificado")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
  ).toBe(false);
  await page.screenshot({
    path: `/tmp/bht-cierre-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("partner manager hides user administration nav and restricts access route", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });

  const fixtures: Record<string, unknown> = {
    orders: { orders: [], catalog: [], accounts: [], pagination: { totalCount: 0 } },
    collections: { byOrder: [], byCustomer: [] },
    partners: {
      currentUser: {
        userId: 2,
        username: "partner-mgr-e2e",
        fullName: "Socio Gerente",
        role: "PARTNER_MANAGER",
      },
      kpiQ1: {},
      pendingOnDemand: [],
      negativeStockSkuCount: 0,
      users: [],
      userAccessHistory: [],
    },
    treasury: { accounts: [], ledger: [], apObligations: [] },
    purchases: { suppliers: [], recentPurchases: [] },
    trips: { trips: [] },
    quotes: { quotes: [] },
  };

  for (const [endpoint, body] of Object.entries(fixtures)) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }
  await page.route("**/api/sync**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "e2e-static",
        changedScopes: [],
        allowedScopes: [
          "orders",
          "inventory",
          "collections",
          "treasury",
          "purchases",
          "partners",
        ],
      }),
    });
  });

  await page.goto("/socios?tab=access");
  await expect(
    page.getByRole("heading", { name: "Administración de usuarios y roles" })
  ).toBeVisible();
  await expect(
    page.getByText(/Solo el usuario Administrador \(PARTNER_ADMIN\) puede consultar/)
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver a Hoy" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Secciones principales" })
      .getByRole("button", {
        name: "Usuarios",
      })
  ).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact || "")
    )
  ).toEqual([]);
});

test("partner directory exposes customer detail and keeps buyer hierarchy in orders", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith("desktop-"),
    "Desktop pointer coverage; the same flow switches to a mobile viewport for the sheet."
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });

  const order = {
    order_id: 901,
    order_code: "PED-901",
    order_date: "2026-11-18",
    customer_name: "Ferretería Horizonte",
    operational_status: "PENDING",
    total_pen: 425,
    created_by_name: "Socio de prueba",
    lines: [],
  };
  const fixtures: Record<string, unknown> = {
    orders: {
      orders: [order],
      catalog: [
        {
          product_id: 10,
          sku: "SKU-AGOTADO",
          name: "Producto agotado",
          unit_of_measure: "UND",
          fulfillment_mode: "STOCKED",
          stock_on_hand: 0,
          list_sale_price_pen: 20,
          min_sale_price_pen: 15,
          ref_cost_pen: 10,
        },
        {
          product_id: 11,
          sku: "SKU-BAJO",
          name: "Producto bajo",
          unit_of_measure: "UND",
          fulfillment_mode: "STOCKED",
          stock_on_hand: 3,
          list_sale_price_pen: 20,
          min_sale_price_pen: 15,
          ref_cost_pen: 10,
        },
        {
          product_id: 12,
          sku: "SKU-SIN-COSTO",
          name: "Producto sin costo",
          unit_of_measure: "UND",
          fulfillment_mode: "ON_DEMAND",
          stock_on_hand: 0,
          list_sale_price_pen: 20,
          min_sale_price_pen: 15,
          ref_cost_pen: null,
        },
        {
          product_id: 13,
          sku: "SKU-MARGEN",
          name: "Producto con margen en riesgo",
          unit_of_measure: "UND",
          fulfillment_mode: "STOCKED",
          stock_on_hand: 8,
          list_sale_price_pen: 20,
          min_sale_price_pen: 10,
          ref_cost_pen: 10,
        },
      ],
      accounts: [],
      pagination: { totalCount: 1, hasMore: false },
    },
    collections: { byOrder: [], byCustomer: [] },
    partners: {
      currentUser: {
        userId: 1,
        username: "partner-e2e",
        fullName: "Socio de prueba",
        role: "PARTNER_MANAGER",
      },
      pendingOnDemand: [],
      negativeStockSkuCount: 0,
    },
    treasury: { accounts: [], ledger: [], apObligations: [] },
    purchases: { suppliers: [], recentPurchases: [] },
    trips: { trips: [] },
    quotes: { quotes: [] },
  };

  for (const [endpoint, body] of Object.entries(fixtures)) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }
  await page.route("**/api/customers**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        customers: [
          {
            party_id: 71,
            legal_name: "Ferretería Horizonte S.A.C.",
            trade_name: "Ferretería Horizonte",
            display_name: "Ferretería Horizonte",
            doc_type: "RUC",
            doc_number: "20601234567",
            is_generic_doc: false,
            phone: "999 111 222",
            email: "ventas@horizonte.test",
            address: "Av. Industrial 456, almacén 3",
            city_zone: "Norte",
            notes: "Ingreso por puerta lateral",
            is_active: true,
            geo_lat: -12.0464,
            geo_lng: -77.0428,
            geo_accuracy_m: 12,
            geo_updated_at: "2026-11-18T10:00:00Z",
            orders_count: 3,
            open_balance_pen: 125,
            last_order_date: "2026-11-18",
            aliases: ["Horizonte"],
            has_orders: true,
          },
        ],
        zones: [{ zone: "Norte", count: 1 }],
        stats: { totalActive: 1, withGeo: 1, withoutGeo: 0, withDebt: 1 },
        pagination: { limit: 100, offset: 0, totalCount: 1, hasMore: false },
      }),
    });
  });
  await page.route("**/api/sync**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "e2e-static",
        changedScopes: [],
        allowedScopes: ["orders", "partners"],
      }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/socios?tab=directory");
  const directoryTabs = page.getByRole("radiogroup", {
    name: "Sección del directorio",
  });
  const viewTabs = page.getByRole("radiogroup", { name: "Vista de clientes" });
  for (const label of ["Clientes", "Proveedores"]) {
    const tab = directoryTabs.getByRole("radio", { name: label });
    await expect(tab).toBeVisible();
    expect(
      await tab
        .locator("span")
        .first()
        .evaluate((element) => {
          const styles = getComputedStyle(element);
          return {
            height: element.getBoundingClientRect().height,
            lineHeight: Number.parseFloat(styles.lineHeight),
            whiteSpace: styles.whiteSpace,
          };
        })
    ).toMatchObject({ whiteSpace: "nowrap" });
  }
  for (const label of ["Lista", "Mapa"]) {
    await expect(viewTabs.getByRole("radio", { name: label })).toBeVisible();
  }
  const customerCard = page.getByRole("button", { name: /Ferretería Horizonte/ });
  await expect(customerCard).toBeVisible();
  await customerCard.hover();
  await expect(
    page.getByRole("complementary", {
      name: /Vista rápida/,
    })
  ).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ["Clientes", "Proveedores"]) {
    const tab = directoryTabs.getByRole("radio", { name: label });
    const metrics = await tab
      .locator("span")
      .first()
      .evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(styles.lineHeight),
        };
      });
    expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight + 1);
  }
  for (const label of ["Lista", "Mapa"]) {
    const tab = viewTabs.getByRole("radio", { name: label });
    const metrics = await tab
      .locator("span")
      .first()
      .evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(styles.lineHeight),
        };
      });
    expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight + 1);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
  ).toBe(false);
  await customerCard.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("3 pedidos");
  const customerOrdersRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/orders" &&
      url.searchParams.get("customer_party_id") === "71" &&
      url.searchParams.get("include_refs") === "false"
    );
  });
  await dialog.getByRole("button", { name: "Ver pedidos (3)" }).click();
  await customerOrdersRequest;

  const buyer = page.getByRole("heading", {
    name: "Ferretería Horizonte",
    level: 3,
  });
  await expect(buyer).toBeVisible();
  const code = page.getByText("Pedido PED-901", { exact: true });
  const date = page.getByText("Fecha: 2026-11-18", { exact: true });
  const hierarchy = await Promise.all([
    buyer.evaluate((el) => getComputedStyle(el).fontSize),
    code.evaluate((el) => getComputedStyle(el).fontSize),
    code.evaluate((el) => getComputedStyle(el).color),
    date.evaluate((el) => getComputedStyle(el).color),
  ]);
  expect(Number.parseFloat(hierarchy[0])).toBeGreaterThan(
    Number.parseFloat(hierarchy[1])
  );
  expect(hierarchy[2]).not.toBe(hierarchy[3]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
  ).toBe(false);

  await page.goto("/socios?tab=inventory");
  for (const label of [
    /Agotados: 1\./,
    /Stock bajo: 1\./,
    /Sin costo registrado: 1\./,
    /Margen en riesgo: 1\./,
  ]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
  await page.getByRole("button", { name: /Agotados: 1\./ }).click();
  await expect(page.getByText("Mostrando 1 de 1 productos")).toBeVisible();
  await expect(page.getByText("Producto agotado", { exact: true })).toBeVisible();
  await expect(page.getByText("Producto bajo", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
  ).toBe(false);
});

test("seller guided flow exposes four steps without overflow", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });

  await page.route("**/api/orders", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        orders: [],
        catalog: [],
        customers: [],
        accounts: [],
        currentUser: {
          userId: 2,
          username: "seller-e2e",
          fullName: "Vendedor de prueba",
          role: "EXTERNAL_SELLER",
        },
      }),
    });
  });
  await page.route("**/api/quotes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ quotes: [] }),
    });
  });
  await page.route("**/api/collections", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ byOrder: [], byCustomer: [] }),
    });
  });
  await page.route("**/api/sync**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "e2e-static",
        changedScopes: [],
        allowedScopes: ["orders", "inventory", "collections", "treasury", "partners"],
      }),
    });
  });

  await page.goto("/vendedor?tab=nuevo");
  await expect(
    page.getByRole("navigation", { name: "Progreso del pedido" })
  ).toBeVisible();
  for (const label of ["Cliente", "Productos", "Pago", "Confirmación"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(page).toHaveURL(/tab=sell/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact || "")
    )
  ).toEqual([]);
});
