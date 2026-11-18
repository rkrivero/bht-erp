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
      pendingOnDemand: [],
      negativeStockSkuCount: 0,
    },
    treasury: { accounts: [], ledger: [], apObligations: [] },
    purchases: { suppliers: [], recentPurchases: [] },
    trips: { trips: [] },
    quotes: { quotes: [] },
  };

  for (const [endpoint, body] of Object.entries(fixtures)) {
    await page.route(`**/api/${endpoint}`, async (route) => {
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
        allowedScopes: ["orders", "inventory", "collections", "treasury", "purchases", "partners"],
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
