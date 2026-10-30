import { test, expect, type Page } from "@playwright/test";
import { pairCode } from "./pair-code";

// Night run's steering assist, end to end: a button beside the gearbox switch cycles Off, Light and Full (Light to start with),
// the keys keep working after a click, the screen reader hears the change, and a linked phone (a wheel, analogue) gets none of it.
// The mock link (NEXT_PUBLIC_LINK_MOCK=1) gives the page `window.__night`, the running game.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

const stage = (p: Page) => p.getByRole("dialog");
const canvas = (p: Page) => p.getByTestId("night-canvas");
const assistBtn = (p: Page) => p.getByTestId("night-assist");
const live = (p: Page) => p.locator('[role="dialog"] p[aria-live="polite"]');
const level = (p: Page) => p.evaluate(() => (window as unknown as { __night: { assist: number } }).__night.assist);

async function openCars(p: Page) {
  await p.goto("/interests");
  await p.locator('[data-piece="engine"]').click();
  await expect(stage(p)).toBeVisible(SLOW);
  await expect(canvas(p)).toHaveAttribute("data-phase", "ready", SLOW);
  await expect(canvas(p)).toBeFocused(SLOW);
}

test.describe("Night run: the steering assist", () => {
  test("starts on Light, cycles Light, Full, Off and back, says so, and leaves the keys working", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await expect(assistBtn(page)).toHaveText(/assist: light/i);
    await expect(canvas(page)).toHaveAttribute("data-assist", "1", SLOW);
    // it sits beside the gearbox switch, in the same row
    const a = (await assistBtn(page).boundingBox())!;
    const g = (await page.getByTestId("night-auto").boundingBox())!;
    expect(Math.abs(a.y + a.height / 2 - (g.y + g.height / 2))).toBeLessThan(2);
    expect(a.x + a.width).toBeLessThan(g.x);

    for (const [name, n] of [["Full", 2], ["Off", 0], ["Light", 1]] as const) {
      await assistBtn(page).click();
      await expect(assistBtn(page)).toHaveText(new RegExp(`assist: ${name}`, "i"));
      await expect(live(page)).toHaveText(new RegExp(`steering assist: ${name}`, "i"));
      await expect(canvas(page)).toHaveAttribute("data-assist", String(n), SLOW);
      expect(await level(page)).toBe(n);
      // the keys listen on the canvas: the click must not leave them without it
      await expect(canvas(page)).toBeFocused();
    }
    // the keys still start the run
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    await page.keyboard.up("ArrowUp");
    await context.close();
  });

  test("works from the keyboard alone: Tab to the button and press Enter", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await assistBtn(page).focus();
    await expect(assistBtn(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(assistBtn(page)).toHaveText(/assist: full/i);
    await page.keyboard.press("Enter");
    await expect(assistBtn(page)).toHaveText(/assist: off/i);
    expect(await level(page)).toBe(0);
    await context.close();
  });

  test("the assist steers the keys' car back toward the line, and Off leaves it where the wheel put it", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect.poll(async () => Number(await canvas(page).getAttribute("data-speed")), { timeout: 15_000 }).toBeGreaterThan(30);
    const lat = (p: Page) => p.evaluate(() => (window as unknown as { __night: { car: { lat: number } } }).__night.car.lat);
    const drive = async () => {
      // 3 m off the middle on the opening straight, the wheel left alone: where is the car a moment later?
      await page.evaluate(() => {
        const g = (window as unknown as { __night: { car: { lat: number; psi: number; w: number; r: number; s: number }; timeLeft: number } }).__night;
        g.car.s = 40;
        g.car.lat = 3;
        g.car.psi = 0;
        g.car.w = 0;
        g.car.r = 0;
        g.timeLeft = 999;
      });
      await page.waitForTimeout(1500);
      return lat(page);
    };
    // Off: the car carries on at about where it was, Full: it has come a good way back toward the middle
    const setTo = async (name: string, n: number) => {
      while (!/assist: (\w+)/i.exec(await assistBtn(page).innerText())?.[1].toLowerCase().startsWith(name)) await assistBtn(page).click();
      await expect(canvas(page)).toHaveAttribute("data-assist", String(n), SLOW);
    };
    await setTo("off", 0);
    const off = await drive();
    await setTo("full", 2);
    const full = await drive();
    expect(off).toBeGreaterThan(2.4);
    expect(full).toBeLessThan(off - 1);
    await page.keyboard.up("ArrowUp");
    await context.close();
  });

  test("a linked phone, held like a wheel, gets no assist, whatever the button says", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
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
    await expect(host.getByTestId("night-phone-hint")).toBeVisible(SLOW);
    await expect(canvas(host)).toHaveAttribute("data-phase", "ready", SLOW);
    // the button still says what it was set to; the game is not using it
    await expect(assistBtn(host)).toHaveText(/assist: light/i);
    await expect(canvas(host)).toHaveAttribute("data-assist", "0", SLOW);
    await context.close();
  });
});
