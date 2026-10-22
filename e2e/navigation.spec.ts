import { test, expect } from "@playwright/test";

// Home opens on a lock screen; unlock it the way a visitor would.
async function unlock(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /swipe up to unlock/i });
  await btn.click();
  await expect(btn).toHaveCount(0);
}

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
  await unlock(page);
  const dock = page.getByRole("navigation", { name: "Dock" });
  await dock.getByRole("link", { name: "Work" }).click(); // launch zoom, then navigate
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/");
  await unlock(page);
  const closet = page.getByRole("link", { name: /^Closet Organizer$/ }).first();
  await closet.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/closet-organizer$/);
});

test("home screen: Spotlight finds and opens a page", async ({ page }) => {
  await page.goto("/");
  await unlock(page);
  await page.getByRole("button", { name: /^search$/i }).click();
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

test("lock screen: the flashlight toggles and the camera names colours", async ({ page }) => {
  await page.goto("/");
  const torch = page.getByRole("button", { name: "Flashlight" });
  await torch.click();
  await expect(torch).toHaveAttribute("aria-pressed", "true");
  // no camera in the test browser: it falls back to a sample outfit
  await page.getByRole("button", { name: /^Camera/ }).click();
  const cam = page.getByRole("dialog", { name: "Colour namer" });
  await expect(cam).toBeVisible();
  const live = cam.locator("[aria-live]");
  await expect(live).toHaveText("Navy and Beige", { timeout: 10_000 });
  await cam.getByRole("button", { name: "Sample", exact: true }).click();
  await expect(live).toHaveText("Brown");
  await page.keyboard.press("Escape");
  await expect(cam).toHaveCount(0);
  await expect(page.getByRole("button", { name: /swipe up to unlock/i })).toBeVisible();
});
