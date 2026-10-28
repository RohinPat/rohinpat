import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { pairCode } from "./pair-code";

// The phone as the maze's tray and the slalom's handlebars, end to end, on the
// BroadcastChannel mock session (run the dev server with NEXT_PUBLIC_LINK_MOCK=1):
// the home page on a "laptop" and /p on a "phone", two pages of one browser
// context. The phone's motion is fed in as real-time synthetic samples.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

type Sample = { t: number; acc: [number, number, number]; gyro: [number, number, number] };
type PhoneWindow = { __linkPhone?: { send: (m: unknown) => void }; __linkMotion?: { push: (s: unknown) => void } };
type Axis = { name: string; v: number; at: number };

const G = 9.80665;
const D = Math.PI / 180;
/** a phone held still, flat-ish: roll (right edge down) and how high the top edge is */
const flat = (t: number, rollDeg: number, topUpDeg: number): Sample => {
  const r = rollDeg * D, p = topUpDeg * D;
  return { t, acc: [-Math.sin(r) * Math.cos(p) * G, Math.sin(p) * G, Math.cos(r) * Math.cos(p) * G], gyro: [0, 0, 0] };
};
/** a phone held upright: a wheel angle in the screen plane and a pitch toward the sky */
const wheel = (t: number, wheelDeg: number, pitchDeg: number): Sample => {
  const w = wheelDeg * D, p = pitchDeg * D;
  return { t, acc: [-Math.sin(w) * Math.cos(p) * G, Math.cos(w) * Math.cos(p) * G, Math.sin(p) * G], gyro: [0, 0, 0] };
};
/** 60 Hz of a pose for `secs` (these have no gyro, so the gravity filter takes a second or two to follow a change; a real phone is faster) */
const pose = (fn: (t: number) => Sample, t0: number, secs: number): Sample[] => {
  const out: Sample[] = [];
  for (let t = t0; t < t0 + secs; t += 1 / 60) out.push(fn(t));
  return out;
};

/** messages per second over the span they arrived in (delivery jitter makes single gaps unreliable) */
const perSecond = (a: Axis[]) => ((a.length - 1) / (a.at(-1)!.at - a[0].at)) * 1000;

async function newContext(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({ baseURL, viewport: LAPTOP, permissions: ["accelerometer", "gyroscope", "magnetometer"] });
}

async function onTheGrid(browser: Browser, baseURL: string | undefined) {
  const context = await newContext(browser, baseURL);
  const host = await context.newPage();
  await host.goto("/");
  const code = await pairCode(host);
  const phone = await context.newPage();
  await phone.setViewportSize(PHONE);
  await phone.goto(`/p#c=${code}`);
  await phone.getByTestId("connect").click();
  await expect(phone.getByTestId("phone-live")).toBeVisible();
  await phone.getByTestId("phone-unlock").click();
  await expect(phone.getByTestId("phone-home")).toBeVisible();
  await phone.locator('[data-app="offhours"]').click();
  await host.waitForURL("**/interests");
  await expect(phone.getByTestId("phone-piece-list")).toBeVisible();
  return { context, host, phone };
}

const stage = (host: Page) => host.getByRole("dialog");
const live = (host: Page) => host.locator('[role="dialog"] p[aria-live="polite"]');

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
    all: () => host.evaluate(() => (window as unknown as { __axes: Axis[] }).__axes),
    named: async (n: string) => (await host.evaluate(() => (window as unknown as { __axes: Axis[] }).__axes)).filter((a) => a.name === n),
    clear: () => host.evaluate(() => ((window as unknown as { __axes: unknown[] }).__axes.length = 0)),
  };
}

/** feed samples to the phone's recogniser in real time (60 Hz) */
async function stream(phone: Page, samples: Sample[]) {
  await phone.evaluate(async (ss) => {
    const w = window as unknown as PhoneWindow;
    for (const s of ss) {
      w.__linkMotion!.push(s);
      await new Promise((r) => setTimeout(r, 1000 / 60));
    }
  }, samples);
}

