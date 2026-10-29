import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Cars, second polish pass, end to end: the keys must still work after a click
// on one of the game's own switches, the strip must keep your best run as a
// ghost, a medal must be announced, reduced motion must switch off the camera
// kicks and the skid marks, and the stage must scan clean with either game up.
// The mock link (NEXT_PUBLIC_LINK_MOCK=1) gives the page `window.__night` and
// `window.__drag`, the running games.

const LAPTOP = { width: 1440, height: 900 };
const SLOW = { timeout: 15_000 };

type NightHook = {
  phase: string;
  car: { s: number; lat: number; psi: number; u: number; w: number };
  bonusPoints: number;
  timeLeft: number;
  medals: number;
  scene: { reduce: boolean; cam: { kick: number; lean: number }; fx: { markN: number } };
};

const stage = (p: Page) => p.getByRole("dialog");
const canvas = (p: Page) => p.getByTestId("night-canvas");
const nightEval = <T,>(p: Page, fn: (g: NightHook) => T) => p.evaluate(`(${fn.toString()})((window).__night)`) as Promise<T>;

async function openCars(p: Page) {
  await p.goto("/interests");
  await p.locator('[data-piece="engine"]').click();
  await expect(stage(p)).toBeVisible(SLOW);
  await expect(canvas(p)).toHaveAttribute("data-phase", "ready", SLOW);
  await expect(canvas(p)).toBeFocused(SLOW);
}

test.describe("Cars: the keys follow the clicks", () => {
  test("a click on the mode switch or the gearbox switch leaves the game's keys working", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);

    // the gearbox switch: the arrow keys still start the run afterwards
    await page.getByTestId("night-manual").click();
    await expect(canvas(page)).toBeFocused();
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    await page.keyboard.up("ArrowUp");

    // the mode switch: Space revs the strip without a click on it first
    await page.getByTestId("engine-mode-drag").click();
    const dash = stage(page).getByRole("img", { name: /race dashboard/i });
    await expect(dash).toBeFocused();
    await page.keyboard.down(" ");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __drag: { car: { rpm: number } } }).__drag.car.rpm), { timeout: 5000 }).toBeGreaterThan(3000);
    await page.keyboard.up(" ");

    // and back: the road has the keys again
    await page.getByTestId("engine-mode-night").click();
    await expect(canvas(page)).toBeFocused(SLOW);
    await context.close();
  });
});

test.describe("Drag strip: your best run races you", () => {
  test("a finished run is kept as the ghost, a slower one does not replace it", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await page.getByTestId("engine-mode-drag").click();
    const dash = stage(page).getByRole("img", { name: /race dashboard/i });
    await expect(dash).toBeFocused();

    // stage, hold the revs near the mark through the tree, flat out, shift at the light, to the line
    const run = (rpm: number) =>
      page.evaluate(async (target) => {
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
            if (c.rpm > 7320 && c.shiftT <= 0 && c.gear < 5) key("keydown", "ArrowUp");
          }
          if (c.phase === "done") break;
        }
        set(false);
      }, rpm);
    const ghost = () =>
      page.evaluate(() => {
        const g = (window as unknown as { __drag: { ghost: Float32Array | null } }).__drag.ghost;
        return g ? { n: g.length, last: g[g.length - 1], mid: g[Math.floor(g.length / 2)] } : null;
      });

    expect(await ghost()).toBeNull();
    await run(4900);
    const first = await ghost();
    expect(first).not.toBeNull();
    // about eleven seconds at twenty samples a second, ending on the line
    expect(first!.n).toBeGreaterThan(150);
    expect(first!.n).toBeLessThan(400);
    expect(first!.last).toBeGreaterThan(402);
    expect(first!.mid).toBeGreaterThan(100);

    await page.waitForTimeout(800);
    await page.keyboard.down(" ");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __drag: { car: { phase: string } } }).__drag.car.phase), { timeout: 5000 }).not.toBe("done");
    await page.keyboard.up(" ");
    // too many revs at the green: wheelspin, a slower run: the first stays the best
    await run(7000);
    expect(await ghost()).toEqual(first);
    await context.close();
  });
});

test.describe("Night run: medals and reduced motion", () => {
  test("a medal is announced to the screen reader the moment the score reaches it", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await nightEval(page, (g) => ((g.bonusPoints = 21_000), 0));
    await expect(page.locator('[role="dialog"] p[aria-live="polite"]')).toContainText(/medal: bronze/i, SLOW);
    expect(await nightEval(page, (g) => g.medals)).toBe(1);
    await page.keyboard.up("ArrowUp");
    await context.close();
  });

  test("with reduced motion the lens does not kick, the camera does not lean and no marks are laid", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP, reducedMotion: "reduce" });
    const page = await context.newPage();
    await openCars(page);
    expect(await nightEval(page, (g) => g.scene.reduce)).toBe(true);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    // launch, a slide and a hard stop, sampling the camera all the way
    await nightEval(page, (g) => ((g.car.u = 38), (g.car.lat = 0), (g.car.psi = 0), 0));
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("Shift");
    let kick = 0;
    let lean = 0;
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(60);
      const s = await nightEval(page, (g) => ({ k: g.scene.cam.kick, l: g.scene.cam.lean }));
      kick = Math.max(kick, s.k);
      lean = Math.max(lean, Math.abs(s.l));
    }
    await page.keyboard.up("Shift");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowUp");
    expect(kick).toBe(0);
    expect(lean).toBe(0);
    expect(await nightEval(page, (g) => g.scene.fx.markN)).toBe(0);
    await context.close();
  });
});

test.describe("Cars: the stage scans clean", () => {
  for (const mode of ["night", "drag"] as const) {
    test(`${mode === "night" ? "Night run" : "Drag strip"} has no detectable WCAG A/AA violations`, async ({ browser, baseURL }) => {
      test.setTimeout(60_000);
      const context = await browser.newContext({ baseURL, viewport: LAPTOP, reducedMotion: "reduce" });
      const page = await context.newPage();
      await openCars(page);
      if (mode === "drag") await page.getByTestId("engine-mode-drag").click();
      await page.waitForTimeout(1200);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`);
      expect(summary, summary.join("\n")).toEqual([]);
      await context.close();
    });
  }
});
