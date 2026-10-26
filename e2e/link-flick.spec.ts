import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { genFlick } from "../tests/unit/lab-swing-traces";

// The phone as the basketball and penalty controllers, end to end, on the
// BroadcastChannel mock session (run the dev server with NEXT_PUBLIC_LINK_MOCK=1):
// the home page on a "laptop" and /p on a "phone", two pages of one context.
// The laptop's reply is read back off the phone (the score and the kick's
// result come back as gestures), so a shot that "happened" really round-tripped.
//
// FLICK_SHOTS=<dir> also writes 2x screenshots of the controllers and hints.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SHOTS = process.env.FLICK_SHOTS;
const SLOW = { timeout: 15_000 };

type PhoneWindow = {
  __linkPhone?: { send: (m: unknown) => void };
  __linkMotion?: { push: (s: unknown) => void };
};

async function newContext(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({ baseURL, viewport: LAPTOP, deviceScaleFactor: SHOTS ? 2 : 1, permissions: ["accelerometer", "gyroscope", "magnetometer"] });
}

async function onTheGrid(browser: Browser, baseURL: string | undefined) {
  const context = await newContext(browser, baseURL);
  const host = await context.newPage();
  await host.goto("/");
  const code = ((await host.getByTestId("pair-code").textContent({ timeout: 15000 })) ?? "").replace(/\s/g, "");
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
const status = (host: Page) => host.locator('[role="dialog"] p[aria-live="polite"]');

async function openGame(host: Page, phone: Page, piece: "hoops" | "penalty") {
  await phone.locator(`[data-piece="${piece}"]`).click();
  await expect(stage(host)).toBeVisible(SLOW);
  await expect(phone.getByTestId(`${piece}-controller`)).toBeVisible(SLOW);
  await expect(host.getByTestId(`${piece}-phone-hint`)).toBeVisible(SLOW);
}

async function shot(page: Page | Locator, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/**
 * A quick drag on the phone, as a thumb would make it: ~130 ms from the ball,
 * `bend` bows the middle sideways (px, - = left). Dispatched inside the page on
 * a timer so a busy dev server can't stretch it into a slow drag.
 */
async function swipe(phone: Page, pad: Locator, o: { dx?: number; rise: number; bend?: number; fromY?: number }) {
  await pad.evaluate(
    async (el, a) => {
      const r = el.getBoundingClientRect();
      const x0 = r.left + r.width / 2, y0 = r.top + r.height * a.fromY;
      const fire = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
      fire("pointerdown", x0, y0);
      const n = 12;
      for (let i = 1; i <= n; i++) {
        await new Promise((res) => setTimeout(res, 10));
        const u = i / n;
        fire(i === n ? "pointerup" : "pointermove", x0 + a.dx * u + a.bend * Math.sin(Math.PI * u), y0 - a.rise * u);
      }
    },
    { dx: o.dx ?? 0, bend: o.bend ?? 0, rise: o.rise, fromY: o.fromY ?? 0.8 },
  );
  void phone;
}

test.describe("phone controllers: basketball", () => {
  test("a flick from the phone's recogniser shoots, and the score comes back; the touch fallback swipes", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGame(host, phone, "hoops");
    await expect(phone.getByTestId("hoops-controller")).toHaveAttribute("data-mode", "flick");
    await expect(host.getByTestId("hoops-phone-hint")).toHaveText(/flick your phone/i);
    await expect(phone.getByTestId("hoops-game")).toContainText("0:30");
    await shot(phone, "hoops-phone-flick");
    await shot(host, "hoops-laptop-hint");

    // the phone's own recogniser turns real flick motion into the gesture
    const { samples } = genFlick(11);
    await phone.evaluate((ss: unknown[]) => {
      for (const s of ss) (window as unknown as PhoneWindow).__linkMotion!.push(s);
    }, samples);
    await expect(phone.getByTestId("hoops-last")).toContainText(/Last shot: power \d+%/, { timeout: 5000 });
    // ...and the laptop took the shot and said so: one shot, and the clock is running
    await expect(phone.getByTestId("hoops-game")).toContainText("of 1", SLOW);
    await shot(phone, "hoops-phone-after-flick");

    // with no sensor data the controller says so and offers the swipe instead
    await expect(phone.getByTestId("hoops-nosensor")).toBeVisible({ timeout: 6000 });
    await expect(phone.getByTestId("hoops-controller")).toHaveAttribute("data-mode", "touch");
    await expect(phone.getByTestId("hoops-pad")).toBeVisible();

    // a gesture straight off the wire shoots too (a second ball after the first has landed)
    await phone.waitForTimeout(2800);
    await swipe(phone, phone.getByTestId("hoops-pad"), { rise: 220 });
    await expect(phone.getByTestId("hoops-game")).toContainText(/of [2-9]/, SLOW);
    await shot(phone, "hoops-phone-touch");
    await context.close();
  });

  test("the swipe mode button and the laptop's keyboard coexist; a too-slow swipe is told so", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGame(host, phone, "hoops");
    await phone.locator('[data-mode-btn="touch"]').click();
    const pad = phone.getByTestId("hoops-pad");
    await expect(pad).toBeVisible();
    // a slow drag isn't a shot
    const box = (await pad.boundingBox())!;
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
    await phone.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await phone.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8 - i * 12);
      await phone.waitForTimeout(250);
    }
    await phone.mouse.up();
    await expect(phone.getByTestId("hoops-note")).toBeVisible();
    await expect(phone.getByTestId("hoops-last")).toHaveText(/first shot starts the clock/);

    // the laptop's own keys still shoot with a phone linked: the phone hears how that shot ended
    await stage(host).locator("canvas").focus();
    await host.keyboard.down("Space");
    await host.waitForTimeout(500);
    await host.keyboard.up("Space");
    await expect(phone.getByTestId("hoops-game")).toContainText("of 1", { timeout: 8000 });
    await context.close();
  });
});

