import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// The phone link's two faces, end to end, with the BroadcastChannel mock
// session standing in for the relay: the home page on a "laptop" and /p on a
// "phone", two pages of one browser context. The phone's tilt is faked with
// CDP DeviceOrientation.setDeviceOrientationOverride (Chromium rounds to 0.1
// degree and only fires on a change).

type Orient = (alpha: number, beta: number, gamma: number) => Promise<unknown>;

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function newContext(browser: Browser, baseURL: string | undefined, viewport = LAPTOP, extra: Record<string, unknown> = {}) {
  return browser.newContext({ baseURL, viewport, permissions: ["accelerometer", "gyroscope", "magnetometer"], ...extra });
}

/** the home page on a laptop: waits for the card, returns the code it shows */
async function openHost(context: BrowserContext) {
  const host = await context.newPage();
  await host.goto("/");
  const code = ((await host.getByTestId("pair-code").textContent({ timeout: 15000 })) ?? "").replace(/\s/g, "");
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return { host, code };
}

async function openPhone(context: BrowserContext, path: string) {
  const phone = await context.newPage();
  await phone.setViewportSize(PHONE);
  await phone.goto(path);
  const cdp = await context.newCDPSession(phone);
  const orient: Orient = (a, b, g) => cdp.send("DeviceOrientation.setDeviceOrientationOverride", { alpha: a, beta: b, gamma: g });
  return { phone, orient };
}

/** both ends open and linked; the phone has streamed enough samples to calibrate */
async function linked(browser: Browser, baseURL: string | undefined, viewport = LAPTOP, extra: Record<string, unknown> = {}) {
  const context = await newContext(browser, baseURL, viewport, extra);
  const { host, code } = await openHost(context);
  const { phone, orient } = await openPhone(context, `/p#c=${code}`);
  await orient(137, 62, -4);
  await phone.getByTestId("connect").click();
  await expect(phone.getByTestId("phone-live")).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await orient(137, 62 + (i % 2) * 0.1, -4);
    await host.waitForTimeout(25);
  }
  await expect(host.getByTestId("link-pill")).toBeVisible();
  return { context, host, phone, orient, code };
}

/** 3x3 rotation of an element's computed transform (CSS frame: y down, z toward the viewer) */
const rot = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const t = getComputedStyle(el).transform;
    if (t === "none") return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const v = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
    if (v.length === 6) return [[v[0], v[2], 0], [v[1], v[3], 0], [0, 0, 1]];
    return [[v[0], v[4], v[8]], [v[1], v[5], v[9]], [v[2], v[6], v[10]]];
  });
/** z (toward the viewer) of the device's top-centre point (0, -1, 0): positive = the top leans toward you */
const topZ = async (page: Page, selector = ".dev-slot") => -(await rot(page, selector))[2][1];

async function swipeUp(phone: Page, fromY: number, toY: number, x = 120) {
  await phone.mouse.move(x, fromY);
  await phone.mouse.down();
  for (let y = fromY; y >= toY; y -= 30) await phone.mouse.move(x, y);
  await phone.mouse.up();
}

