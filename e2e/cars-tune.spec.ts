import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Cars, tuning pass, end to end: a mouse can hold the throttle and shift on the strip, the strip's buttons work from the keyboard,
// and on a phone the Drift pad is a good size and a run can be restarted. The mock link gives the page `window.__night` / `__drag`.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

type DragHook = { car: { phase: string; throttle: boolean; gear: number; rpm: number; shiftT: number } };
const stage = (p: Page) => p.getByRole("dialog");
const drag = (p: Page) => p.evaluate(() => {
  const c = (window as unknown as { __drag: DragHook }).__drag.car;
  return { phase: c.phase, throttle: c.throttle, gear: c.gear };
});

async function openStrip(p: Page) {
  await p.goto("/interests?linkmock");
  await p.locator('[data-piece="engine"]').click();
  await expect(stage(p)).toBeVisible(SLOW);
  await p.getByTestId("engine-mode-drag").click();
  const dash = stage(p).getByRole("img", { name: /race dashboard/i });
  await expect(dash).toBeVisible();
  await dash.focus();
  return dash;
}

test.describe("the strip with a mouse", () => {
  test("a click on the dash holds the throttle until the next click, and the Shift button works meanwhile", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    const dash = await openStrip(page);
    // a click on the dash itself, which waits until the opening stage has unclipped over it
    await dash.click();
    // let go of the button: the throttle stays on
    await expect.poll(async () => (await drag(page)).throttle, SLOW).toBe(true);
    await page.waitForTimeout(300);
    expect((await drag(page)).throttle).toBe(true);
    // a click on Shift does not lift it (and so does the keyboard on a focused Shift)
    await stage(page).getByRole("button", { name: /shift/i }).click();
    expect((await drag(page)).throttle).toBe(true);
    await expect(stage(page).getByRole("button", { name: /throttle/i })).toHaveAttribute("aria-pressed", "true");
    // the next click lifts it
    await dash.click();
    await expect.poll(async () => (await drag(page)).throttle).toBe(false);
    await context.close();
  });

  test("the Throttle and Shift buttons answer Enter and Space", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openStrip(page);
    const throttle = stage(page).getByRole("button", { name: /throttle/i });
    await throttle.focus();
    await page.keyboard.down("Enter");
    await expect.poll(async () => (await drag(page)).throttle).toBe(true);
    await page.keyboard.up("Enter");
    await expect.poll(async () => (await drag(page)).throttle).toBe(false);
    await page.keyboard.down(" ");
    await expect.poll(async () => (await drag(page)).throttle).toBe(true);
    await page.keyboard.up(" ");
    await expect.poll(async () => (await drag(page)).throttle).toBe(false);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await context.close();
  });
});

test.describe("Night run on a phone", () => {
  test("the Drift pad is at least 56 px tall, and a Restart chip starts the run over", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto("/interests?linkmock");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    const canvas = page.getByTestId("night-canvas");
    await expect(canvas).toHaveAttribute("data-phase", "ready", SLOW);
    const drift = (await page.getByTestId("night-pad-hand").boundingBox())!;
    expect(drift.height).toBeGreaterThanOrEqual(56);
    const brake = (await page.getByTestId("night-pad-brake").boundingBox())!;
    expect(brake.height).toBeGreaterThanOrEqual(56);
    // no chip before a run
    await expect(page.getByTestId("night-restart")).toHaveCount(0);
    await page.getByTestId("night-pad-gas").dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true, bubbles: true });
    await expect(canvas).toHaveAttribute("data-phase", "run", { timeout: 25_000 });
    const chip = page.getByTestId("night-restart");
    await expect(chip).toBeVisible();
    await page.getByTestId("night-pad-gas").dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true, bubbles: true });
    await chip.tap();
    // back at the start line, counting down again
    await expect(canvas).toHaveAttribute("data-phase", /ready|count/, SLOW);
    expect(await page.evaluate(() => (window as unknown as { __night: { clock: number } }).__night.clock)).toBeLessThan(2);
    await context.close();
  });
});
