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

test("home field: each hotspot opens its page (mouse and keyboard)", async ({ page }) => {
  await page.goto("/");
  const spots = page.getByRole("navigation", { name: "Sections" });
  await expect(spots.getByRole("link")).toHaveCount(4);

  // click: the ripple plays, then the page opens
  await spots.getByRole("link", { name: /^Work/ }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // keyboard: focus a hotspot, press Enter
  await page.goto("/");
  const cs = spots.getByRole("link", { name: /Closet Organizer/ });
  await cs.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/closet-organizer$/);
});

test("retired pages redirect to /projects", async ({ page }) => {
  for (const path of ["/experience", "/skills"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/projects$/);
  }
});

test("terms and cookies fold into the privacy page", async ({ page }) => {
  for (const [path, hash] of [["/terms", "#terms"], ["/cookies", "#cookies"]]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/privacy${hash}$`));
    await expect(page.locator(hash)).toBeVisible();
  }
});
