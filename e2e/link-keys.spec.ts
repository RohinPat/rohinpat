import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

// The phone as the keyboard board's keyboard and the music board's turntable,
// end to end, on the BroadcastChannel mock session (run the dev server with
// NEXT_PUBLIC_LINK_MOCK=1): the home page on a "laptop" and /p on a "phone".
// Set SHOTS to a folder to also save 2x screenshots of both ends.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SHOTS = process.env.SHOTS;

type PhoneWindow = {
  __linkPhone?: { send: (m: unknown) => void };
  __linkMotion?: { push: (s: unknown) => void };
};

async function onTheGrid(browser: Browser, baseURL: string | undefined) {
  const context: BrowserContext = await browser.newContext({
    baseURL,
    viewport: LAPTOP,
    deviceScaleFactor: SHOTS ? 2 : 1,
    permissions: ["accelerometer", "gyroscope", "magnetometer"],
  });
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

const SLOW = { timeout: 15_000 };
const stage = (host: Page) => host.getByRole("dialog");

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
}

async function openPiece(host: Page, phone: Page, id: string, controller: string, hint: string) {
  await phone.locator(`[data-piece="${id}"]`).click();
  await expect(stage(host)).toBeVisible(SLOW);
  await expect(phone.getByTestId(controller)).toBeVisible(SLOW);
  await expect(host.getByTestId(hint)).toBeVisible(SLOW);
}

test.describe("phone controllers: keyboards", () => {
  test("typing on the phone's field types on the laptop's board, and the hint shows", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openPiece(host, phone, "keyboard", "keyboard-controller", "keyboard-phone-hint");
    await expect(host.getByTestId("keyboard-phone-hint")).toHaveText(/type on your phone/i);
    await expect(phone.getByText("Tap here to type")).toBeVisible();
    await shot(phone, "keys-phone-idle.png");

    await phone.getByTestId("keyboard-input").click();
    await expect(phone.getByTestId("keyboard-controller")).toHaveAttribute("data-focused", "true");
    await phone.keyboard.type("Hi!");
    await expect(stage(host).getByText(/HI!/)).toBeVisible(SLOW);
    await expect(phone.getByTestId("keyboard-echo")).toHaveText(/Hi!/);
    await expect(phone.getByTestId("keyboard-last")).toContainText(/Keys sent\s*3/i);

    // backspace takes one off, and a backspace with nothing typed is still a key
    await phone.keyboard.press("Backspace");
    await expect(stage(host).getByText(/HI/)).toBeVisible(SLOW);
    await expect(phone.getByTestId("keyboard-echo")).toHaveText(/^Hi▍?$/);
    await phone.keyboard.press("Backspace");
    await phone.keyboard.press("Backspace");
    await phone.keyboard.press("Backspace"); // on an empty field
    await expect(phone.getByTestId("keyboard-last")).toContainText("Delete");
    await expect(phone.getByTestId("keyboard-last")).toContainText(/Keys sent\s*7/i);
    await phone.keyboard.type("go now");
    await expect(stage(host).getByText(/GO NOW/)).toBeVisible(SLOW);
    await phone.keyboard.press("Enter");
    await expect(phone.getByTestId("keyboard-last")).toContainText("Return");
    await shot(phone, "keys-phone-typing.png");
    await shot(host, "keys-laptop-hint.png");

    // the laptop's own typing is untouched
    await host.keyboard.press("Escape");
    await expect(stage(host)).toHaveCount(0, SLOW);
    await expect(phone.getByTestId("phone-piece-list")).toBeVisible();
    await context.close();
  });

  test("an IME-style composition sends each character once, and the Done button closes the keyboard", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openPiece(host, phone, "keyboard", "keyboard-controller", "keyboard-phone-hint");
    await phone.getByTestId("keyboard-toggle").click();
    await expect(phone.getByTestId("keyboard-controller")).toHaveAttribute("data-focused", "true");
    await expect(phone.getByTestId("keyboard-toggle")).toHaveText("Done typing");
    // a predictive keyboard inserting a whole word at once
    await phone.getByTestId("keyboard-input").evaluate((el: HTMLInputElement) => {
      el.value = `${el.value}tap `;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "tap ", inputType: "insertText" }));
    });
    await expect(stage(host).getByText(/TAP/)).toBeVisible(SLOW);
    await expect(phone.getByTestId("keyboard-last")).toContainText(/Keys sent\s*4/i);
    await phone.getByTestId("keyboard-toggle").click();
    await expect(phone.getByTestId("keyboard-controller")).toHaveAttribute("data-focused", "false");
    await context.close();
  });
});

