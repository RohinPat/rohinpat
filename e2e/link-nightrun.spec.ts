import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { pairCode } from "./pair-code";

// Cars: Night run and the Drag strip, end to end. The keys, the checkpoints and
// the end screen with no phone at all; then the phone as a steering wheel with
// gas and brake pads, on the BroadcastChannel mock session (run the dev server
// with NEXT_PUBLIC_LINK_MOCK=1): the home page on a "laptop" and /p on a
// "phone", two pages of one browser context. The mock link also gives the page
// `window.__night`, the running game, which these tests use to put the car
// somewhere (a few metres short of a gate) rather than drive 700 m by keys.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

type Sample = { t: number; acc: [number, number, number]; gyro: [number, number, number] };
type Axis = { name: string; v: number; at: number };
type NightHook = {
  phase: string;
  car: { s: number; lat: number; psi: number; u: number; w: number; gear: number; auto: boolean; handT: number; hand: number; brake: number; pedal: number; delta: number; shiftT: number; holdT: number };
  timeLeft: number;
  cp: number;
  hitN: number;
  score: number;
  drift: { base: number; combo: number; sliding: boolean; total: number };
  road: { checks: number[]; finish: number };
};
type Win = { __night?: NightHook; __linkPhone?: { send: (m: unknown) => void }; __linkMotion?: { push: (s: unknown) => void }; __buzz?: number[][] };

const G = 9.80665;
const D = Math.PI / 180;
/** a phone held upright: a wheel angle in the screen plane and a pitch toward the sky */
const wheel = (t: number, wheelDeg: number, pitchDeg: number): Sample => {
  const w = wheelDeg * D, p = pitchDeg * D;
  return { t, acc: [-Math.sin(w) * Math.cos(p) * G, Math.cos(w) * Math.cos(p) * G, Math.sin(p) * G], gyro: [0, 0, 0] };
};
const pose = (fn: (t: number) => Sample, t0: number, secs: number): Sample[] => {
  const out: Sample[] = [];
  for (let t = t0; t < t0 + secs; t += 1 / 60) out.push(fn(t));
  return out;
};
const perSecond = (a: Axis[]) => ((a.length - 1) / (a.at(-1)!.at - a[0].at)) * 1000;

async function newContext(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({ baseURL, viewport: LAPTOP, permissions: ["accelerometer", "gyroscope", "magnetometer"] });
}

async function onTheGrid(browser: Browser, baseURL: string | undefined) {
  const context = await newContext(browser, baseURL);
  // count what the phone's buzzer is asked for
  await context.addInitScript(() => {
    const w = window as unknown as Win;
    w.__buzz = [];
    navigator.vibrate = ((p: VibratePattern) => {
      w.__buzz!.push(Array.isArray(p) ? p : [p]);
      return true;
    }) as typeof navigator.vibrate;
  });
  const host = await context.newPage();
  await host.goto("/");
  const code = await pairCode(host);
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
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
  await expect(phone.getByTestId("phone-piece-list")).toBeVisible();
  return { context, host, phone };
}

const stage = (host: Page) => host.getByRole("dialog");
const live = (host: Page) => host.locator('[role="dialog"] p[aria-live="polite"]');
const canvas = (host: Page) => host.getByTestId("night-canvas");
const attr = async (host: Page, name: string) => Number((await canvas(host).getAttribute(`data-${name}`)) ?? NaN);
const nightEval = <T,>(host: Page, fn: (g: NightHook) => T) => host.evaluate(`(${fn.toString()})((window).__night)`) as Promise<T>;

async function openNight(host: Page, phone: Page) {
  await phone.locator('[data-piece="engine"]').click();
  await expect(stage(host)).toBeVisible(SLOW);
  await expect(phone.getByTestId("night-controller")).toBeVisible(SLOW);
  await expect(host.getByTestId("night-phone-hint")).toHaveText(/steer with your phone/i, SLOW);
}

