import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { genGolf } from "../tests/unit/lab-swing-traces";

// The phone as a game controller, end to end, on the BroadcastChannel mock
// session (run the dev server with NEXT_PUBLIC_LINK_MOCK=1, or the pages with
// ?linkmock): the home page on a "laptop" and /p on a "phone", two pages of
// one browser context. The laptop goes home -> /interests the way a visitor
// does it, by the phone tapping Off hours, so the link survives the move.

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

/** both ends linked and unlocked, the laptop on /interests and the phone on its game list */
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

// The games are canvas-heavy and a dev server plus several browsers share one
// CPU, so a 400 ms stage animation can take seconds: give open/close room.
const SLOW = { timeout: 15_000 };
const stage = (host: Page) => host.getByRole("dialog");
const status = (host: Page) => host.locator('[role="dialog"] p[aria-live="polite"]');

async function openGolfRange(host: Page, phone: Page) {
  await phone.locator('[data-piece="golf"]').click();
  await expect(stage(host)).toBeVisible(SLOW);
  await expect(phone.getByTestId("golf-controller")).toBeVisible();
  await stage(host).getByRole("button", { name: "Driving range" }).click();
  await expect(host.getByTestId("golf-phone-hint")).toBeVisible();
}

const carry = (text: string | null) => Number(/(\d+) yards carry/.exec(text ?? "")?.[1] ?? NaN);