test.describe("no phone linked: the keyboard board is exactly as it was", () => {
  test("no hint, and physical keys still type", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="keyboard"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await expect(page.getByTestId("keyboard-phone-hint")).toHaveCount(0);
    await stage(page).locator('[role="application"]').focus();
    await page.keyboard.type("abc");
    await expect(stage(page).getByText(/ABC/)).toBeVisible(SLOW);
    await context.close();
  });
});

const platterBox = async (phone: Page) => (await phone.getByTestId("decks-platter").boundingBox())!;
const rate = async (host: Page) => Number(await stage(host).locator("canvas").first().getAttribute("data-rate"));
const grabbed = (host: Page) => stage(host).locator("canvas").first().getAttribute("data-grab");

/** go round the platter in a circle with a finger, as fast as `step` radians per move */
async function circle(phone: Page, laps: number, step: number, pause = 16) {
  const b = await platterBox(phone);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2 - 12;
  const R = Math.min(b.width, b.height) * 0.3;
  await phone.mouse.move(cx + R, cy);
  await phone.mouse.down();
  const n = Math.round((laps * Math.PI * 2) / Math.abs(step));
  for (let i = 1; i <= n; i++) {
    await phone.mouse.move(cx + Math.cos(i * step) * R, cy + Math.sin(i * step) * R);
    await phone.waitForTimeout(pause);
  }
}