/** record every axis message the phone sends (the mock channel is broadcast, so the laptop page can listen in) */
async function spyAxes(host: Page) {
  await host.evaluate(() => {
    const w = window as unknown as { __axes: unknown[] };
    w.__axes = [];
    const ch = new BroadcastChannel("phone-link-mock:v1");
    ch.onmessage = (e) => {
      const d = e.data as { k?: string; m?: { type?: string; name?: string; v?: number } };
      if (d.k === "msg" && d.m?.type === "axis") w.__axes.push({ name: d.m.name, v: d.m.v, at: performance.now() });
    };
  });
  return {
    named: async (n: string) => (await host.evaluate(() => (window as unknown as { __axes: Axis[] }).__axes)).filter((a) => a.name === n),
    clear: () => host.evaluate(() => ((window as unknown as { __axes: unknown[] }).__axes.length = 0)),
  };
}

/** feed samples to the phone's recogniser in real time (60 Hz) */
async function stream(phone: Page, samples: Sample[]) {
  await phone.evaluate(async (ss) => {
    const w = window as unknown as Win;
    for (const s of ss) {
      w.__linkMotion!.push(s);
      await new Promise((r) => setTimeout(r, 1000 / 60));
    }
  }, samples);
}
const send = (phone: Page, m: unknown) => phone.evaluate((x) => (window as unknown as Win).__linkPhone!.send(x), m);

/** the stage focuses the game once it has grown in: keys before that go nowhere */
async function startRun(host: Page) {
  await expect(canvas(host)).toHaveAttribute("data-phase", "ready", SLOW);
  await expect(canvas(host)).toBeFocused(SLOW);
}

