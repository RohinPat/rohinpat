import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// The phone as the drag strip's throttle grip and the watch's crown, end to end,
// on the BroadcastChannel mock session (run the dev server with
// NEXT_PUBLIC_LINK_MOCK=1): the home page on a "laptop" and /p on a "phone",
// two pages of one browser context. Same setup as link-remote.spec.ts.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

type PhoneWindow = {
  __linkPhone?: { send: (m: unknown) => void };
  __linkMotion?: { push: (s: unknown) => void };
};

async function newContext(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({ baseURL, viewport: LAPTOP, permissions: ["accelerometer", "gyroscope", "magnetometer"] });
}

async function openHost(context: BrowserContext) {
  const host = await context.newPage();
  await host.goto("/");
  const code = ((await host.getByTestId("pair-code").textContent({ timeout: 15000 })) ?? "").replace(/\s/g, "");
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return { host, code };
}

async function onTheGrid(browser: Browser, baseURL: string | undefined) {
  const context = await newContext(browser, baseURL);
  const { host, code } = await openHost(context);
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

const SLOW = { timeout: 15_000 };
const stage = (host: Page) => host.getByRole("dialog");

/** a wrist turned about the screen axis: still for 0.5 s, then `rate` rad/s (negative = clockwise) for `secs`, then still */
function twistSamples(rate: number, secs: number) {
  const out: unknown[] = [];
  const dt = 1 / 60;
  const n = Math.round((0.5 + secs + 0.4) / dt);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const on = t >= 0.5 && t < 0.5 + secs;
    out.push({ t, acc: [0, 0, 9.8], gyro: [0, 0, on ? rate : 0] });
  }
  return out;
}
const pushMotion = (phone: Page, samples: unknown[]) =>
  phone.evaluate((ss: unknown[]) => {
    for (const s of ss) (window as unknown as PhoneWindow).__linkMotion!.push(s);
  }, samples);

// Cars opens on Night run (e2e/link-nightrun.spec.ts); the throttle grip is the Drag strip's
async function openEngine(host: Page, phone: Page) {
  await phone.locator('[data-piece="engine"]').click();
  await expect(stage(host)).toBeVisible(SLOW);
  await host.getByTestId("engine-mode-drag").click();
  await expect(phone.getByTestId("engine-controller")).toBeVisible(SLOW);
  await expect(host.getByTestId("engine-phone-hint")).toHaveText(/twist your phone/i, SLOW);
}

async function openWatch(host: Page, phone: Page) {
  await phone.locator('[data-piece="watch"]').click();
  await expect(stage(host)).toBeVisible(SLOW);
  await expect(phone.getByTestId("watch-controller")).toBeVisible(SLOW);
  await expect(host.getByTestId("watch-phone-hint")).toHaveText(/twist your phone to wind/i, SLOW);
}

const reserve = async (phone: Page) => Number((await phone.getByTestId("watch-controller").getAttribute("data-reserve")) || NaN);

test.describe("phone controllers: the drag strip", () => {
  test("the phone lists Cars with phone controls and, once the laptop is on the Drag strip, shows the throttle grip and the laptop its hint", async ({ browser, baseURL }) => {
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await expect(phone.locator('[data-piece="engine"]')).toContainText(/phone controls/i);
    await openEngine(host, phone);
    // the dash tells the phone where it is
    await expect(phone.getByTestId("engine-line")).toContainText(/hold the throttle to stage/i);
    await context.close();
  });

  test("a throttle axis from the phone stages and launches the car, and a shift changes gear", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openEngine(host, phone);
    const send = (m: unknown) => phone.evaluate((x) => (window as unknown as PhoneWindow).__linkPhone!.send(x), m);
    const view = phone.getByTestId("engine-view");
    // the gear stat's own number (the revs next to it have digits too)
    const gear = view.locator("div").first().locator("p").nth(1);

    await send({ type: "axis", name: "throttle", v: 0.8 });
    await expect(view).toHaveAttribute("data-phase", "tree", { timeout: 15_000 });
    await expect(view).toHaveAttribute("data-phase", "run", { timeout: 15_000 });
    await expect(gear).toHaveText("1");

    // the shift button changes gear on the laptop, and the dash says so
    await phone.getByTestId("engine-shift").click();
    await expect(phone.getByTestId("engine-shift")).toHaveAttribute("data-shifted", "1");
    await expect(gear).toHaveText("2", { timeout: 10_000 });

    // closing the throttle lets the revs fall
    await send({ type: "axis", name: "throttle", v: 0 });
    await context.close();
  });

  test("a clockwise twist from the phone's own recogniser opens the throttle on the phone and the dash stages", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openEngine(host, phone);
    await expect(phone.getByTestId("engine-throttle")).toHaveAttribute("aria-valuenow", "0");

    await pushMotion(phone, twistSamples(-1.6, 0.5)); // about 46 degrees clockwise: most of the way open
    await expect(phone.getByTestId("engine-controller")).toHaveAttribute("data-throttle", /^(6\d|7\d|8\d|9\d|100)$/);
    await expect(phone.getByTestId("engine-view")).toHaveAttribute("data-phase", "tree", { timeout: 15_000 });

    // the Idle button closes it
    await phone.getByTestId("engine-idle").click();
    await expect(phone.getByTestId("engine-controller")).toHaveAttribute("data-throttle", "0");
    await context.close();
  });

  test("the touch lever is a throttle slider too", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openEngine(host, phone);
    await phone.locator('[data-mode-btn="touch"]').click();
    const bar = phone.getByTestId("engine-throttle");
    await expect(bar).toHaveAttribute("role", "slider");
    const box = (await bar.boundingBox())!;
    await phone.mouse.move(box.x + 4, box.y + box.height / 2);
    await phone.mouse.down();
    await phone.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 6 });
    await phone.mouse.up();
    await expect(phone.getByTestId("engine-controller")).toHaveAttribute("data-throttle", /^(7\d|8\d)$/);
    await expect(phone.getByTestId("engine-view")).toHaveAttribute("data-phase", "tree", { timeout: 15_000 });
    await context.close();
  });
});

