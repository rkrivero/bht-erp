import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signSessionToken } from "../../src/lib/auth";

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
    expect(layout.borderRadius).toBeGreaterThan(20);
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
  request,
  context,
  baseURL,
}) => {
  const authResponse = await request.post("/api/auth", {
    data: { username: "almacen1", password: "4444" },
  });
  expect(authResponse.ok()).toBe(true);
  const authBody = (await authResponse.json()) as {
    user: {
      user_id: number;
      userId: number;
      username: string;
      fullName: string;
      full_name: string;
      role: "WAREHOUSE_DELIVERY";
    };
  };
  const warehouseUser = authBody.user;
  const token = signSessionToken({
    userId: Number(warehouseUser.userId ?? warehouseUser.user_id),
    username: warehouseUser.username,
    fullName: warehouseUser.fullName ?? warehouseUser.full_name,
    role: "WAREHOUSE_DELIVERY",
    defaultCashAccountId: null,
  });
  await context.addCookies([
    {
      name: "bht_session",
      value: token,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

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
