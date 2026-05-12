import { test, expect } from "@playwright/test";

// Mobile-specific checks. Runs only under the "mobile" project (iPhone 13 viewport).
// Catches the worst mobile failure mode: horizontal scroll / clipped content.

const routes = ["/", "/projects", "/experience", "/skills", "/interests", "/play", "/contact"];

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
  await expect(page.getByRole("link", { name: /^Interests$/ })).toBeVisible();
  await page.getByRole("link", { name: /^Work$/ }).click();
  await expect(page).toHaveURL(/\/projects$/);
});