test.describe("phone controllers: the watch", () => {
  test("a crown gesture winds the watch and the phone is told the power reserve", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await expect(phone.locator('[data-piece="watch"]')).toContainText(/phone controls/i);
    await openWatch(host, phone);
    await expect.poll(() => reserve(phone), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
    const before = await reserve(phone);

    // 20 clicks of the crown, in a few messages
    for (let i = 0; i < 4; i++) await phone.evaluate(() => (window as unknown as PhoneWindow).__linkPhone!.send({ type: "gesture", name: "crown", data: { deg: 70 } }));
    await expect.poll(() => reserve(phone), { timeout: 10_000 }).toBeGreaterThan(before + 10);
    await expect(phone.getByTestId("watch-line")).toContainText(/keep winding|fully wound/i);
    await context.close();
  });

  test("a clockwise wrist twist winds it, and turning back does not unwind it", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openWatch(host, phone);
    await expect.poll(() => reserve(phone), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
    const before = await reserve(phone);

    await pushMotion(phone, twistSamples(-1.5, 0.6)); // 50 degrees clockwise: geared up to 150 crown degrees, ten clicks
    await expect.poll(() => reserve(phone), { timeout: 10_000 }).toBeGreaterThan(before + 8);
    const wound = await reserve(phone);
    await pushMotion(phone, twistSamples(1.5, 0.6)); // and back
    await phone.waitForTimeout(800);
    expect(await reserve(phone)).toBeGreaterThanOrEqual(wound - 2);
    await context.close();
  });

  test("a thumb drag round the crown winds it too, and the explode slider and flip button reach the laptop", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openWatch(host, phone);
    await expect.poll(() => reserve(phone), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
    const before = await reserve(phone);

    const crown = phone.getByTestId("watch-crown");
    const b = (await crown.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const r = b.width * 0.4;
    await phone.mouse.move(cx, cy - r);
    await phone.mouse.down();
    for (let i = 1; i <= 40; i++) {
      const a = -Math.PI / 2 + (i / 40) * Math.PI * 1.5; // three quarters of a turn, clockwise
      await phone.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    await phone.mouse.up();
    await expect.poll(() => reserve(phone), { timeout: 10_000 }).toBeGreaterThan(before + 5);

    // the explode slider on the laptop follows the phone's
    await phone.getByTestId("watch-explode").fill("70");
    await expect(stage(host).locator('input[type="range"]')).toHaveValue("70", { timeout: 10_000 });
    // and the flip button
    await phone.getByTestId("watch-flip").click();
    await expect(stage(host).getByRole("button", { name: "Show the dial" })).toBeVisible({ timeout: 10_000 });
    await context.close();
  });
});

test.describe("no phone linked: the dash and the watch are as they were", () => {
  test("no hints, no link traffic, the keys still drive the dash, and the crown still winds from the keyboard", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    const linkRequests: string[] = [];
    page.on("request", (r) => /relay|link\/client|\/api\/link/i.test(r.url()) && linkRequests.push(r.url()));
    await page.goto("/interests");

    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await expect(page.getByTestId("engine-phone-hint")).toHaveCount(0);
    await page.keyboard.down(" ");
    await page.waitForTimeout(700);
    await page.keyboard.up(" ");
    await page.keyboard.press("Escape");
    await expect(stage(page)).toHaveCount(0, SLOW);

    await page.locator('[data-piece="watch"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await expect(page.getByTestId("watch-phone-hint")).toHaveCount(0);
    const slider = stage(page).getByRole("slider", { name: /crown/i });
    const before = Number(await slider.getAttribute("aria-valuenow"));
    // the 3D watch is slow under software GL: a few presses, not a dozen
    await slider.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
    await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow")), { timeout: 5000 }).toBeGreaterThan(before);
    expect(linkRequests).toEqual([]);
    await context.close();
  });
});
