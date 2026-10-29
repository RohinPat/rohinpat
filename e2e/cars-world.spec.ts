import { test, expect, type Page } from "@playwright/test";

// Cars, third pass, end to end: the world has to draw all the way down the road
// (the tunnel's mouth, the bridge's towers, the gates, the finish) at both
// sizes and with reduced motion, the Drag strip has to draw its place, the
// middle of the screen carries one message at a time, and the coach speaks on
// the first run of a visit and not after. The mock link (NEXT_PUBLIC_LINK_MOCK=1)
// gives the page `window.__night` and `window.__drag`, the running games.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

type Toast = { text: string; slot: string; age: number };
type NightHook = {
  phase: string;
  car: { s: number; lat: number; psi: number; u: number; w: number; r: number };
  timeLeft: number;
  cp: number;
  firstRun: boolean;
  coach: string;
  coachT: number;
  toasts: Toast[];
  road: { checks: number[]; finish: number; flags: Uint8Array; segM: number };
  scene: { cam: { fresh: boolean } };
  toast(text: string, sub: string, tone: string, life?: number): void;
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

async function startRun(p: Page) {
  await p.keyboard.down("ArrowUp");
  await expect(canvas(p)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
  await p.keyboard.up("ArrowUp");
}

for (const [name, viewport, reducedMotion] of [
  ["a laptop", LAPTOP, "no-preference"],
  ["a phone", PHONE, "no-preference"],
  ["a laptop with reduced motion", LAPTOP, "reduce"],
] as const) {
  test.describe(`Night run: the world (${name})`, () => {
    test("draws every stretch of the canyon without an error: the start, the tunnel, the bridge, the gates and the finish", async ({ browser, baseURL }) => {
      test.setTimeout(90_000);
      const context = await browser.newContext({ baseURL, viewport, reducedMotion, hasTouch: viewport === PHONE, isMobile: viewport === PHONE });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await openCars(page);
      await startRun(page);
      // find the tunnel and the bridge from the road's own flags, then stand the car in front of, in and past each
      const spots = await nightEval(page, (g) => {
        const r = g.road;
        let tun = -1;
        let bri = -1;
        for (let i = 0; i < r.flags.length; i++) {
          if (tun < 0 && r.flags[i] & 1) tun = i * r.segM;
          if (bri < 0 && r.flags[i] & 2) bri = i * r.segM;
        }
        return { tun, bri, checks: r.checks, finish: r.finish };
      });
      expect(spots.tun).toBeGreaterThan(0);
      expect(spots.bri).toBeGreaterThan(0);
      const places = [40, 400, spots.tun - 30, spots.tun + 90, spots.tun + 230, spots.bri - 20, spots.bri + 75, ...spots.checks.map((c: number) => c - 45), spots.finish + 120];
      for (const s of places) {
        await nightEval(page, (g) => g.toasts.splice(0, g.toasts.length) && 0);
        await page.evaluate(
          (S) => {
            const g = (window as unknown as { __night: NightHook }).__night;
            g.car.s = S;
            g.car.u = 38;
            g.car.lat = 0;
            g.car.psi = 0;
            g.car.w = 0;
            g.car.r = 0;
            g.timeLeft = 999;
            g.scene.cam.fresh = true;
          },
          s,
        );
        await page.waitForTimeout(160);
      }
      // the canvas is still the game's, and nothing threw
      await expect(canvas(page)).toHaveAttribute("data-quality", /^[0-3]$/);
      expect(errors).toEqual([]);
      await context.close();
    });
  });
}

test.describe("Night run: one message at a time", () => {
  test("two messages in the middle of the road are shown one after the other, never together", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await startRun(page);
    await nightEval(page, (g) => {
      g.toasts.splice(0, g.toasts.length);
      g.toast("CHECKPOINT 1 OF 8", "+29.5 SECONDS", "good", 2);
      g.toast("COMBO LOST", "-170", "bad", 1.6);
      return 0;
    });
    let most = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const showing = await nightEval(page, (g) => g.toasts.filter((t) => t.slot === "main" && t.age >= 0).map((t) => t.text));
      most = Math.max(most, showing.length);
      showing.forEach((t) => seen.add(t));
      await page.waitForTimeout(100);
    }
    expect(most).toBe(1);
    // both were shown, one after the other
    expect(Array.from(seen).sort()).toEqual(["CHECKPOINT 1 OF 8", "COMBO LOST"]);
    await context.close();
  });
});

test.describe("Night run: the coach", () => {
  test("speaks on the first run of a visit and not on the next", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    expect(await nightEval(page, (g) => g.firstRun)).toBe(true);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect.poll(() => nightEval(page, (g) => g.coach), SLOW).toBe("steer");
    // end the run, and start another
    await nightEval(page, (g) => ((g.timeLeft = 0.05), 0));
    await page.keyboard.up("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
    await page.waitForTimeout(900);
    await page.keyboard.press("Enter");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    expect(await nightEval(page, (g) => g.firstRun)).toBe(false);
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await page.waitForTimeout(2500);
    expect(await nightEval(page, (g) => g.coachT)).toBe(0);
    await context.close();
  });
});

for (const [name, viewport] of [["a laptop", LAPTOP], ["a phone", PHONE]] as const) {
  test(`Drag strip: draws its place (${name}) and stages on the throttle`, async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport, hasTouch: viewport === PHONE, isMobile: viewport === PHONE });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await openCars(page);
    await page.getByTestId("engine-mode-drag").click();
    const dash = stage(page).getByRole("img", { name: /race dashboard/i });
    await expect(dash).toBeFocused();
    // the picture has a sky, a wall and asphalt: the top of it is not the plain ink it was, the lanes are not the carbon
    const px = async (fx: number, fy: number) =>
      dash.evaluate(
        (el, [x, y]) => {
          const c = el as HTMLCanvasElement;
          const d = c.getContext("2d")!.getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1).data;
          return [d[0], d[1], d[2]];
        },
        [fx, fy],
      );
    await page.waitForTimeout(500);
    const sky = await px(0.5, 0.18);
    expect(sky[1]).toBeGreaterThan(sky[0] - 1);
    await page.keyboard.down(" ");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __drag: { car: { phase: string } } }).__drag.car.phase), SLOW).toBe("tree");
    await page.waitForTimeout(1200);
    await page.keyboard.up(" ");
    expect(errors).toEqual([]);
    await context.close();
  });
}
