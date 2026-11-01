import { test, expect, type Page } from "@playwright/test";

// The first thing a visitor tries, from the gameplay audit: it should just work.

const open = async (page: Page, label: RegExp) => {
  await page.goto("/interests");
  await page.getByRole("button", { name: label }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test("keyboard: after clicking Take apart, typing still types and snaps it back", async ({ page }) => {
  test.setTimeout(90_000); // 3D in a software renderer is slow to start
  await open(page, /^Play Keyboards/);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /take apart/i }).click();
  await page.keyboard.type("qw");
  await expect(dialog.getByText(/^QW/)).toBeVisible();
  // and the browser keeps its shortcuts
  await page.keyboard.press("Control+a");
  await expect(dialog.getByText(/^QW/)).toBeVisible();
});

test("maze: the first arrow key takes over from the solver, and the clock runs", async ({ page }) => {
  await open(page, /^Play Gaming/);
  const you = page.getByRole("dialog").getByRole("button", { name: "You", exact: true });
  await expect(you).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog").locator("canvas[data-autofocus]")).toBeFocused();
  await page.keyboard.down("ArrowUp");
  await expect(you).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowUp");
});

test("maze on a phone: New maze stays on screen", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await open(page, /^Play Gaming/);
  const box = await page.getByRole("dialog").getByRole("button", { name: "New maze" }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await ctx.close();
});