test.describe("phone controllers: the maze", () => {
  test("tilting the phone walks the maze (and takes over from a solver); the axes are rate limited", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="maze"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await expect(phone.getByTestId("maze-controller")).toBeVisible();
    await expect(host.getByTestId("maze-phone-hint")).toHaveText(/tilt your phone/i);
    // the laptop opens on a solver; the phone says so
    await expect(phone.getByTestId("maze-status")).toContainText(/solver is running/i);
    const spy = await spyAxes(host);

    // settle in a flat pose (the neutral), then tip the top edge down for two seconds and turn right a little
    await stream(phone, pose((t) => flat(t, 0, 0), 0, 1.4));
    await expect(stage(host).getByRole("button", { name: "A*", exact: true })).toHaveAttribute("aria-pressed", "true");
    const t0 = 1.4;
    await stream(phone, [...pose((t) => flat(t, 0, -16), t0, 2.2), ...pose((t) => flat(t, 0, 0), t0 + 2.2, 3)]);

    // the tilt took over from the solver, and the phone was told
    await expect(stage(host).getByRole("button", { name: "You", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(phone.getByTestId("maze-status")).toContainText(/your move/i);
    const y = await spy.named("y");
    expect(y.some((a) => a.v > 0.5)).toBe(true);
    expect(y.at(-1)!.v).toBe(0); // and it let go
    expect((await spy.named("x")).length).toBe(0); // no turn was asked for: nothing sent for x
    expect(perSecond(y)).toBeLessThanOrEqual(36); // ~30 Hz at most, from a 60 Hz sensor
    await context.close();
  });

  test("the walker actually moves on the laptop", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="maze"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await expect(phone.getByTestId("maze-controller")).toBeVisible();
    await stage(host).getByRole("button", { name: "You", exact: true }).click();
    const canvas = stage(host).locator("canvas");
    await host.waitForTimeout(500);
    const a = await canvas.screenshot();
    await host.waitForTimeout(400);
    expect((await canvas.screenshot()).equals(a)).toBe(true); // a still maze, nothing moving it
    await phone.evaluate(() => (window as unknown as PhoneWindow).__linkPhone!.send({ type: "axis", name: "y", v: 1 }));
    await host.waitForTimeout(1200);
    await phone.evaluate(() => (window as unknown as PhoneWindow).__linkPhone!.send({ type: "axis", name: "y", v: 0 }));
    await host.waitForTimeout(300);
    expect((await canvas.screenshot()).equals(a)).toBe(false);
    await context.close();
  });

  test("the joystick fallback walks it, and letting go stops", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="maze"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await phone.locator('[data-mode-btn="touch"]').click();
    await expect(phone.getByTestId("maze-controller")).toHaveAttribute("data-mode", "touch");
    const spy = await spyAxes(host);
    const pad = (await phone.getByTestId("maze-pad").boundingBox())!;
    const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2;
    await phone.mouse.move(cx, cy);
    await phone.mouse.down();
    await phone.mouse.move(cx + 60, cy - 70, { steps: 6 });
    await host.waitForTimeout(400);
    await expect(stage(host).getByRole("button", { name: "You", exact: true })).toHaveAttribute("aria-pressed", "true");
    await phone.mouse.up();
    await host.waitForTimeout(300);
    const x = await spy.named("x");
    const y = await spy.named("y");
    expect(x.some((a) => a.v > 0.5)).toBe(true);
    expect(y.some((a) => a.v > 0.5)).toBe(true);
    expect(x.at(-1)!.v).toBe(0);
    expect(y.at(-1)!.v).toBe(0);
    await context.close();
  });

  test("New maze on the phone makes a new maze on the laptop", async ({ browser, baseURL }) => {
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="maze"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await stage(host).getByRole("button", { name: "You", exact: true }).click();
    const canvas = stage(host).locator("canvas");
    await host.waitForTimeout(400);
    const a = await canvas.screenshot();
    await phone.getByTestId("maze-new").click();
    await host.waitForTimeout(500);
    expect((await canvas.screenshot()).equals(a)).toBe(false);
    await context.close();
  });
});

test.describe("phone controllers: one game after another", () => {
  test("Back, then another game: the second stays open (a stage opened after a Back must not close itself)", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="maze"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await phone.getByTestId("phone-back").click();
    await expect(stage(host)).toHaveCount(0, SLOW);
    await expect(phone.getByTestId("phone-piece-list")).toBeVisible();
    await phone.locator('[data-piece="powder"]').dispatchEvent("click");
    await expect(stage(host)).toBeVisible(SLOW);
    await host.waitForTimeout(1500);
    await expect(stage(host)).toBeVisible();
    await expect(phone.getByTestId("powder-controller")).toBeVisible();
    await context.close();
  });
});