test.describe("Night run: the keyboard", () => {
  test("opens on Night run with its how-to; holding the gas counts down, starts the run and moves the car", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    const linkRequests: string[] = [];
    page.on("request", (r) => /relay|link\/client|\/api\/link/i.test(r.url()) && linkRequests.push(r.url()));
    await page.goto("/interests");
    // the tile is the attract mode: a canvas that moves with nothing pressed
    const tile = page.locator('[data-piece="engine"]');
    await tile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const a = await tile.screenshot();
    await page.waitForTimeout(700);
    expect((await tile.screenshot()).equals(a)).toBe(false);

    await tile.click();
    await expect(stage(page)).toBeVisible(SLOW);
    await expect(stage(page).getByRole("heading", { name: "Night run" })).toBeVisible();
    await expect(page.getByTestId("night-phone-hint")).toHaveCount(0);
    await startRun(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    expect(await attr(page, "speed")).toBe(0);
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", SLOW);
    await expect.poll(() => attr(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(30);
    expect(await attr(page, "dist")).toBeGreaterThan(20);
    expect(await attr(page, "time")).toBeLessThan(33);
    await page.keyboard.up("ArrowUp");
    // braking slows it
    const fast = await attr(page, "speed");
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(1200);
    await page.keyboard.up("ArrowDown");
    expect(await attr(page, "speed")).toBeLessThan(fast);
    expect(linkRequests).toEqual([]);
    await context.close();
  });

  test("steering keys turn the car, and a slide banks as score once the car is straight", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await startRun(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect.poll(() => attr(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(25);
    // the left key moves the car left of where it was
    const lat0 = await nightEval(page, (g) => g.car.lat);
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(350);
    await page.keyboard.up("ArrowLeft");
    await page.waitForTimeout(500);
    expect(await nightEval(page, (g) => g.car.lat)).toBeLessThan(lat0 - 0.15);
    // a slide in progress banks when the keys let go: put one on the board and drive straight
    await nightEval(page, (g) => {
      g.drift.base = 400;
      g.drift.combo = 3;
      g.drift.sliding = true;
      g.car.lat = 0;
      g.car.psi = 0;
      return 0;
    });
    const before = await attr(page, "score");
    await expect.poll(() => attr(page, "score"), { timeout: 8000 }).toBeGreaterThan(before + 1000);
    await page.keyboard.up("ArrowUp");
    await context.close();
  });

  test("Shift is the handbrake: it kicks the tail out and the slide counts", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await startRun(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect.poll(() => attr(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(25);
    // steer into it and pull the handbrake
    await nightEval(page, (g) => ((g.car.u = 38), (g.car.lat = 0), 0));
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(250);
    await page.keyboard.down("Shift");
    let widest = 0;
    for (let i = 0; i < 14; i++) {
      widest = Math.max(widest, Math.abs(await nightEval(page, (g) => Math.atan2(g.car.w, Math.max(g.car.u, 0.5)))));
      if (i === 5) await page.keyboard.up("Shift");
      await page.waitForTimeout(60);
    }
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowUp");
    expect(widest).toBeGreaterThan(0.12);
    await context.close();
  });

  test("a gate adds time and is announced; running out of time ends the run with the score read out; Enter drives again", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await startRun(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect.poll(() => attr(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(20);
    const left = await attr(page, "time");
    await nightEval(page, (g) => {
      g.car.s = g.road.checks[0] - 8;
      g.car.u = 38;
      g.car.lat = 0;
      g.car.psi = 0;
      return 0;
    });
    await expect.poll(() => attr(page, "cp"), { timeout: 8000 }).toBe(1);
    await expect(live(page)).toContainText(/checkpoint 1 of 8/i);
    expect(await attr(page, "time")).toBeGreaterThan(left + 12);
    expect(await attr(page, "score")).toBeGreaterThanOrEqual(500);
    // out of time
    await nightEval(page, (g) => ((g.timeLeft = 0.3), 0));
    await expect(canvas(page)).toHaveAttribute("data-phase", "done", { timeout: 15_000 });
    await expect(live(page)).toContainText(/out of time.*distance.*miles.*best drift.*total score/i);
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(900); // the end screen ignores a key for a moment, so a held gas cannot restart it
    await page.keyboard.press("Enter");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    await context.close();
  });

  test("the finish line ends the run as a finish, and the best run is kept for the ghost", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await startRun(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect.poll(() => attr(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(20);
    await nightEval(page, (g) => {
      g.car.s = g.road.finish - 8;
      g.car.u = 38;
      g.car.lat = 0;
      g.car.psi = 0;
      return 0;
    });
    await expect(canvas(page)).toHaveAttribute("data-phase", "done", { timeout: 15_000 });
    await expect(live(page)).toContainText(/made it out of the canyon/i);
    await page.keyboard.up("ArrowUp");
    await context.close();
  });
});

test.describe("Drag strip", () => {
  test("is still there: the mode switch opens the quarter mile, Space revs it, and Night run comes back", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await page.getByTestId("engine-mode-drag").click();
    await expect(page.getByTestId("engine-mode-drag")).toHaveAttribute("aria-pressed", "true");
    const dash = stage(page).getByRole("img", { name: /race dashboard/i });
    await expect(dash).toBeVisible();
    await dash.focus();
    await page.waitForTimeout(400);
    const a = await dash.screenshot();
    await page.keyboard.down(" ");
    await page.waitForTimeout(900);
    const b = await dash.screenshot();
    await page.keyboard.up(" ");
    expect(b.equals(a)).toBe(false);
    await page.getByTestId("engine-mode-night").click();
    await expect(canvas(page)).toBeVisible();
    await context.close();
  });

  test("the phone's throttle runs every run of a set, its Run again button goes on to the next, and after the set card to a new set", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openNight(host, phone);
    await host.getByTestId("engine-mode-drag").click();
    await expect(phone.getByTestId("engine-controller")).toBeVisible(SLOW);
    type Hook = { __drag: { car: { phase: string; x: number; v: number }; set: { cond: { shift: number }; runs: unknown[] }; par: number } };
    const state = () => host.evaluate(() => ({ phase: (window as unknown as Hook).__drag.car.phase, runs: (window as unknown as Hook).__drag.set.runs.length, shift: (window as unknown as Hook).__drag.set.cond.shift, par: (window as unknown as Hook).__drag.par }));
    const first = await state();
    // the phone opens the throttle, the car stages and runs (put near the line to save the wait), and the phone is told it is done
    const finish = async () => {
      await send(phone, { type: "axis", name: "throttle", v: 0.9 });
      await expect.poll(async () => (await state()).phase, { timeout: 20_000 }).toBe("run");
      await host.evaluate(() => {
        const c = (window as unknown as Hook).__drag.car;
        c.x = 395;
        c.v = 50;
      });
      await expect.poll(async () => (await state()).phase, SLOW).toBe("done");
      await send(phone, { type: "axis", name: "throttle", v: 0 });
      await expect(phone.getByTestId("engine-view")).toHaveAttribute("data-phase", "done", SLOW);
    };
    for (let n = 1; n <= 3; n++) {
      await finish();
      expect((await state()).runs).toBe(n);
      await host.waitForTimeout(1200);
      if (n < 3) {
        await expect(live(host)).toContainText(new RegExp(`^Run ${n} of 3\\.`));
        await phone.getByTestId("engine-again").click();
        await expect.poll(async () => (await state()).phase, SLOW).toBe("idle");
        expect((await state()).shift).toBe(first.shift);
      }
    }
    await expect(live(host)).toContainText(/^Set done\./);
    // the phone's Run again on the set card begins a new set: other conditions, other par
    await phone.getByTestId("engine-again").click();
    await expect.poll(async () => (await state()).runs, SLOW).toBe(0);
    const next = await state();
    expect(next.phase).toBe("idle");
    expect(next.shift).not.toBe(first.shift);
    expect(next.par).not.toBe(first.par);
    await context.close();
  });
});

test.describe("Night run: the phone as the wheel", () => {
  test("the laptop shows the hint, the phone shows the wheel controller, and steer, gas and brake axes drive the car", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await expect(phone.locator('[data-piece="engine"]')).toContainText(/phone controls/i);
    await openNight(host, phone);
    await startRun(host);
    await expect(phone.getByTestId("night-status")).toContainText(/hold gas to start/i, SLOW);

    // the gas pad starts the run and the car moves
    const gas = (await phone.getByTestId("night-gas").boundingBox())!;
    await phone.mouse.move(gas.x + gas.width / 2, gas.y + gas.height / 2);
    await phone.mouse.down();
    await expect(phone.getByTestId("night-controller")).toHaveAttribute("data-gas", "true");
    await expect(canvas(host)).toHaveAttribute("data-phase", "count", SLOW);
    await expect(canvas(host)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect.poll(() => attr(host, "speed"), { timeout: 15_000 }).toBeGreaterThan(25);
    // and the phone is told: speed, the clock
    await expect.poll(async () => Number(await phone.getByTestId("night-speed").evaluate((e) => parseInt(e.textContent ?? "0", 10))), { timeout: 8000 }).toBeGreaterThan(20);
    await expect(phone.getByTestId("night-controller")).toHaveAttribute("data-phase", "run");
    expect(parseFloat((await phone.getByTestId("night-time").textContent()) ?? "0")).toBeGreaterThan(5);

    // the steer axis turns the car: right, then left
    await nightEval(host, (g) => ((g.car.lat = 0), (g.car.psi = 0), 0));
    await send(phone, { type: "axis", name: "steer", v: 0.8 });
    await expect.poll(() => nightEval(host, (g) => g.car.psi), { timeout: 5000 }).toBeGreaterThan(0.015);
    await send(phone, { type: "axis", name: "steer", v: -0.8 });
    await expect.poll(() => nightEval(host, (g) => g.car.psi), { timeout: 5000 }).toBeLessThan(-0.015);
    await send(phone, { type: "axis", name: "steer", v: 0 });

    // the brake axis slows it, and lets go
    await phone.mouse.up();
    await send(phone, { type: "axis", name: "gas", v: 0 });
    const fast = await attr(host, "speed");
    await send(phone, { type: "axis", name: "brake", v: 1 });
    await expect.poll(() => nightEval(host, (g) => g.car.brake), { timeout: 5000 }).toBeGreaterThan(0.5);
    await host.waitForTimeout(1200);
    expect(await attr(host, "speed")).toBeLessThan(fast - 8);
    await send(phone, { type: "axis", name: "brake", v: 0 });
    await context.close();
  });

  test("a flick or the Drift button is the handbrake, and the paddles shift by hand", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openNight(host, phone);
    // no sensors in the test browser: let the controller settle into its touch layout before aiming at buttons
    await expect(phone.getByTestId("night-controller")).toHaveAttribute("data-mode", "touch", { timeout: 12_000 });
    await startRun(host);
    await send(phone, { type: "axis", name: "gas", v: 1 });
    await expect(canvas(host)).toHaveAttribute("data-phase", "run", { timeout: 25_000 });
    await expect.poll(() => attr(host, "speed"), { timeout: 15_000 }).toBeGreaterThan(20);

    // a handbrake gesture (what a flick sends) puts the handbrake on the car
    await nightEval(host, (g) => ((g.car.handT = 99), 0));
    await send(phone, { type: "gesture", name: "night-handbrake", data: { ms: 300 } });
    await expect.poll(() => nightEval(host, (g) => g.car.handT), { timeout: 5000 }).toBeLessThan(1);
    // the Drift button holds it while down (once the flick's has let go)
    await host.waitForTimeout(700);
    await expect(phone.getByTestId("night-hand")).toBeVisible();
    await nightEval(host, (g) => ((g.car.handT = 99), 0));
    const hand = (await phone.getByTestId("night-hand").boundingBox())!;
    await phone.mouse.move(hand.x + hand.width / 2, hand.y + hand.height / 2);
    await phone.mouse.down();
    await expect(phone.getByTestId("night-controller")).toHaveAttribute("data-hand", "true");
    await expect.poll(() => nightEval(host, (g) => g.car.handT), { timeout: 5000 }).toBeLessThan(1);
    await phone.mouse.up();
    await send(phone, { type: "axis", name: "gas", v: 0 });

    // manual: the phone's switch flips the laptop's, and the paddles change gear
    await phone.getByTestId("night-auto").click();
    await expect(host.getByTestId("night-manual")).toHaveAttribute("aria-pressed", "true", SLOW);
    await expect(phone.getByTestId("night-up")).toBeVisible();
    await expect.poll(() => nightEval(host, (g) => g.car.shiftT + g.car.holdT), { timeout: 5000 }).toBe(0);
    const gear = await nightEval(host, (g) => g.car.gear);
    await phone.getByTestId("night-up").click();
    await expect.poll(() => nightEval(host, (g) => g.car.gear), { timeout: 5000 }).toBe(Math.min(5, gear + 1));
    await expect.poll(() => nightEval(host, (g) => g.car.auto), { timeout: 5000 }).toBe(false);
    await context.close();
  });

  test("the phone's own wheel recogniser steers: a clockwise turn is a steer axis, rate limited, that lets go", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openNight(host, phone);
    const spy = await spyAxes(host);
    // landscape: settle for the neutral, turn clockwise 25 degrees for two seconds, then back
    await stream(phone, pose((t) => wheel(t, 90, 6), 0, 1.4));
    await stream(phone, [...pose((t) => wheel(t, 90 + 25, 6), 1.4, 2.4), ...pose((t) => wheel(t, 90, 6), 3.8, 2.6)]);
    const steer = await spy.named("steer");
    expect(steer.some((a) => a.v > 0.3)).toBe(true);
    expect(steer.at(-1)!.v).toBe(0);
    expect(perSecond(steer)).toBeLessThanOrEqual(36);
    await context.close();
  });

  test("with no motion data the steer halves take over, and they steer", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openNight(host, phone);
    // nothing arrives from the sensors: the controller falls back to touch, and says so
    await expect(phone.getByTestId("night-controller")).toHaveAttribute("data-mode", "touch", { timeout: 12_000 });
    await expect(phone.getByTestId("night-status")).toContainText(/no motion data/i);
    const spy = await spyAxes(host);
    const right = (await phone.getByTestId("night-right").boundingBox())!;
    await phone.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
    await phone.mouse.down();
    await host.waitForTimeout(700);
    await phone.mouse.up();
    await host.waitForTimeout(500);
    const steer = await spy.named("steer");
    expect(steer.some((a) => a.v >= 0.9)).toBe(true);
    expect(steer[0].v).toBeLessThan(0.6);
    expect(steer.at(-1)!.v).toBe(0);
    await context.close();
  });

  test("the phone buzzes at a checkpoint and on a hit", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openNight(host, phone);
    await startRun(host);
    await send(phone, { type: "axis", name: "gas", v: 1 });
    await expect(canvas(host)).toHaveAttribute("data-phase", "run", { timeout: 25_000 });
    await expect.poll(() => attr(host, "speed"), { timeout: 15_000 }).toBeGreaterThan(20);
    const buzzes = () => phone.evaluate(() => (window as unknown as Win).__buzz!.filter((p) => p.length > 1 || p[0] >= 90).length);
    await expect(phone.getByTestId("night-time")).not.toHaveText("–");
    const before = await buzzes();
    await nightEval(host, (g) => ((g.car.s = g.road.checks[0] - 8), (g.car.u = 38), (g.car.lat = 0), (g.car.psi = 0), 0));
    await expect.poll(buzzes, { timeout: 8000 }).toBeGreaterThan(before);
    const afterGate = await buzzes();
    // and a rail: drive into it
    await nightEval(host, (g) => ((g.car.lat = 4.4), (g.car.psi = 0.35), (g.car.u = 38), 0));
    await send(phone, { type: "axis", name: "steer", v: 1 });
    await expect.poll(() => attr(host, "hits"), { timeout: 8000 }).toBeGreaterThan(0);
    await expect.poll(buzzes, { timeout: 8000 }).toBeGreaterThan(afterGate);
    await send(phone, { type: "axis", name: "steer", v: 0 });
    await context.close();
  });

  test("the phone follows the laptop's mode: Drag strip gets the throttle grip, Night run the wheel", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openNight(host, phone);
    await host.getByTestId("engine-mode-drag").click();
    await expect(phone.getByTestId("engine-controller")).toBeVisible(SLOW);
    await expect(phone.getByTestId("night-controller")).toHaveCount(0);
    await expect(host.getByTestId("engine-phone-hint")).toHaveText(/twist your phone/i);
    await expect(host.getByTestId("night-phone-hint")).toHaveCount(0);
    await host.getByTestId("engine-mode-night").click();
    await expect(phone.getByTestId("night-controller")).toBeVisible(SLOW);
    await expect(host.getByTestId("night-phone-hint")).toBeVisible();
    // and the phone's messages reach whichever game is showing, after the round trip too
    await send(phone, { type: "axis", name: "gas", v: 1 });
    await expect(canvas(host)).toHaveAttribute("data-phase", "count", SLOW);
    await send(phone, { type: "axis", name: "gas", v: 0 });
    await context.close();
  });
});

type DragCar = { phase: string; rpm: number; gear: number; t: number; call: string; launch: string; launchRpm: number; trap: number; best: number | null; vsBest: number | null; doneT: number };
const dragCar = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __drag: { car: DragCar } }).__drag.car }));