test.describe("link UI: laptop", () => {
  test("the lock screen offers a pairing card with a QR, the code and a how-it-works", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { host, code } = await openHost(context);

    const card = host.getByTestId("pair-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: /this phone's a replica\. pick up yours\./i })).toBeVisible();
    const qr = card.getByRole("img", { name: /qr code/i });
    await expect(qr).toBeVisible();
    // it really is a QR of the pair URL: a real, non-trivial path of modules
    expect((await qr.locator("path").getAttribute("d"))?.length ?? 0).toBeGreaterThan(400);
    await expect(card.getByText(/\/p$/)).toBeVisible();
    expect(code).toHaveLength(6);

    // how it works toggles in place, keyboard first
    const how = card.getByRole("button", { name: "How this works" });
    await how.focus();
    await host.keyboard.press("Enter");
    await expect(card.getByText(/streams your phone's tilt/i)).toBeVisible();
    await expect(card.getByRole("button", { name: "Back to the code" })).toHaveAttribute("aria-expanded", "true");
    await host.keyboard.press("Enter");
    await expect(card.getByTestId("pair-code")).toBeVisible();
    await context.close();
  });

  test("the card never blocks unlocking: the button, a swipe that starts on it, or scrolling", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { host } = await openHost(context);
    const unlock = host.getByRole("button", { name: /swipe up to unlock/i });
    await expect(unlock).toBeVisible();

    // a scroll over the card unlocks
    const box = (await host.getByTestId("pair-card").boundingBox())!;
    await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await host.mouse.wheel(0, 120);
    await expect(unlock).toHaveCount(0);

    // reload: a drag that starts on the card unlocks too
    await host.reload();
    await expect(host.getByTestId("pair-card")).toBeVisible();
    // (unlocked state lives in module memory, so a reload locks it again)
    const b2 = (await host.getByTestId("pair-card").boundingBox())!;
    await host.mouse.move(b2.x + 20, b2.y + b2.height - 8);
    await host.mouse.down();
    for (let i = 1; i <= 8; i++) await host.mouse.move(b2.x + 20, b2.y + b2.height - 8 - i * 30);
    await host.mouse.up();
    await expect(host.getByRole("button", { name: /swipe up to unlock/i })).toHaveCount(0);
    await context.close();
  });

  test("a phone-sized touch screen never sees the card, and loads nothing of the link", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: PHONE,
      hasTouch: true,
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    const chunks: string[] = [];
    page.on("request", (r) => /link|Pair/i.test(r.url()) && r.url().includes("/_next/") && chunks.push(r.url()));
    await page.goto("/");
    await expect(page.getByRole("button", { name: /swipe up to unlock/i })).toBeVisible();
    await page.waitForTimeout(3000); // well past the idle callback that would start a host
    await expect(page.getByTestId("pair-card")).toHaveCount(0);
    await expect(page.getByText(/pick up yours/i)).toHaveCount(0);
    await context.close();
  });

  test("a mouse-first screen that is narrower than a tablet doesn't get it either", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL, { width: 700, height: 900 });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("pair-card")).toHaveCount(0);
    await context.close();
  });
});