test.describe("phone controllers: penalty", () => {
  test("a swipe on the phone is a kick on the laptop, and the result comes back", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGame(host, phone, "penalty");
    const pad = phone.getByTestId("penalty-pad");
    await expect(pad).toBeVisible();
    await expect(phone.getByTestId("penalty-controller")).toHaveAttribute("data-phase", "aim");
    await shot(phone, "penalty-phone-ready");
    await shot(host, "penalty-laptop-hint");

    // mid-swipe: the finger's trail is drawn
    const box = (await pad.boundingBox())!;
    const x0 = box.x + box.width / 2, y0 = box.y + box.height * 0.8;
    await phone.mouse.move(x0, y0);
    await phone.mouse.down();
    for (let i = 1; i <= 8; i++) await phone.mouse.move(x0 + i * 6, y0 - i * 22);
    await shot(phone, "penalty-phone-swiping");
    await phone.mouse.up();

    await expect(phone.getByTestId("penalty-controller")).toHaveAttribute("data-phase", "busy");
    await expect(phone.getByTestId("penalty-mark")).toBeVisible();
    // the laptop played it: its caption names the kick and the score, and the phone is told too
    await expect(status(host)).toContainText(/from 1\./, { timeout: 25_000 });
    await expect(phone.getByTestId("penalty-result")).toBeVisible({ timeout: 5000 });
    await shot(phone, "penalty-phone-result");
    await expect(phone.locator('[data-kick="G"], [data-kick="S"], [data-kick="M"], [data-kick="P"]')).toHaveCount(1);
    // and then it is the phone's turn again
    await expect(phone.getByTestId("penalty-controller")).toHaveAttribute("data-phase", "aim", { timeout: 15_000 });
    await context.close();
  });

  test("a bent swipe curls, and a picked kick is that kick", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGame(host, phone, "penalty");
    const pad = phone.getByTestId("penalty-pad");
    const pill = (name: RegExp) => stage(host).getByRole("button", { name });

    // bows left in the middle and finishes straight: it turns clockwise, so the ball bends right
    await swipe(phone, pad, { rise: 230, bend: -70 });
    await expect(pill(/Curl ↷/)).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
    await expect(phone.getByTestId("penalty-last")).toContainText(/Curl right/);
    await expect(phone.getByTestId("penalty-controller")).toHaveAttribute("data-phase", "aim", { timeout: 25_000 });

    await swipe(phone, pad, { rise: 230, bend: 70 });
    await expect(pill(/Curl ↶/)).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
    await expect(phone.getByTestId("penalty-controller")).toHaveAttribute("data-phase", "aim", { timeout: 25_000 });

    // forcing a kick ignores the bend
    await phone.locator('[data-shot="panenka"]').click();
    await expect(phone.locator('[data-shot="panenka"]')).toHaveAttribute("aria-pressed", "true");
    await swipe(phone, pad, { rise: 230, bend: 70 });
    await expect(pill(/Panenka/)).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
    await expect(phone.getByTestId("penalty-last")).toContainText(/Panenka/);
    await context.close();
  });

  test("a tap or a slow drag is told off, and sends nothing", async ({ browser, baseURL }) => {
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGame(host, phone, "penalty");
    const pad = phone.getByTestId("penalty-pad");
    const box = (await pad.boundingBox())!;
    await phone.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8);
    await expect(phone.getByTestId("penalty-note")).toBeVisible();
    await expect(phone.getByTestId("penalty-controller")).toHaveAttribute("data-phase", "aim");
    await expect(phone.getByTestId("penalty-last")).toHaveText(/No kicks yet/);
    await context.close();
  });
});

test.describe("no phone linked: both games are exactly as they were", () => {
  for (const piece of ["hoops", "penalty"] as const) {
    test(`${piece}: no hint, no link traffic, and the pointer still plays it`, async ({ browser, baseURL }) => {
      test.setTimeout(60_000);
      const context = await newContext(browser, baseURL);
      const page = await context.newPage();
      const linkRequests: string[] = [];
      page.on("request", (r) => /relay|link\/client|\/api\/link/i.test(r.url()) && linkRequests.push(r.url()));
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/interests");
      await page.locator(`[data-piece="${piece}"]`).click();
      await expect(stage(page)).toBeVisible(SLOW);
      await expect(page.getByTestId(`${piece}-phone-hint`)).toHaveCount(0);

      const box = (await stage(page).locator("canvas").boundingBox())!;
      const x = box.x + box.width / 2;
      await page.waitForTimeout(600);
      if (piece === "hoops") {
        const y = box.y + box.height * 0.8;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - i * 40);
        await page.mouse.up();
        await page.waitForTimeout(1500);
      } else {
        await page.mouse.move(x, box.y + box.height * 0.4);
        await page.mouse.down();
        await page.waitForTimeout(500);
        await page.mouse.up();
        await expect(status(page)).toContainText(/from 1\./, { timeout: 25_000 });
      }
      expect(linkRequests).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});