test.describe("phone controllers: opening games", () => {
    test.setTimeout(75_000);
  test("the phone lists the nine games once the laptop is on /interests, and opens one like a click", async ({ browser, baseURL }) => {
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    const list = phone.getByTestId("phone-piece-list");
    await expect(list.locator("[data-piece]")).toHaveCount(9);
    await expect(list.getByRole("button", { name: /golf/i })).toBeVisible();
    await expect(stage(host)).toHaveCount(0, SLOW);

    await list.locator('[data-piece="golf"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await expect(stage(host).getByRole("heading", { name: "Putt, drive, read" })).toBeVisible();
    // it grew out of the tile: the stage opens with a clip-path animation
    await expect(phone.getByTestId("golf-controller")).toBeVisible();

    // a game with no controller yet says so, with a way back
    await phone.getByTestId("phone-back").click();
    await expect(stage(host)).toHaveCount(0, SLOW);
    await expect(phone.getByTestId("phone-piece-list")).toBeVisible();
    await phone.locator('[data-piece="keyboard"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await expect(phone.getByTestId("phone-soon")).toContainText(/coming soon; use your laptop/i);
    await phone.getByRole("button", { name: "Back to the games" }).click();
    await expect(stage(host)).toHaveCount(0, SLOW);
    await expect(phone.getByTestId("phone-piece-list")).toBeVisible();
    await context.close();
  });

  test("Back then straight into another game opens it, and it stays open", async ({ browser, baseURL }) => {
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="golf"]').click();
    await expect(stage(host).getByRole("heading", { name: "Putt, drive, read" })).toBeVisible(SLOW);
    // the phone is back on its list at once, while the laptop is still animating golf away
    await phone.getByTestId("phone-back").click();
    await phone.locator('[data-piece="maze"]').click();
    await expect(stage(host).getByRole("heading", { name: "Putt, drive, read" })).toHaveCount(0, SLOW);
    await expect(stage(host)).toBeVisible(SLOW);
    await host.waitForTimeout(1500);
    await expect(stage(host)).toBeVisible();
    await context.close();
  });

  test("Esc on the laptop puts the phone back on the list", async ({ browser, baseURL }) => {
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="golf"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await host.keyboard.press("Escape");
    await expect(stage(host)).toHaveCount(0, SLOW);
    await expect(phone.getByTestId("phone-piece-list")).toBeVisible();
    await context.close();
  });
});

test.describe("phone controllers: golf's driving range", () => {
  test("the club picker sets the laptop's club, and the laptop's club comes back to the phone", async ({ browser, baseURL }) => {
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGolfRange(host, phone);

    await phone.locator('[data-club="0"]').click();
    await expect(stage(host).getByRole("button", { name: "Driver" })).toHaveAttribute("aria-pressed", "true");
    await phone.locator('[data-club="5"]').click();
    await expect(stage(host).getByRole("button", { name: "Sand wedge" })).toHaveAttribute("aria-pressed", "true");

    // the laptop's keys move the phone's picker
    await host.keyboard.press("ArrowUp");
    await expect(phone.locator('[data-club="4"]')).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });

  test("a golf-swing from the phone plays a real shot on the range, and the power follows the speed", async ({ browser, baseURL }) => {
    test.setTimeout(75_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGolfRange(host, phone);
    await phone.locator('[data-club="3"]').click(); // 7 iron
    await expect(stage(host).getByRole("button", { name: "7 Iron" })).toHaveAttribute("aria-pressed", "true");

    const swing = (speedMph: number) =>
      phone.evaluate((s) => (window as unknown as PhoneWindow).__linkPhone!.send({ type: "gesture", name: "golf-swing", data: { speedMph: s, tempo: 3, faceDeg: 0 } }), speedMph);

    await swing(86);
    await expect(status(host)).toContainText(/7 Iron: \d+ yards carry/, { timeout: 20_000 });
    const full = carry(await status(host).textContent());
    expect(full).toBeGreaterThan(110);

    // once it has come to rest, a soft swing goes a lot shorter
    await host.waitForTimeout(1500);
    await swing(40);
    await expect.poll(async () => carry(await status(host).textContent()), { timeout: 20_000 }).not.toBe(full);
    const soft = carry(await status(host).textContent());
    expect(soft).toBeLessThan(full * 0.6);
    await context.close();
  });

  test("the phone's own recogniser turns real swing motion into that gesture", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGolfRange(host, phone);
    await phone.locator('[data-club="0"]').click();
    await expect(phone.getByTestId("golf-status")).toBeVisible();

    const { samples } = genGolf(7);
    await phone.evaluate((ss: unknown[]) => {
      for (const s of ss) (window as unknown as PhoneWindow).__linkMotion!.push(s);
    }, samples);
    await expect(phone.getByTestId("golf-last")).toContainText(/\d+(\.\d)?\s*mph/, { timeout: 5000 });
    await expect(status(host)).toContainText(/Driver: \d+ yards carry/, { timeout: 20_000 });
    await context.close();
  });

  test("the touch fallback sends a swing too", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await openGolfRange(host, phone);
    await phone.locator('[data-mode-btn="touch"]').click();
    const pad = phone.getByTestId("golf-touch-swing");
    const box = (await pad.boundingBox())!;
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.mouse.down();
    await phone.waitForTimeout(900);
    await phone.mouse.up();
    await expect(status(host)).toContainText(/yards carry/, { timeout: 20_000 });
    await context.close();
  });

  test("the hint shows only on the range, and putting says so on the phone", async ({ browser, baseURL }) => {
    const { context, host, phone } = await onTheGrid(browser, baseURL);
    await phone.locator('[data-piece="golf"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    // the laptop opens on putting
    await expect(host.getByTestId("golf-phone-hint")).toHaveCount(0);
    await expect(phone.getByRole("heading", { name: /putting is on the laptop/i })).toBeVisible();
    await stage(host).getByRole("button", { name: "Driving range" }).click();
    await expect(host.getByTestId("golf-phone-hint")).toHaveText(/swing your phone/i);
    await expect(phone.getByRole("heading", { name: /hold it like a club/i })).toBeVisible();
    await context.close();
  });
});

test.describe("no phone linked: golf is exactly as it was", () => {
  test("no hint, no link code anywhere, and a mouse swing still hits a shot", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await newContext(browser, baseURL);
    const page = await context.newPage();
    const linkRequests: string[] = [];
    page.on("request", (r) => /relay|link\/client|\/api\/link/i.test(r.url()) && linkRequests.push(r.url()));
    await page.goto("/interests");
    await page.locator('[data-piece="golf"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await stage(page).getByRole("button", { name: "Driving range" }).click();
    await expect(page.getByTestId("golf-phone-hint")).toHaveCount(0);

    const canvas = stage(page).locator("canvas");
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width / 2;
    const y0 = box.y + box.height * 0.45;
    await page.waitForTimeout(600);
    await page.mouse.move(x, y0);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x, y0 + i * 12);
    for (let i = 11; i >= 0; i--) await page.mouse.move(x, y0 + i * 12);
    await page.mouse.up();
    await expect(status(page)).toContainText(/yards carry/, { timeout: 20_000 });
    expect(linkRequests).toEqual([]);
    await context.close();
  });
});