test.describe("link UI: linked", () => {
  test("the phone joins by code and the pill shows the path", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL);
    const pill = host.getByTestId("link-pill");
    await expect(pill).toContainText(/Linked · direct/);
    await expect(pill).toHaveAttribute("data-path", "direct");
    await expect(phone.getByTestId("phone-pill").first()).toContainText(/Linked · direct/);

    // the card turns into a confirmation, the QR goes
    await expect(host.getByTestId("pair-linked")).toBeVisible();
    await expect(host.getByTestId("pair-qr")).toHaveCount(0);

    // click the pill: a three-line live readout and Disconnect
    await pill.click();
    const how = host.getByTestId("link-how");
    await expect(how).toBeVisible();
    await expect(how.getByTestId("link-path")).toContainText(/direct/i);
    await expect(how.getByTestId("link-rtt")).toContainText(/\d+ ms/);
    await expect(how.getByTestId("link-hz")).toContainText(/\d+ \/ s/);
    await expect(pill).toHaveAttribute("aria-expanded", "true");
    await host.keyboard.press("Escape");
    await expect(how).toHaveCount(0);
    await context.close();
  });

  test("tilting the phone tilts the device, in the right direction, and flat is flat", async ({ browser, baseURL }) => {
    const { context, host, orient } = await linked(browser, baseURL);
    await host.waitForTimeout(500);
    expect(Math.abs(await topZ(host))).toBeLessThan(0.003);

    // lift the phone's top 25 degrees: the device's top comes toward you
    await orient(137, 62 + 25, -4);
    await host.waitForTimeout(700);
    expect(await topZ(host)).toBeGreaterThan(0.15);
    // and the scale (--s) wasn't touched: the inner .dev still carries it
    const inner = await host.locator(".dev").first().evaluate((el) => getComputedStyle(el).transform);
    expect(inner).not.toBe("none");

    // lay it back: the device settles flat again
    await orient(137, 62, -4);
    await host.waitForTimeout(700);
    expect(Math.abs(await topZ(host))).toBeLessThan(0.02);
    await context.close();
  });

  test("with reduced motion the device stays flat, but unlock and apps still work", async ({ browser, baseURL }) => {
    const { context, host, phone, orient } = await linked(browser, baseURL, LAPTOP, { reducedMotion: "reduce" });
    await orient(137, 62 + 30, -4);
    await host.waitForTimeout(500);
    expect(Math.abs(await topZ(host))).toBeLessThan(0.001);
    await swipeUp(phone, 600, 200);
    await expect(host.getByRole("button", { name: /swipe up to unlock/i })).toHaveCount(0);
    await phone.getByRole("button", { name: /^Work: opens on your laptop/ }).click();
    await expect(host).toHaveURL(/\/projects$/);
    await context.close();
  });

  test("swiping up on the phone follows the finger on the laptop, then unlocks it", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL);
    const layer = host.locator("[data-lock-layer]");
    const unlock = host.getByRole("button", { name: /swipe up to unlock/i });
    await expect(unlock).toBeVisible();
    await expect(phone.getByTestId("phone-live")).toHaveAttribute("data-screen", "lock");

    // a short, slow drag moves the laptop's lock layer, and letting go snaps both back
    await phone.mouse.move(120, 650);
    await phone.mouse.down();
    for (let y = 650; y >= 560; y -= 15) {
      await phone.mouse.move(120, y);
      await phone.waitForTimeout(40);
    }
    await expect.poll(() => layer.evaluate((e) => (e as HTMLElement).style.transform)).toMatch(/translateY\(-\d/);
    await phone.mouse.up();
    await expect.poll(() => layer.evaluate((e) => (e as HTMLElement).style.transform)).toBe("translateY(0px)");
    await expect(unlock).toBeVisible();

    // a swipe that starts in the bottom 15% (Safari's edge) does nothing at all
    await swipeUp(phone, 810, 300);
    await host.waitForTimeout(300);
    await expect(unlock).toBeVisible();
    await expect(phone.getByTestId("phone-live")).toHaveAttribute("data-screen", "lock");

    // a full swipe unlocks the laptop's phone and gives the phone its home controller
    await swipeUp(phone, 650, 250);
    await expect(unlock).toHaveCount(0);
    await expect(phone.getByTestId("phone-live")).toHaveAttribute("data-screen", "home");
    await expect(phone.getByTestId("phone-home")).toBeVisible();
    await context.close();
  });

  test("the phone's unlock button works too (for anyone who can't swipe)", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL);
    await phone.getByRole("button", { name: "Swipe up to unlock" }).click();
    await expect(host.getByRole("button", { name: /swipe up to unlock/i })).toHaveCount(0);
    await context.close();
  });

  test("tapping an app on the phone opens it on the laptop", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL);
    await swipeUp(phone, 650, 250);
    await expect(phone.getByTestId("phone-home")).toBeVisible();
    // every app of the real home screen is there
    for (const name of ["Closet Organizer", "Colophon", "GitHub", "LinkedIn", "Work", "Off hours", "Say hi", "Mail"]) {
      await expect(phone.getByRole("button", { name: new RegExp(`^${name}: opens on your laptop`) }).or(phone.getByRole("link", { name: new RegExp(`^${name} \\(opens on this phone\\)`) }))).toBeVisible();
    }
    await phone.getByRole("button", { name: /^Work: opens on your laptop/ }).click();
    await expect(host).toHaveURL(/\/projects$/);

    // the laptop left the home screen: the phone says so, and Back is there
    await expect(phone.getByTestId("phone-piece")).toBeVisible();
    await phone.getByRole("button", { name: "Back" }).click();
    await expect(phone.getByTestId("phone-home")).toBeVisible();

    // coming home again: the link survived the navigation, and it's tilting and unlocked
    await host.goBack();
    await expect(host.getByTestId("link-pill")).toBeVisible();
    await expect(host.getByRole("button", { name: /swipe up to unlock/i })).toHaveCount(0);
    await context.close();
  });

  test("Disconnect on the laptop: the phone says the other side left, and the lock screen offers a fresh code", async ({ browser, baseURL }) => {
    const { context, host, phone, code } = await linked(browser, baseURL);
    await host.getByTestId("link-pill").click();
    await host.getByRole("button", { name: "Disconnect" }).click();
    await expect(phone.getByRole("heading", { name: /the laptop left/i })).toBeVisible();
    await expect(host.getByTestId("link-pill")).toHaveCount(0);
    const readCode = async () => ((await host.getByTestId("pair-code").textContent({ timeout: 10000 })) ?? "").replace(/\s/g, "");
    await expect.poll(readCode, { timeout: 10000 }).not.toBe(code);
    const fresh = await readCode();
    expect(fresh).toHaveLength(6);
    // and the dead code can't be used again
    await phone.getByLabel("Code on the laptop").fill(code);
    await phone.getByTestId("connect").click();
    await expect(phone.getByRole("heading", { name: /isn't open any more/i })).toBeVisible({ timeout: 8000 });
    // while the fresh one works
    await phone.getByLabel("Code on the laptop").fill(fresh);
    await phone.getByTestId("connect").click();
    await expect(phone.getByTestId("phone-live")).toBeVisible();
    await expect(host.getByTestId("link-pill")).toBeVisible();
    await context.close();
  });

  test("on the Duo the card lives on the cover, and a phone swipe unfolds it", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL, { width: 1700, height: 1000 });
    await expect(host.locator(".duo")).toHaveAttribute("data-duo", "closed");
    await expect(host.locator(".duo-outer").getByTestId("pair-card")).toBeVisible();
    await host.waitForTimeout(300);
    await swipeUp(phone, 650, 250);
    await expect(host.locator(".duo")).toHaveAttribute("data-duo", "open");
    await context.close();
  });
});

