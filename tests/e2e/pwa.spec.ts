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
