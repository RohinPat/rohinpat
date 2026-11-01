import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Powder (the giant slalom): the medals are not for sliding down the hill, the keys keep the steering from a jittering pointer, the
// result card does not wait for the skier to stop, and a phone has a second finger to tuck and a Restart chip after a crash.
// The mock link (NEXT_PUBLIC_LINK_MOCK=1, or ?linkmock) gives the page `window.__powder`.

const LAPTOP = { width: 1440, height: 900 };
const SLOW = { timeout: 15_000 };

type Hook = {
  game: { phase: string; phaseT: number; run: { crash: number; v: number }; result: { medal: number; missed: number; timeMedal: number } | null; tuckIn: boolean; begin(): void; update(dt: number): void };
  keys: { keyMode: boolean; touch: boolean; touchTuck: boolean; noTuck: boolean };
};
const hook = (p: Page) => p.evaluate(() => {
  const h = (window as unknown as { __powder: Hook }).__powder;
  return { phase: h.game.phase, keyMode: h.keys.keyMode, touchTuck: h.keys.touchTuck, tuckIn: h.game.tuckIn, noTuck: h.keys.noTuck, touch: h.keys.touch };
});

async function openPowder(p: Page) {
  await p.goto("/interests?linkmock");
  await p.locator('[data-piece="powder"]').click();
  await expect(p.getByRole("dialog")).toBeVisible(SLOW);
  const canvas = p.getByRole("img", { name: /giant slalom/i });
  await expect(canvas).toBeVisible();
  await canvas.focus();
  await expect.poll(() => p.evaluate(() => !!(window as unknown as { __powder?: unknown }).__powder)).toBe(true);
  return canvas;
}

test.describe("Powder", () => {
  test("a run with no input at all finishes without a medal, and the result card is up while the skier is still sliding", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openPowder(page);
    // fast-forward the real game: start, then no steering and no tuck until the line
    const out = await page.evaluate(() => {
      const g = (window as unknown as { __powder: Hook }).__powder.game;
      g.begin();
      let fin = -1;
      for (let i = 0; i < 60 * 200 && g.phase !== "result"; i++) {
        g.update(1 / 60);
        if (g.phase === "finish" && fin < 0) fin = i;
      }
      return { phase: g.phase, medal: g.result?.medal, missed: g.result?.missed, timeMedal: g.result?.timeMedal, v: g.run.v };
    });
    expect(out.phase).toBe("result");
    expect(out.missed).toBeGreaterThan(14);
    expect(out.medal).toBe(0);
    // the card came up 1.5 s after the line, with the skier still moving
    expect(out.v).toBeGreaterThan(1);
    await context.close();
  });

  test("a pointer that only jitters does not take the steering from the keys", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    const canvas = await openPowder(page);
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.keyboard.down("ArrowRight");
    expect((await hook(page)).keyMode).toBe(true);
    // a hand on the mouse: a few pixels, then a lot, with the key still down
    await page.mouse.move(cx + 3, cy + 2);
    await page.mouse.move(cx + 120, cy + 40);
    expect((await hook(page)).keyMode).toBe(true);
    await page.keyboard.up("ArrowRight");
    // just after the key: still the keys', whatever the pointer does
    await page.mouse.move(cx - 100, cy);
    expect((await hook(page)).keyMode).toBe(true);
    // after the pause, a few pixels do not take it, and a real move does
    await page.waitForTimeout(400);
    await page.keyboard.down("ArrowLeft");
    await page.keyboard.up("ArrowLeft");
    await page.waitForTimeout(400);
    await page.mouse.move(cx - 98, cy + 2);
    expect((await hook(page)).keyMode).toBe(true);
    await page.mouse.move(cx + 200, cy + 60);
    expect((await hook(page)).keyMode).toBe(false);
    await context.close();
  });

  test("the click that starts a run does not tuck", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    const canvas = await openPowder(page);
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(async () => (await hook(page)).phase, SLOW).toBe("count");
    expect((await hook(page)).tuckIn).toBe(false);
    await page.mouse.up();
    // and a press during the run does
    await expect.poll(async () => (await hook(page)).phase, { timeout: 20_000 }).toBe("run");
    await page.mouse.down();
    await expect.poll(async () => (await hook(page)).tuckIn).toBe(true);
    await page.mouse.up();
    await context.close();
  });

  test("on a phone a second finger held down tucks without taking the steering or starting a run, and Restart shows after the result", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await openPowder(page);
    const canvas = page.getByRole("img", { name: /giant slalom/i });
    await canvas.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 190, clientY: 400, bubbles: true });
    await expect.poll(async () => (await hook(page)).touch).toBe(true);
    await canvas.dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 300, clientY: 500, bubbles: true });
    await expect.poll(async () => (await hook(page)).touchTuck).toBe(true);
    await canvas.dispatchEvent("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 300, clientY: 500, bubbles: true });
    await expect.poll(async () => (await hook(page)).touchTuck).toBe(false);
    // no chip on the ready screen; one on the result card
    await expect(page.getByTestId("powder-restart")).toHaveCount(0);
    await page.evaluate(() => {
      const g = (window as unknown as { __powder: Hook }).__powder.game;
      g.begin();
      for (let i = 0; i < 60 * 200 && g.phase !== "result"; i++) g.update(1 / 60);
    });
    const chip = page.getByTestId("powder-restart");
    await expect(chip).toBeVisible(SLOW);
    const box = (await chip.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(700);
    await chip.click();
    await expect.poll(async () => (await hook(page)).phase, SLOW).toMatch(/count|run/);
    await expect(chip).toHaveCount(0);
    await context.close();
  });

  test("passes the axe scan on the ready screen", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openPowder(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await context.close();
  });
});
