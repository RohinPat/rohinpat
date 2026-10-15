import { test, expect } from "@playwright/test";

// Mobile-specific checks. Runs only under the "mobile" project (iPhone 13 viewport).
// Catches the worst mobile failure mode: horizontal scroll / clipped content.

const routes = ["/", "/projects", "/projects/closet-organizer", "/interests", "/contact", "/privacy"];

for (const path of routes) {
  test(`${path} has no horizontal overflow on mobile`, async ({ page }) => {
    await page.goto(path);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    // Allow 1px tolerance for browser sub-pixel rounding.
    expect(
      scrollWidth - clientWidth,
      `${path}: page width ${scrollWidth}px exceeds viewport ${clientWidth}px`,
    ).toBeLessThanOrEqual(1);
  });
}

test("mobile nav opens and closes", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /toggle menu/i });
  await toggle.click();
  const menu = page.locator("#mobile-menu");
  await expect(menu.getByRole("link", { name: /^Off hours$/ })).toBeVisible();
  await menu.getByRole("link", { name: /^Work$/ }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("name, point of view and the primary action sit on the first screen", async ({ page }) => {
  await page.goto("/");
  const vh = page.viewportSize()!.height;
  for (const el of [
    page.getByRole("heading", { level: 1 }),
    page.getByText(/I build iOS apps/),
    page.getByRole("link", { name: /Read the case study/i }),
  ]) {
    const box = await el.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  }
});