test.describe("phone controllers: music", () => {
  test("Play starts the laptop's deck, and the laptop's space bar comes back to the phone", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openPiece(host, phone, "decks", "decks-controller", "decks-phone-hint");
    await expect(host.getByTestId("decks-phone-hint")).toHaveText(/scratch on your phone/i);
    await expect(phone.getByTestId("decks-controller")).toHaveAttribute("data-running", "false");
    await shot(phone, "decks-phone-idle.png");

    await phone.getByTestId("decks-play").click();
    await expect(stage(host).getByRole("button", { name: "Stop" })).toBeVisible(SLOW);
    await expect(phone.getByTestId("decks-play")).toHaveText("Stop");
    await expect.poll(() => rate(host), { timeout: 10_000 }).toBeGreaterThan(50);

    // the laptop's own control moves the phone's
    await stage(host).getByRole("button", { name: "Stop" }).click();
    await expect(phone.getByTestId("decks-controller")).toHaveAttribute("data-running", "false");
    await expect(phone.getByTestId("decks-play")).toHaveText("Play");
    await context.close();
  });

  test("going round the phone's record scratches the laptop's, backwards too, and letting go releases it", async ({ browser, baseURL }) => {
    test.setTimeout(75_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openPiece(host, phone, "decks", "decks-controller", "decks-phone-hint");
    await phone.getByTestId("decks-play").click();
    await expect(stage(host).getByRole("button", { name: "Stop" })).toBeVisible(SLOW);
    await expect.poll(() => rate(host), { timeout: 10_000 }).toBeGreaterThan(50);

    // clockwise and quick: well past normal speed on the laptop's platter
    const seen: number[] = [];
    const watch = setInterval(() => void rate(host).then((r) => seen.push(r)), 60);
    await circle(phone, 2, 0.25);
    await expect(phone.getByTestId("decks-controller")).toHaveAttribute("data-held", "true");
    await expect.poll(() => grabbed(host), { timeout: 5000 }).toBe("1");
    await shot(phone, "decks-phone-scratch.png");
    await shot(host, "decks-laptop-scratch.png");
    await phone.mouse.up();
    clearInterval(watch);
    expect(Math.max(...seen)).toBeGreaterThan(150);
    await expect.poll(() => grabbed(host), { timeout: 5000 }).toBe("0");

    // anticlockwise: the record goes backwards
    const back: number[] = [];
    const watchBack = setInterval(() => void rate(host).then((r) => back.push(r)), 60);
    await circle(phone, 1.5, -0.25);
    await phone.mouse.up();
    clearInterval(watchBack);
    expect(Math.min(...back)).toBeLessThan(-100);

    // a finger held still holds the record still
    const b = await platterBox(phone);
    await phone.mouse.move(b.x + b.width * 0.75, b.y + b.height / 2 - 12);
    await phone.mouse.down();
    await expect.poll(() => rate(host), { timeout: 5000 }).toBeLessThan(15);
    await expect.poll(() => rate(host), { timeout: 5000 }).toBeGreaterThan(-15);
    await phone.mouse.up();
    // and let go, the motor takes it back to speed
    await expect.poll(() => rate(host), { timeout: 10_000 }).toBeGreaterThan(80);
    await context.close();
  });

  test("twist: hold the record, turn the phone, and the laptop's record turns", async ({ browser, baseURL }) => {
    test.setTimeout(75_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openPiece(host, phone, "decks", "decks-controller", "decks-phone-hint");
    await phone.getByTestId("decks-play").click();
    await expect(stage(host).getByRole("button", { name: "Stop" })).toBeVisible(SLOW);
    await phone.locator('[data-mode-btn="twist"]').click();
    await expect(phone.getByTestId("decks-controller")).toHaveAttribute("data-mode", "twist");

    const b = await platterBox(phone);
    await phone.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await phone.mouse.down();
    // (mock samples don't count as "receiving", so be quick: the controller gives up on motion after 2.5 s)
    // a wrist turn: 4 rad/s about the screen axis for a second
    await phone.evaluate(() => {
      for (let i = 0; i < 100; i++) {
        (window as unknown as PhoneWindow).__linkMotion!.push({ t: i * 0.01, acc: [0, 0, 9.81], gyro: [0, 0, 4] });
      }
    });
    await expect.poll(() => grabbed(host), { timeout: 5000 }).toBe("1");
    await expect.poll(async () => Math.abs(await rate(host)), { timeout: 5000 }).toBeGreaterThan(40);
    await phone.mouse.up();
    await expect.poll(() => grabbed(host), { timeout: 5000 }).toBe("0");
    await context.close();
  });

  test("with no motion allowed, Twist is off and the finger still works", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openPiece(host, phone, "decks", "decks-controller", "decks-phone-hint");
    await phone.locator('[data-mode-btn="twist"]').click();
    // no samples arrive: after a couple of seconds it says so and goes back to the finger
    await expect(phone.getByText(/isn't sending motion data/i)).toBeVisible({ timeout: 8000 });
    await expect(phone.getByTestId("decks-controller")).toHaveAttribute("data-mode", "finger");
    await expect(phone.locator('[data-mode-btn="twist"]')).toBeDisabled();
    await circle(phone, 1, 0.3);
    await expect.poll(() => grabbed(host), { timeout: 5000 }).toBe("1");
    await phone.mouse.up();
    await context.close();
  });

  test("Cut: holding the phone's button is the fader", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openPiece(host, phone, "decks", "decks-controller", "decks-phone-hint");
    const btn = phone.getByTestId("decks-cut");
    await phone.waitForTimeout(800); // let the layout settle before aiming at it
    const b = (await btn.boundingBox())!;
    await phone.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await phone.mouse.down();
    await expect(phone.getByTestId("decks-controller")).toHaveAttribute("data-cut", "true");
    await expect(btn).toHaveText("Cut!");
    await phone.mouse.up();
    await expect(phone.getByTestId("decks-controller")).toHaveAttribute("data-cut", "false");
    await context.close();
  });
});

test.describe("no phone linked: the music board is exactly as it was", () => {
  test("no hint, and a mouse still scratches", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="decks"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await expect(page.getByTestId("decks-phone-hint")).toHaveCount(0);
    const canvas = stage(page).locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx + 80, cy);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(cx + Math.cos(i * 0.25) * 80, cy + Math.sin(i * 0.25) * 80);
    await expect(canvas).toHaveAttribute("data-grab", "1");
    await page.mouse.up();
    await expect(canvas).toHaveAttribute("data-grab", "0");
    await context.close();
  });
});
