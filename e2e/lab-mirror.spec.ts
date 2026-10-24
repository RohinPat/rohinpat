import { test, expect, type Browser, type Page } from "@playwright/test";

// Lab "mirror": two tabs in one context share a BroadcastChannel. The phone tab's
// orientation is faked with CDP DeviceOrientation.setDeviceOrientationOverride.
// Chromium rounds the angles to 0.1 degree and only fires on a change.

async function pair(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    permissions: ["accelerometer", "gyroscope", "magnetometer"],
  });
  const laptop = await context.newPage();
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await laptop.goto("/lab/mirror");
  await phone.goto("/lab/mirror/phone");
  const cdp = await context.newCDPSession(phone);
  const orient = (alpha: number, beta: number, gamma: number) =>
    cdp.send("DeviceOrientation.setDeviceOrientationOverride", { alpha, beta, gamma });
  return { context, laptop, phone, orient };
}

async function connect(laptop: Page, phone: Page, orient: (a: number, b: number, g: number) => Promise<unknown>) {
  await orient(137, 62, -4);
  await phone.getByRole("button", { name: "Connect motion sensors" }).click();
  // a little motion so there are a few samples, then it is calibrated
  for (let i = 0; i < 8; i++) {
    await orient(137, 62 + (i % 2) * 0.1, -4);
    await laptop.waitForTimeout(20);
  }
  await expect(laptop.getByTestId("status")).toHaveAttribute("data-status", "live");
}

/** 3x3 rotation part of the rig's computed transform (CSS frame, y down, z toward the viewer). */
const rig = (laptop: Page) =>
  laptop.getByTestId("mockup-rig").evaluate((el) => {
    const t = getComputedStyle(el).transform;
    if (t === "none") return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const v = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
    if (v.length === 6) return [[v[0], v[2], 0], [v[1], v[3], 0], [0, 0, 1]];
    return [[v[0], v[4], v[8]], [v[1], v[5], v[9]], [v[2], v[6], v[10]]];
  });
/** z (toward the viewer) of the mockup's top-centre point, which sits at (0, -1, 0). */
const topZ = async (laptop: Page) => -(await rig(laptop))[2][1];

test.describe("lab mirror", () => {
  test("is not indexable and not linked from the site", async ({ page }) => {
    await page.goto("/lab/mirror");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goto("/");
    expect(await page.locator('a[href^="/lab"]').count()).toBe(0);
  });

  test("calibrates to flat, then follows tilt in the right direction", async ({ browser, baseURL }) => {
    const { context, laptop, phone, orient } = await pair(browser, baseURL);
    await connect(laptop, phone, orient);
    await laptop.waitForTimeout(500);
    // nothing is tilted at the neutral pose, however the phone is being held
    expect(Math.abs(await topZ(laptop))).toBeLessThan(0.002);

    // lift the phone's top 25 degrees (beta up): the mockup's top comes toward the viewer
    await orient(137, 62 + 25, -4);
    await laptop.waitForTimeout(700);
    expect(await topZ(laptop)).toBeGreaterThan(0.2);
    await context.close();
  });

  test("swipe up on the phone unlocks the mockup; a tap ripples at the same place", async ({ browser, baseURL }) => {
    const { context, laptop, phone, orient } = await pair(browser, baseURL);
    await connect(laptop, phone, orient);
    const screen = laptop.getByTestId("mockup-screen");
    await expect(screen).toHaveAttribute("data-locked", "true");

    // a short, slow drag follows the finger and snaps back (a fast one counts as a flick and unlocks)
    await phone.mouse.move(60, 780);
    await phone.mouse.down();
    for (let y = 780; y >= 690; y -= 15) {
      await phone.mouse.move(60, y);
      await phone.waitForTimeout(60);
    }
    await expect
      .poll(() => laptop.getByTestId("mockup-lock").evaluate((e) => (e as HTMLElement).style.transform))
      .toMatch(/translateY\(-\d/);
    await phone.mouse.up();
    await laptop.waitForTimeout(700);
    await expect(screen).toHaveAttribute("data-locked", "true");
    await expect(laptop.getByTestId("mockup-lock")).toHaveCSS("opacity", "1");

    // a full swipe unlocks
    await phone.mouse.move(60, 780);
    await phone.mouse.down();
    for (let y = 780; y >= 300; y -= 30) await phone.mouse.move(60, y);
    await phone.mouse.up();
    await expect(screen).toHaveAttribute("data-locked", "false");
    await expect(phone.getByTestId("pad")).toHaveAttribute("data-phase", "unlocked");

    // tap: ripple lands at the matching fraction of the mockup's screen (393 x 852)
    await phone.mouse.click(300, 250);
    const ripple = laptop.getByTestId("mockup-ripple").first();
    await expect(ripple).toBeVisible();
    const left = parseFloat(await ripple.evaluate((e) => (e as HTMLElement).style.left));
    const top = parseFloat(await ripple.evaluate((e) => (e as HTMLElement).style.top));
    expect(left).toBeCloseTo((300 / 390) * 393, -1);
    expect(top).toBeCloseTo((250 / 844) * 852, -1);

    // the laptop can lock it again
    await laptop.getByRole("button", { name: "Lock again" }).click();
    await expect(screen).toHaveAttribute("data-locked", "true");
    await expect(phone.getByTestId("phone-lock")).toBeVisible();
    await context.close();
  });

  test("re-centre works on a phone held perfectly still", async ({ browser, baseURL }) => {
    const { context, laptop, phone, orient } = await pair(browser, baseURL);
    await connect(laptop, phone, orient);
    await orient(137, 62 + 30, -4); // tilt, then hold: Chromium goes quiet
    await laptop.waitForTimeout(700);
    expect(await topZ(laptop)).toBeGreaterThan(0.25);
    await laptop.getByRole("button", { name: "Re-centre" }).click();
    await laptop.waitForTimeout(800); // ease
    expect(Math.abs(await topZ(laptop))).toBeLessThan(0.01);
    await context.close();
  });
});
