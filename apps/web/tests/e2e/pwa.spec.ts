import { expect, test } from "@playwright/test";

test("publishes an installable manifest and an offline fallback", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBeTruthy();

  const manifest = await request.get(manifestHref!);
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");

  await page.goto("/offline");
  await expect(
    page.getByRole("heading", { name: "Sin conexión", exact: true })
  ).toBeVisible();
});

test("recovers the seller shell offline without deleting a pending outbox", async ({
  page,
  context,
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
        catalog: [],
        customers: [],
        accounts: [],
        currentUser: {
          userId: 2,
          username: "seller-pwa",
          fullName: "Vendedor PWA",
          role: "EXTERNAL_SELLER",
        },
      }),
    });
  });
  for (const endpoint of ["quotes", "collections", "sync"]) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          endpoint === "sync"
            ? { version: "pwa", changedScopes: [], allowedScopes: ["orders"] }
            : endpoint === "collections"
              ? { byOrder: [], byCustomer: [] }
              : { quotes: [] }
        ),
      });
    });
  }

  await page.goto("/vendedor");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) location.reload();
  });
  await page.waitForLoadState("domcontentloaded");
  await context.setOffline(true);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("bht-erp-offline-v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots", { keyPath: "key" });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("outbox", "readwrite");
        tx.objectStore("outbox").put({
          id: "pwa-pending",
          kind: "ORDER_CREATE",
          actorUsername: "seller-pwa",
          url: "/api/orders",
          body: { customerNameRaw: "Cliente offline" },
          createdAt: new Date().toISOString(),
          status: "pending",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  const offlineResponse = await page.goto("/vendedor");
  expect(offlineResponse?.ok()).toBe(true);
  const pendingStillExists = await page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open("bht-erp-offline-v1", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db
            .transaction("outbox", "readonly")
            .objectStore("outbox")
            .get("pwa-pending");
          get.onsuccess = () => {
            resolve(get.result?.status === "pending");
            db.close();
          };
          get.onerror = () => reject(get.error);
        };
      })
  );
  expect(pendingStillExists).toBe(true);
  await context.setOffline(false);
});

test("renders conflict resolution actions on /offline for WAREHOUSE_ADVANCE", async ({
  page,
}) => {
  await page.goto("/offline");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("bht-erp-offline-v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots", { keyPath: "key" });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("outbox", "readwrite");
        tx.objectStore("outbox").put({
          id: "wh-conflict-e2e",
          kind: "WAREHOUSE_ADVANCE",
          actorUsername: "almacen1",
          url: "/api/orders",
          body: { action: "advance", orderId: 901, nextStatus: "DELIVERED" },
          createdAt: new Date().toISOString(),
          status: "conflict",
          lastError: "El pedido ya fue entregado por otro usuario",
          conflictCode: "INVALID_STATE_TRANSITION",
          causalKey: "order:901",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.reload();
  await expect(page.getByText("Entrega / Almacén")).toBeVisible();
  await expect(page.getByText("Requiere revisión")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revisar/Editar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Descartar" })).toBeVisible();

  await page.getByRole("button", { name: "Revisar/Editar" }).click();
  await expect(page.getByLabel("Editar datos de la operación (JSON)")).toBeVisible();
  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(
    page.getByText("No hay operaciones pendientes en este dispositivo.")
  ).toBeVisible();
});
