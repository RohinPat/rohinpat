import { test, expect } from "@playwright/test";

// The tile previews on /interests are kept light (components/offhours/tileSchedule.ts):
// a tile starts when it is near the screen, one at a time, and on a phone-sized
// screen the two 3D tiles wait a few seconds after load.

const tile = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-piece="${id}"]`);

test("phone: a 3D tile off the screen does not boot until you get near it", async ({ browser }) => {
  test.setTimeout(90_000); // 3D in a software renderer is slow to start
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/interests");
  await page.waitForTimeout(6_000);
  await expect(tile(page, "keyboard").locator("canvas")).toHaveCount(0);
  await tile(page, "keyboard").scrollIntoViewIfNeeded();
  await expect(tile(page, "keyboard").locator("canvas")).toHaveCount(1, { timeout: 45_000 });
  await ctx.close();
});

test("wide screen: a tile that is on screen animates", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/interests");
  const maze = tile(page, "maze");
  await page.waitForTimeout(3_000);
  const a = await maze.screenshot();
  await expect.poll(async () => !a.equals(await maze.screenshot()), { timeout: 10_000 }).toBe(true);
  await ctx.close();
});

test("reduced motion: tiles hold still", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/interests");
  const maze = tile(page, "maze");
  await page.waitForTimeout(3_000);
  const a = await maze.screenshot();
  await page.waitForTimeout(2_000);
  expect((await maze.screenshot()).equals(a)).toBe(true);
  await ctx.close();
});

test("a tile still opens full screen after the page has been left alone", async ({ page }) => {
  await page.goto("/interests");
  await page.waitForTimeout(3_000);
  await page.getByRole("button", { name: /^Play Golf/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
