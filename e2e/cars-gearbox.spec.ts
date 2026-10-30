import { test, expect, type Page } from "@playwright/test";
import { pairCode } from "./pair-code";

// Night run's manual gearbox, end to end: an upshift in the green window pays (the dash says SHIFT, the car gets a boost), an
// early one does not, and a downshift with the handbrake held is a clutch kick that starts a slide. The phone's paddles are the
// same rules. The mock link (NEXT_PUBLIC_LINK_MOCK=1) gives the page `window.__night`, the running game.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

type Hook = {
  phase: string;
  shiftFlash: number;
  timeLeft: number;
  drift: { sliding: boolean; combo: number };
  shift: (d: 1 | -1) => void;
  car: { s: number; lat: number; psi: number; u: number; w: number; r: number; gear: number; rpm: number; pedal: number; shiftT: number; holdT: number; hand: number; boostT: number; kickT: number; slip: number; auto: boolean };
};
const stage = (p: Page) => p.getByRole("dialog");
const canvas = (p: Page) => p.getByTestId("night-canvas");
const nightEval = <T,>(p: Page, fn: (g: Hook) => T) => p.evaluate(`(${fn.toString()})((window).__night)`) as Promise<T>;

async function openCars(p: Page) {
  await p.goto("/interests");
  await p.locator('[data-piece="engine"]').click();
  await expect(stage(p)).toBeVisible(SLOW);
  await expect(canvas(p)).toHaveAttribute("data-phase", "ready", SLOW);
  await expect(canvas(p)).toBeFocused(SLOW);
}

/** start a run by hand-box and get it up to speed: the keys' gas held */
async function runningManual(p: Page) {
  await p.getByTestId("night-manual").click();
  await p.keyboard.down("ArrowUp");
  await expect(canvas(p)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
  await expect.poll(async () => Number(await canvas(p).getAttribute("data-speed")), { timeout: 15_000 }).toBeGreaterThan(30);
}

/** put the car in second at 46 m/s on the opening straight, so the revs sit in the window (and drift up slowly) */
const inTheWindow = (p: Page) =>
  nightEval(p, (g) => {
    const c = g.car;
    c.s = 40;
    c.lat = 0;
    c.psi = 0;
    c.w = 0;
    c.r = 0;
    c.gear = 2;
    c.u = 46;
    c.rpm = 7400;
    c.pedal = 1;
    c.shiftT = 0;
    c.holdT = 0;
    g.timeLeft = 999;
    return c.rpm;
  });

test.describe("Night run: the manual gearbox pays", () => {
  test("a shift in the green window says SHIFT and boosts; an early one does not", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await runningManual(page);
    // early: second at 40 m/s is 6,400 rpm
    await nightEval(page, (g) => {
      const c = g.car;
      c.s = 40;
      c.lat = 0;
      c.psi = 0;
      c.w = 0;
      c.gear = 2;
      c.u = 40;
      c.rpm = 6400;
      c.pedal = 1;
      c.shiftT = 0;
      c.holdT = 0;
      g.timeLeft = 999;
      return 0;
    });
    await page.keyboard.press("e");
    expect(await nightEval(page, (g) => g.car.boostT)).toBe(0);
    expect(await nightEval(page, (g) => g.shiftFlash)).toBe(0);
    await page.waitForTimeout(900);
    // in the window: E
    await inTheWindow(page);
    await page.keyboard.press("e");
    await expect.poll(() => nightEval(page, (g) => g.shiftFlash), { timeout: 3000 }).toBeGreaterThan(0.2);
    await expect.poll(() => nightEval(page, (g) => g.car.boostT), { timeout: 3000 }).toBeGreaterThan(0.05);
    // and it goes
    await expect.poll(() => nightEval(page, (g) => g.shiftFlash), { timeout: 3000 }).toBe(0);
    await page.keyboard.up("ArrowUp");
    await context.close();
  });

  test("a downshift with the handbrake held is a clutch kick: the tail comes round and the slide counts", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await runningManual(page);
    await nightEval(page, (g) => {
      const c = g.car;
      c.s = 40;
      c.lat = 0;
      c.psi = 0;
      c.w = 0;
      c.r = 0;
      c.gear = 3;
      c.u = 36;
      c.shiftT = 0;
      c.holdT = 0;
      g.timeLeft = 999;
      return 0;
    });
    await page.keyboard.down("Shift");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(60);
    await page.keyboard.press("q");
    await expect.poll(() => nightEval(page, (g) => g.car.kickT), { timeout: 3000 }).toBeGreaterThan(0);
    await expect.poll(() => nightEval(page, (g) => Math.abs(g.car.slip)), { timeout: 3000 }).toBeGreaterThan(0.25);
    await page.keyboard.up("Shift");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowUp");
    await context.close();
  });

  test("the phone's paddles are the same rules", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP, permissions: ["accelerometer", "gyroscope", "magnetometer"] });
    const host = await context.newPage();
    await host.goto("/");
    const code = await pairCode(host);
    const phone = await context.newPage();
    await phone.setViewportSize(PHONE);
    await phone.goto(`/p#c=${code}`);
    await phone.getByTestId("connect").click();
    await expect(phone.getByTestId("phone-live")).toBeVisible();
    await expect(host.getByTestId("link-pill")).toBeVisible();
    await phone.getByTestId("phone-unlock").click();
    await expect(phone.getByTestId("phone-home")).toBeVisible();
    await phone.locator('[data-app="offhours"]').click();
    await host.waitForURL("**/interests");
    await phone.locator('[data-piece="engine"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await expect(phone.getByTestId("night-controller")).toBeVisible(SLOW);
    await expect(phone.getByTestId("night-controller")).toHaveAttribute("data-mode", "touch", { timeout: 12_000 });
    await expect(canvas(host)).toHaveAttribute("data-phase", "ready", SLOW);
    await phone.evaluate(() => (window as unknown as { __linkPhone: { send: (m: unknown) => void } }).__linkPhone.send({ type: "axis", name: "gas", v: 1 }));
    await expect(canvas(host)).toHaveAttribute("data-phase", "run", { timeout: 25_000 });
    await expect.poll(async () => Number(await canvas(host).getAttribute("data-speed")), { timeout: 15_000 }).toBeGreaterThan(25);
    await phone.getByTestId("night-auto").click();
    await expect(host.getByTestId("night-manual")).toHaveAttribute("aria-pressed", "true", SLOW);
    await expect(phone.getByTestId("night-up")).toBeVisible();
    await inTheWindow(host);
    await phone.getByTestId("night-up").click();
    await expect.poll(() => nightEval(host, (g) => g.car.boostT), { timeout: 5000 }).toBeGreaterThan(0.01);
    await context.close();
  });
});