/**
 * Drive the strip in the page, the way a player with good hands would: stage, feather the throttle to
 * hold `rpm` through the tree, then flat out and an upshift at the light. Runs until the line.
 */
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
        if (c.rpm > 7320 && c.shiftT <= 0 && c.gear < 5) key("keydown", "ArrowUp");
      }
      if (c.phase === "done") break;
    }
    set(false);
  }, rpm);
}

test.describe("Drag strip: the launch and the end card", () => {
  test("the launch counts: the revs at the green set the call, and the card keeps the best of the visit", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await page.getByTestId("engine-mode-drag").click();
    const dash = stage(page).getByRole("img", { name: /race dashboard/i });
    await expect(dash).toBeVisible();
    await dash.focus();

    // a launch in the band, near the mark
    await runTheStrip(page, 4900);
    const a = await dragCar(page);
    expect(a.phase).toBe("done");
    expect(a.launch).toMatch(/^(PERFECT|GREAT) LAUNCH$/);
    expect(a.launchRpm).toBeGreaterThan(4400);
    expect(a.launchRpm).toBeLessThan(5400);
    expect(a.trap).toBeGreaterThan(120);
    expect(a.vsBest).toBeNull();
    // the sr-only line says the whole of it
    await expect(live(page)).toContainText(/quarter mile in \d+\.\d\d seconds at \d+ mph.*launch: (perfect|great) launch/i);

    // the line is not skipped by a key that was still down, then the throttle runs it again, best kept
    await page.waitForTimeout(800);
    await page.keyboard.down(" ");
    await expect.poll(async () => (await dragCar(page)).phase, { timeout: 5000 }).not.toBe("done");
    await page.keyboard.up(" ");
    expect((await dragCar(page)).best).toBeCloseTo(a.best!, 5);
    await expect(live(page)).toHaveText("");

    // the second run too many revs: wheelspin, and slower
    await runTheStrip(page, 7000);
    const b = await dragCar(page);
    expect(b.phase).toBe("done");
    expect(b.launch).toBe("WHEELSPIN");
    expect(b.vsBest).toBeGreaterThan(0.1);
    expect(b.best).toBeCloseTo(a.best!, 5);
    await context.close();
  });

  test("on a phone the shift lights are not under the mode switch", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').tap();
    await expect(stage(page)).toBeVisible(SLOW);
    await page.getByTestId("engine-mode-drag").tap();
    const dash = stage(page).getByRole("img", { name: /race dashboard/i });
    await expect(dash).toBeVisible();
    // the lights are drawn at y = 62 in the dash's own pixels, the switch ends at 12 + 32
    const [sw, cv] = await Promise.all([page.getByRole("group", { name: "Mode" }).boundingBox(), dash.boundingBox()]);
    expect(sw!.y + sw!.height).toBeLessThan(cv!.y + 62 - 8);
    await context.close();
  });
});

