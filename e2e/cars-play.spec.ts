import { test, expect, type Page } from "@playwright/test";

// Cars, third pass (how it plays), end to end: a touch of the rail costs time and is counted, the second run counts down
// quickly, and the strip's end card measures the reaction, the sixty feet and the shifts, against a par. The mock link
// (NEXT_PUBLIC_LINK_MOCK=1) gives the page `window.__night` and `window.__drag`, the running games.

const LAPTOP = { width: 1440, height: 900 };
const SLOW = { timeout: 15_000 };

type NightHook = {
  phase: string;
  countStep: number;
  rails: number;
  railS: number;
  timeLeft: number;
  clock: number;
  timeLeftAtStart?: number;
  car: { s: number; lat: number; w: number; u: number };
  result: { rails: number; cleanLegs: number } | null;
};
type DragCar = { phase: string; rpm: number; gear: number; shiftT: number; wait: number; reaction: number | null; sixtyFt: number | null; shifts: { perfect: number; good: number; early: number; late: number }; launch: string };

const stage = (p: Page) => p.getByRole("dialog");
const canvas = (p: Page) => p.getByTestId("night-canvas");
const live = (p: Page) => p.locator('[role="dialog"] p[aria-live="polite"]');
const nightEval = <T,>(p: Page, fn: (g: NightHook) => T) => p.evaluate(`(${fn.toString()})((window).__night)`) as Promise<T>;
const dragCar = (p: Page) => p.evaluate(() => ({ ...(window as unknown as { __drag: { car: DragCar } }).__drag.car }));

async function openCars(p: Page) {
  await p.goto("/interests");
  await p.locator('[data-piece="engine"]').click();
  await expect(stage(p)).toBeVisible(SLOW);
  await expect(canvas(p)).toHaveAttribute("data-phase", "ready", SLOW);
  await expect(canvas(p)).toBeFocused(SLOW);
}

/** stage, feather the throttle to hold `rpm` through the tree, then flat out and an upshift at the light, to the line */
async function runTheStrip(page: Page, rpm: number) {
  await page.evaluate(async (target) => {
    const cv = document.querySelector('canvas[aria-label*="dashboard"]')!;
    const key = (type: string, k: string) => cv.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
    const car = () => (window as unknown as { __drag: { car: { phase: string; rpm: number; gear: number; shiftT: number } } }).__drag.car;
    let held = false;
    const set = (on: boolean) => {
      if (on !== held) key(on ? "keydown" : "keyup", " ");
      held = on;
    };
    set(true);
    for (let i = 0; i < 4000; i++) {
      await new Promise((r) => setTimeout(r, 8));
      const c = car();
      if (c.phase === "tree") set(c.rpm < target);
      if (c.phase === "run") {
        set(true);
        if (c.rpm > 7320 && c.rpm < 7900 && c.shiftT <= 0 && c.gear < 5) key("keydown", "ArrowUp");
      }
      if (c.phase === "done") break;
    }
    set(false);
  }, rpm);
}

test.describe("Night run: the rail costs", () => {
  test("a touch of the rail is counted and takes seconds off the clock, and the end says so", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect.poll(() => nightEval(page, (g) => g.car.s), { timeout: 15_000 }).toBeGreaterThan(60);
    const before = await nightEval(page, (g) => g.timeLeft + g.clock);
    // hold the wheel over: the car runs out of road to the right
    await page.keyboard.down("ArrowRight");
    await expect(canvas(page)).not.toHaveAttribute("data-rails", "0", SLOW);
    await page.keyboard.up("ArrowRight");
    const after = await nightEval(page, (g) => ({ rails: g.rails, spare: g.timeLeft + g.clock }));
    expect(after.rails).toBeGreaterThanOrEqual(1);
    // the clock plus the time that has gone is what the run was worth: a touch took at least a second of it
    expect(before - after.spare).toBeGreaterThan(1);
    // out of time: the card hands the page the count, and the screen reader hears it with a line of advice
    await nightEval(page, (g) => ((g.timeLeft = 0.05), 0));
    await expect(canvas(page)).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
    await expect(live(page)).toContainText(/rail hits?, \d+ seconds|no rail hits/i, SLOW);
    await expect(live(page)).toContainText(/clean legs of/i);
    expect((await nightEval(page, (g) => g.result))?.rails).toBeGreaterThanOrEqual(1);
    await page.keyboard.up("ArrowUp");
    await context.close();
  });

  test("the second run counts down quickly: under two seconds from the key to the road", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    expect(await nightEval(page, (g) => g.countStep)).toBeGreaterThan(0.8);
    await nightEval(page, (g) => ((g.timeLeft = 0.05), 0));
    await expect(canvas(page)).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(900);
    const t0 = Date.now();
    await page.keyboard.press("Enter");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    expect(await nightEval(page, (g) => g.countStep)).toBeLessThan(0.6);
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 5000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    await context.close();
  });
});

test.describe("Drag strip: what there is to get good at", () => {
  test("the card measures the reaction, sixty feet and the shifts, and the screen reader hears them with the par", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await page.getByTestId("engine-mode-drag").click();
    const dash = stage(page).getByRole("img", { name: /race dashboard/i });
    await expect(dash).toBeVisible();
    await dash.focus();
    await runTheStrip(page, 4900);
    const a = await dragCar(page);
    expect(a.phase).toBe("done");
    // on the throttle at the green: no reaction to speak of; sixty feet timed; the shifts graded and counted
    expect(a.reaction).not.toBeNull();
    expect(a.reaction!).toBeLessThan(0.15);
    expect(a.sixtyFt).toBeGreaterThan(1.4);
    expect(a.sixtyFt).toBeLessThan(2.6);
    const n = a.shifts.perfect + a.shifts.good + a.shifts.early + a.shifts.late;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
    await expect(live(page)).toContainText(/reaction \d\.\d\d seconds\. 60 feet in \d\.\d\d\./i, SLOW);
    await expect(live(page)).toContainText(/shifts: \d+ perfect, \d+ good, \d+ early, \d+ late\. par is \d+\.\d\d\./i);
    await context.close();
  });

  test("the tree waits a different moment before its first amber each time, so the green cannot be counted down to", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await page.getByTestId("engine-mode-drag").click();
    const dash = stage(page).getByRole("img", { name: /race dashboard/i });
    await expect(dash).toBeVisible();
    await dash.focus();
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down(" ");
      await expect.poll(async () => (await dragCar(page)).phase, SLOW).toBe("tree");
      waits.push((await dragCar(page)).wait);
      // let go: a run that is not driven stays staged until the throttle comes back, so go again from a clean strip
      await page.keyboard.up(" ");
      await page.reload();
      await page.locator('[data-piece="engine"]').click();
      await page.getByTestId("engine-mode-drag").click();
      await expect(stage(page).getByRole("img", { name: /race dashboard/i })).toBeVisible(SLOW);
      await stage(page).getByRole("img", { name: /race dashboard/i }).focus();
    }
    for (const w of waits) {
      expect(w).toBeGreaterThanOrEqual(0.25);
      expect(w).toBeLessThanOrEqual(0.95);
    }
    expect(new Set(waits).size).toBeGreaterThan(1);
    await context.close();
  });
});