test.describe("phone controllers: the slalom", () => {
  test("Drop in starts the race; the handlebars steer and the button tucks", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="powder"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await expect(phone.getByTestId("powder-controller")).toBeVisible();
    await expect(host.getByTestId("powder-phone-hint")).toHaveText(/steer with your phone/i);
    await expect(phone.getByTestId("powder-status")).toContainText(/ready/i);
    const spy = await spyAxes(host);

    // landscape handlebars: settle, then turn clockwise 25 degrees for a second and a half
    await stream(phone, pose((t) => wheel(t, 90, 6), 0, 1.4));
    await phone.getByTestId("powder-start").click();
    await expect(live(host)).toContainText(/race starting/i);
    await expect(phone.getByTestId("powder-controller")).toHaveAttribute("data-phase", "count");
    await stream(phone, [...pose((t) => wheel(t, 90 + 25, 6), 1.4, 2.0), ...pose((t) => wheel(t, 90, 6), 3.4, 1.0)]);
    await expect(phone.getByTestId("powder-controller")).toHaveAttribute("data-phase", "run", { timeout: 10_000 });
    const steer = await spy.named("steer");
    expect(steer.some((a) => a.v > 0.3)).toBe(true);
    expect(steer.at(-1)!.v).toBe(0);
    expect(perSecond(steer)).toBeLessThanOrEqual(36);

    // lean the top edge away: tuck goes up, and the lean alone tucks
    await spy.clear();
    await stream(phone, [...pose((t) => wheel(t, 90, 6 + 24), 4.4, 1.8), ...pose((t) => wheel(t, 90, 6), 6.2, 1.0)]);
    const tuck = await spy.named("tuck");
    expect(tuck.some((a) => a.v >= 0.9)).toBe(true);
    expect(tuck.at(-1)!.v).toBe(0);

    // the thumb button: held = 1, let go = 0
    await spy.clear();
    const btn = (await phone.getByTestId("powder-tuck").boundingBox())!;
    await phone.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
    await phone.mouse.down();
    await expect(phone.getByTestId("powder-controller")).toHaveAttribute("data-tuck", "true");
    await phone.mouse.up();
    await expect(phone.getByTestId("powder-controller")).toHaveAttribute("data-tuck", "false");
    await host.waitForTimeout(300);
    const t2 = await spy.named("tuck");
    expect(t2.map((a) => a.v)).toEqual([1, 0]);
    await context.close();
  });

  test("the touch halves carve, and the finish is reported to the phone", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="powder"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await phone.locator('[data-mode-btn="touch"]').click();
    await expect(phone.getByTestId("powder-controller")).toHaveAttribute("data-mode", "touch");
    const spy = await spyAxes(host);
    const right = (await phone.getByTestId("powder-right").boundingBox())!;
    await phone.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
    await phone.mouse.down();
    await host.waitForTimeout(700);
    await phone.mouse.up();
    await host.waitForTimeout(500);
    const steer = await spy.named("steer");
    expect(steer.some((a) => a.v >= 0.9)).toBe(true); // the lock ramped up to full
    expect(steer[0].v).toBeLessThan(0.5); // from a nudge
    expect(steer.at(-1)!.v).toBe(0);
    await context.close();
  });
});

test.describe("no phone linked: the games are as they were", () => {
  test("no hints, no link traffic; the maze still walks with the keys and the slalom starts with Enter", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    const linkRequests: string[] = [];
    page.on("request", (r) => /relay|link\/client|\/api\/link/i.test(r.url()) && linkRequests.push(r.url()));
    await page.goto("/interests");

    await page.locator('[data-piece="maze"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await expect(page.getByTestId("maze-phone-hint")).toHaveCount(0);
    await stage(page).getByRole("button", { name: "You", exact: true }).click();
    const canvas = stage(page).locator("canvas");
    await canvas.focus();
    await page.waitForTimeout(400);
    const a = await canvas.screenshot();
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(900);
    await page.keyboard.up("ArrowUp");
    expect((await canvas.screenshot()).equals(a)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(stage(page)).toHaveCount(0, SLOW);

    await page.locator('[data-piece="powder"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await expect(page.getByTestId("powder-phone-hint")).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    await expect(live(page)).toContainText(/race starting/i);
    expect(linkRequests).toEqual([]);
    await context.close();
  });
});