test.describe("Night run on a phone-sized touch screen", () => {
  test("every pad is on the screen, gas included, and the gas pad starts the run", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    for (const width of [360, 390]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 800 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      await page.goto("/interests");
      await page.locator('[data-piece="engine"]').tap();
      await expect(stage(page)).toBeVisible(SLOW);
      await startRun(page);
      const cv = (await canvas(page).boundingBox())!;
      for (const id of ["left", "right", "brake", "hand", "gas"]) {
        const b = (await page.getByTestId(`night-pad-${id}`).boundingBox())!;
        expect(b.x, `${id} at ${width}`).toBeGreaterThanOrEqual(cv.x);
        expect(b.x + b.width, `${id} at ${width}`).toBeLessThanOrEqual(cv.x + cv.width + 0.5);
        expect(b.y + b.height, `${id} at ${width}`).toBeLessThanOrEqual(cv.y + cv.height + 0.5);
      }
      // the pads do not sit on one another
      const boxes = await Promise.all(["left", "right", "brake", "hand", "gas"].map((id) => page.getByTestId(`night-pad-${id}`).boundingBox()));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          const apart = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
          expect(apart, `pads ${i} and ${j} at ${width}`).toBe(true);
        }
      await page.getByTestId("night-pad-gas").tap();
      await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
      await context.close();
    }
  });
});

test.describe("no phone linked: Night run is as it was", () => {
  test("no hint, no link traffic, the keys drive it", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    const linkRequests: string[] = [];
    page.on("request", (r) => /relay|link\/client|\/api\/link/i.test(r.url()) && linkRequests.push(r.url()));
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await expect(page.getByTestId("night-phone-hint")).toHaveCount(0);
    await expect(page.getByTestId("engine-phone-hint")).toHaveCount(0);
    await startRun(page);
    await page.keyboard.down(" ");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    await page.keyboard.up(" ");
    expect(linkRequests).toEqual([]);
    await context.close();
  });
});
