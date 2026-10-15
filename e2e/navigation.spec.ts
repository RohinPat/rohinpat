import { test, expect } from "@playwright/test";

test("nav links route between top-level pages", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Main" });

  await nav.getByRole("link", { name: /^Work$/ }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { level: 1, name: /Work/ })).toBeVisible();

  await nav.getByRole("link", { name: /^Off hours$/ }).click();
  await expect(page).toHaveURL(/\/interests$/);
  await expect(page.getByRole("heading", { level: 1, name: /Off hours/ })).toBeVisible();

  await nav.getByRole("link", { name: /^Contact$/ }).click();
  await expect(page).toHaveURL(/\/contact$/);

  // Click logo → home
  await page.getByRole("link", { name: /rohin patel/i }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Hero CTAs go to the right places", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator("section").first();

  await hero.getByRole("link", { name: /Read the case study/i }).click();
  await expect(page).toHaveURL(/\/projects\/closet-organizer$/);

  await page.goBack();
  await hero.getByRole("link", { name: /^All work$/ }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("retired pages redirect to /projects", async ({ page }) => {
  for (const path of ["/experience", "/skills"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/projects$/);
  }
});
