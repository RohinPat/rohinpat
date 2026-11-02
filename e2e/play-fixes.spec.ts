import { test, expect, type Page } from "@playwright/test";

// Found by playing: a click made while the last kick's result is still up skips it and also charges the next
// kick (it used to only skip, so every other kick was lost), and a steer key at Powder's gate drops in.

const LAPTOP = { width: 1440, height: 900 };
const SLOW = { timeout: 15_000 };
const live = (p: Page) => p.locator('[role="dialog"] p[aria-live="polite"]');

async function open(p: Page, id: string) {
  await p.goto("/interests?linkmock");
  await p.locator(`[data-piece="${id}"]`).click();
  await expect(p.getByRole("dialog")).toBeVisible(SLOW);
}

test("Penalty: pressing while the result is up kicks the next ball", async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL, viewport: LAPTOP });
  const page = await context.newPage();
  await open(page, "penalty");
  const canvas = page.getByRole("img", { name: /penalty kick/i });
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45, { steps: 4 });
  await page.waitForTimeout(300);
  for (let i = 1; i <= 3; i++) {
    await page.mouse.down();
    await page.waitForTimeout(550);
    await page.mouse.up();
    await expect(live(page)).toContainText(`from ${i}.`, SLOW);
    // the next press lands while this result is still on screen, after it has been seen
    if (i < 3) await page.waitForTimeout(1300);
  }
  await context.close();
});

test("Powder: a steer key at the gate drops in", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: LAPTOP });
  const page = await context.newPage();
  await open(page, "powder");
  const canvas = page.getByRole("img", { name: /giant slalom/i });
  await canvas.focus();
  const phase = () => page.evaluate(() => (window as unknown as { __powder: { game: { phase: string } } }).__powder.game.phase);
  await expect.poll(phase).toBe("ready");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(120);
  await page.keyboard.up("ArrowRight");
  await expect.poll(phase).not.toBe("ready");
  await context.close();
});