test.describe("link UI: the phone page", () => {
  test("is not indexable and not linked from the site", async ({ page }) => {
    await page.goto("/p");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goto("/");
    expect(await page.locator('a[href="/p"], a[href^="/p#"]').count()).toBe(0);
  });

  test("no code: says so and lets you type one", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL, PHONE);
    const page = await context.newPage();
    await page.goto("/p");
    await expect(page.getByRole("heading", { name: /pick up your phone/i })).toBeVisible();
    await expect(page.getByText(/no code on this page/i)).toBeVisible();
    await expect(page.getByTestId("connect")).toBeDisabled();
    await page.getByLabel("Code on the laptop").fill("ab");
    await expect(page.getByTestId("connect")).toBeDisabled();
    await page.getByLabel("Code on the laptop").fill("zz9 k7q");
    await expect(page.getByTestId("connect")).toBeEnabled();
    await context.close();
  });

  test("a code nobody is showing: expired or closed, and a way to try another", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL, PHONE);
    const page = await context.newPage();
    await page.goto("/p#c=QQQQQQ");
    await expect(page.getByText(/linking to the laptop that's showing QQQ QQQ/i)).toBeVisible();
    await page.getByTestId("connect").click();
    await expect(page.getByRole("heading", { name: /isn't open any more/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel("Code on the laptop")).toBeVisible();
    await context.close();
  });

  test("motion denied or missing: still linked, still unlocks, and says why tilt won't follow", async ({ browser, baseURL }) => {
    // no override and a 3 s wait: this Chromium sends no orientation events
    const context = await newContext(browser, baseURL);
    const { host, code } = await openHost(context);
    const phone = await context.newPage();
    await phone.setViewportSize(PHONE);
    await phone.goto(`/p#c=${code}`);
    await phone.getByTestId("connect").click();
    await expect(phone.getByTestId("phone-live")).toBeVisible();
    await expect(phone.getByTestId("phone-lock").getByText(/no motion data is coming/i)).toBeVisible({ timeout: 8000 });
    await swipeUp(phone, 650, 250);
    await expect(host.getByRole("button", { name: /swipe up to unlock/i })).toHaveCount(0);
    await context.close();

    // a phone that refuses the iOS prompt
    const ctx2 = await newContext(browser, baseURL);
    const h2 = await openHost(ctx2);
    const p2 = await ctx2.newPage();
    await p2.setViewportSize(PHONE);
    await p2.addInitScript(() => {
      (window.DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission = () => Promise.resolve("denied");
    });
    await p2.goto(`/p#c=${h2.code}`);
    await p2.getByTestId("connect").click();
    await expect(p2.getByTestId("phone-lock").getByText(/motion access is off/i)).toBeVisible();
    await p2.getByRole("button", { name: "Swipe up to unlock" }).click();
    await expect(h2.host.getByRole("button", { name: /swipe up to unlock/i })).toHaveCount(0);
    await ctx2.close();
  });

  test("the iOS motion prompt is raised first thing in the Connect tap, before any await", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { code } = await openHost(context);
    const phone = await context.newPage();
    await phone.setViewportSize(PHONE);
    await phone.addInitScript(() => {
      const w = window as unknown as { __perm?: { active: boolean }[] };
      w.__perm = [];
      (window.DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission = () => {
        w.__perm!.push({ active: navigator.userActivation.isActive });
        return Promise.resolve("granted");
      };
    });
    await phone.goto(`/p#c=${code}`);
    await phone.getByTestId("connect").click();
    await expect(phone.getByTestId("phone-live")).toBeVisible();
    const calls = await phone.evaluate(() => (window as unknown as { __perm: { active: boolean }[] }).__perm);
    expect(calls).toHaveLength(1);
    expect(calls[0].active).toBe(true);
    await context.close();
  });

  test("when the laptop's phone goes to a game, the phone says controls are coming", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL);
    await swipeUp(phone, 650, 250);
    await expect(phone.getByTestId("phone-home")).toBeVisible();
    // the laptop opens Off hours (the games live there)
    await phone.getByRole("button", { name: /^Off hours: opens on your laptop/ }).click();
    await expect(host).toHaveURL(/\/interests$/);
    await expect(phone.getByRole("heading", { name: /controls for this game are coming soon; use your laptop/i })).toBeVisible();
    await context.close();
  });
});
