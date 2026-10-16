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

test("home screen: apps open their pages (mouse and keyboard)", async ({ page }) => {
  await page.goto("/");
  const dock = page.getByRole("navigation", { name: "Dock" });
  await dock.getByRole("link", { name: "Work" }).click(); // launch zoom, then navigate
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/");
  const closet = page.getByRole("link", { name: /^Closet Organizer$/ }).first();
  await closet.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/closet-organizer$/);
});

test("home screen: Spotlight finds and opens a page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /search/i }).click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("off");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/interests$/);
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
