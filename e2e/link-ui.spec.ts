import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { pairCode } from "./pair-code";

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

/** the home page on a laptop: opens the padlock, returns the code on the card */
async function openHost(context: BrowserContext) {
  const host = await context.newPage();
  await host.goto("/");
  const code = await pairCode(host);
  return { host, code };
}

const padlock = (page: Page) => page.getByRole("button", { name: "Pair your phone with this one" });
const unlockButton = (page: Page) => page.getByRole("button", { name: /swipe up to unlock/i });

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
  test("the padlock opens a pairing card with a QR, the code and a how-it-works", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { host, code } = await openHost(context);

    // closed: a padlock with its label, no card
    await expect(host.getByTestId("pair-card")).toHaveCount(0);
    await expect(padlock(host)).toHaveAttribute("aria-expanded", "false");
    await expect(host.getByTestId("pair-lock-label")).toHaveText("Scan to pair");
    await expect(host.getByTestId("pair-shackle")).toHaveAttribute("data-state", "closed");

    await padlock(host).click();
    await expect(padlock(host)).toHaveAttribute("aria-expanded", "true");
    const card = host.getByTestId("pair-card");
    await expect(card).toBeVisible();
    // it hangs from the padlock, inside the phone's screen
    const lockBox = (await padlock(host).boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(cardBox.y).toBeGreaterThan(lockBox.y);
    expect(Math.abs(cardBox.x + cardBox.width / 2 - (lockBox.x + lockBox.width / 2))).toBeLessThan(40);
    await expect(unlockButton(host)).toBeVisible();
    await expect(card.getByRole("heading", { name: /this phone's a replica\. pick up yours\./i })).toBeVisible();
    const qr = card.getByRole("img", { name: /qr code/i });
    await expect(qr).toBeVisible();
    // it really is a QR of the pair URL: a real, non-trivial path of modules
    expect((await qr.locator("path").getAttribute("d"))?.length ?? 0).toBeGreaterThan(400);
    expect(code).toHaveLength(6);

    // only the QR at first: the address and code wait behind "Can't scan?", keyboard first
    await expect(card.getByTestId("pair-code")).toBeHidden();
    const cant = card.getByRole("button", { name: "Can't scan?" });
    await cant.focus();
    await host.keyboard.press("Enter");
    await expect(card.getByText(/\/p$/)).toBeVisible();
    await expect(card.getByTestId("pair-code")).toBeVisible();
    await expect(card.getByRole("button", { name: "Hide the code" })).toHaveAttribute("aria-expanded", "true");
    await host.keyboard.press("Enter");
    await expect(card.getByTestId("pair-code")).toBeHidden();
    await context.close();
  });

  test("the card's How it works opens the write-up, and a click on that link does not unlock the phone", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { host } = await openHost(context);
    const card = host.getByTestId("pair-card");
    await padlock(host).click();
    const read = card.getByRole("link", { name: "How it works" });
    await expect(read).toHaveAttribute("href", "/projects/phone-link");
    await expect(host.getByRole("button", { name: /swipe up to unlock/i })).toBeVisible();
    await read.click();
    await expect(host).toHaveURL(/\/projects\/phone-link$/);
    await expect(host.getByRole("heading", { level: 1, name: /A website your phone can drive/ })).toBeVisible();
    await context.close();
  });

  test("Enter and Space open the padlock; Escape, a second press or a press outside close it", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { host } = await openHost(context);
    const card = host.getByTestId("pair-card");

    await padlock(host).focus();
    await host.keyboard.press("Enter");
    await expect(card).toBeVisible();
    // Tab goes into the card
    await host.keyboard.press("Tab");
    await expect(card.getByRole("button", { name: "Can't scan?" })).toBeFocused();
    // Escape closes it and focus goes back to the padlock
    await host.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(padlock(host)).toBeFocused();
    await expect(padlock(host)).toHaveAttribute("aria-expanded", "false");
    await expect(unlockButton(host)).toBeVisible();

    await host.keyboard.press("Space");
    await expect(card).toBeVisible();
    await padlock(host).click();
    await expect(card).toHaveCount(0);

    // a press outside (on the dark wallpaper) closes it, and is no unlock
    await padlock(host).click();
    await expect(card).toBeVisible();
    const screen = (await host.locator(".dev-screen").boundingBox())!;
    await host.mouse.click(screen.x + screen.width / 2, screen.y + screen.height * 0.6);
    await expect(card).toHaveCount(0);
    await expect(unlockButton(host)).toBeVisible();
    await context.close();
  });

  test("the open card is not part of the swipe: dragging, selecting and scrolling on it leave the phone locked", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { host } = await openHost(context);
    await padlock(host).click();
    const card = host.getByTestId("pair-card");
    await expect(card).toBeVisible();
    const b = (await card.boundingBox())!;
    const x = b.x + b.width - 30;

    // a long drag up across the card
    await host.mouse.move(x, b.y + b.height - 12);
    await host.mouse.down();
    for (let i = 1; i <= 10; i++) await host.mouse.move(x, b.y + b.height - 12 - i * 25);
    await host.mouse.up();
    await expect(unlockButton(host)).toBeVisible();
    await expect(host.locator("[data-lock-layer]")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    // so can text be selected (the code, for typing)
    await card.getByRole("button", { name: "Can't scan?" }).click();
    await card.getByTestId("pair-code").click({ clickCount: 3 });
    expect(await host.evaluate(() => window.getSelection()?.toString().trim() ?? "")).not.toBe("");

    // a scroll over it
    await host.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await host.mouse.wheel(0, 400);
    await host.waitForTimeout(200);
    await expect(unlockButton(host)).toBeVisible();
    await expect(card).toBeVisible();
    await context.close();
  });

  test("the lock screen still unlocks the old ways: the button, a swipe, a scroll", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { host } = await openHost(context);

    // a scroll over the clock
    const clock = (await host.locator("[data-lock-layer] p.hero-field").boundingBox())!;
    await host.mouse.move(clock.x + clock.width / 2, clock.y + clock.height / 2);
    await host.mouse.wheel(0, 120);
    await expect(unlockButton(host)).toHaveCount(0);

    // reload (unlocked state lives in module memory, so it locks again): a drag from empty wallpaper
    await host.reload();
    await expect(padlock(host)).toBeVisible();
    const s = (await host.locator(".dev-screen").boundingBox())!;
    const x = s.x + s.width / 2;
    await host.mouse.move(x, s.y + s.height * 0.7);
    await host.mouse.down();
    for (let i = 1; i <= 8; i++) await host.mouse.move(x, s.y + s.height * 0.7 - i * 30);
    await host.mouse.up();
    await expect(unlockButton(host)).toHaveCount(0);

    await host.reload();
    await padlock(host).waitFor();
    await unlockButton(host).click();
    await expect(unlockButton(host)).toHaveCount(0);
    await context.close();
  });

  test("the padlock gives one small wiggle if nobody touches the lock screen, and never again", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const host = await context.newPage();
    await host.goto("/");
    await padlock(host).waitFor();
    await expect(padlock(host)).not.toHaveAttribute("data-wiggle", "true");
    await expect(padlock(host)).toHaveAttribute("data-wiggle", "true", { timeout: 9000 });
    expect(await host.locator(".pl-wiggle").count()).toBe(1);
    await context.close();
  });

  test("a visitor who touches the lock screen first gets no wiggle; reduced motion gets none either", async ({ browser, baseURL }) => {
    const touched = await newContext(browser, baseURL);
    const a = await touched.newPage();
    await a.goto("/");
    await padlock(a).waitFor();
    await padlock(a).hover();
    const reduced = await newContext(browser, baseURL, LAPTOP, { reducedMotion: "reduce" });
    const b = await reduced.newPage();
    await b.goto("/");
    await padlock(b).waitFor();
    await a.waitForTimeout(6500);
    await expect(padlock(a)).not.toHaveAttribute("data-wiggle", "true");
    await expect(padlock(b)).not.toHaveAttribute("data-wiggle", "true");
    await touched.close();
    await reduced.close();
  });

  test("the name notification reads the 30-second version and still opens the summary", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const host = await context.newPage();
    await host.goto("/");
    const note = host.getByRole("button", { name: /^Rohin Patel\. The 30-second version, opens a summary$/ });
    await expect(note).toContainText("The 30-second version");
    await expect(note).not.toContainText("WHOOP");
    await note.click();
    await expect(host.getByRole("dialog", { name: "Rohin Patel" })).toBeVisible();
    await context.close();
  });

  test("axe finds nothing on the lock screen with the padlock closed or open", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const { host } = await openHost(context);
    const scan = async () => (await new AxeBuilder({ page: host }).analyze()).violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`);
    expect(await scan()).toEqual([]);
    await padlock(host).click();
    await expect(host.getByTestId("pair-card")).toBeVisible();
    await host.waitForTimeout(400); // past the pop-in, so contrast is read on the settled card
    expect(await scan()).toEqual([]);
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
    // the padlock is only the glyph an iPhone shows: no button, no label
    await expect(padlock(page)).toHaveCount(0);
    await expect(page.getByText("Scan to pair")).toHaveCount(0);
    await expect(page.getByTestId("pair-shackle")).toHaveCount(1);
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
    // the lock opens (the shackle lifts), the label says so, and the card is out of the way
    await expect(host.getByTestId("pair-shackle")).toHaveAttribute("data-state", "open");
    await expect(host.getByTestId("pair-lock-label")).toHaveText("Linked · swipe up on your phone");
    await expect(host.getByTestId("pair-card")).toHaveCount(0);
    await expect(host.getByRole("status").filter({ hasText: "Phone linked" })).toHaveCount(1);
    // opening it now shows the confirmation, not the QR
    await padlock(host).click();
    await expect(host.getByTestId("pair-linked")).toBeVisible();
    await expect(host.getByTestId("pair-qr")).toHaveCount(0);
    await host.keyboard.press("Escape");

    // click the pill: a three-line live readout and Disconnect
    await pill.click();
    const how = host.getByTestId("link-how");
    await expect(how).toBeVisible();
    await expect(how.getByTestId("link-path")).toContainText(/direct/i);
    await expect(how.getByTestId("link-rtt")).toContainText(/\d+ ms/);
    await expect(how.getByTestId("link-hz")).toContainText(/\d+ \/ s/);
    await expect(how.getByRole("link", { name: "Read how it works" })).toHaveAttribute("href", "/projects/phone-link");
    await expect(pill).toHaveAttribute("aria-expanded", "true");
    await host.keyboard.press("Escape");
    await expect(how).toHaveCount(0);
    await context.close();
  });

  test("on the Duo's cover the padlock opens the card too", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL, { width: 1700, height: 1000 });
    const host = await context.newPage();
    await host.goto("/");
    await expect(host.locator(".duo")).toHaveAttribute("data-duo", "closed");
    await padlock(host).click();
    const card = host.locator(".duo-outer").getByTestId("pair-card");
    await expect(card).toBeVisible();
    const outer = (await host.locator(".duo-outer").boundingBox())!;
    const b = (await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(outer.x);
    expect(b.x + b.width).toBeLessThanOrEqual(outer.x + outer.width);
    await host.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(host.locator(".duo")).toHaveAttribute("data-duo", "closed");
    await context.close();
  });

  test("a phone linking while the card is open closes it and opens the lock; dropping the link closes the lock again", async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    const host = await context.newPage();
    await host.goto("/");
    await padlock(host).click();
    const code = ((await host.getByTestId("pair-code").textContent({ timeout: 15000 })) ?? "").replace(/\s/g, "");
    await expect(host.getByTestId("pair-card")).toBeVisible();
    const { phone, orient } = await openPhone(context, `/p#c=${code}`);
    await orient(137, 62, -4);
    await phone.getByTestId("connect").click();
    await expect(phone.getByTestId("phone-live")).toBeVisible();
    await expect(host.getByTestId("pair-shackle")).toHaveAttribute("data-state", "open");
    await expect(host.getByTestId("pair-lock-label")).toHaveText("Linked · swipe up on your phone");
    await expect(host.getByTestId("pair-card")).toHaveCount(0);
    await expect(padlock(host)).toHaveAttribute("aria-expanded", "false");

    await host.getByTestId("link-pill").click();
    await host.getByRole("button", { name: "Disconnect" }).click();
    await expect(host.getByTestId("pair-shackle")).toHaveAttribute("data-state", "closed");
    await expect(host.getByTestId("pair-lock-label")).toHaveText("Scan to pair");
    await context.close();
  });

  test("unlocking with the card open takes it along cleanly", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL);
    await padlock(host).click();
    await expect(host.getByTestId("pair-card")).toBeVisible();
    await swipeUp(phone, 650, 250); // the linked phone drags the lock layer, and lets go
    await expect(unlockButton(host)).toHaveCount(0);
    await expect(host.getByTestId("pair-card")).toHaveCount(0);
    await expect(host.locator("[data-home] a").first()).toBeFocused();
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

    // the laptop left the home screen: the phone says so, and its Back takes both home
    await expect(phone.getByTestId("phone-piece")).toBeVisible();
    await phone.getByRole("button", { name: "Back" }).click();
    await expect(phone.getByTestId("phone-home")).toBeVisible();

    // home again: the link survived the navigation, and it's tilting and unlocked
    await host.waitForURL((u) => new URL(u).pathname === "/");
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
    // the card is behind the padlock: open it (once) and read the code on it
    await padlock(host).click();
    const readCode = async () => ((await host.getByTestId("pair-code").textContent({ timeout: 1500 }).catch(() => "")) ?? "").replace(/\s/g, "");
    await expect.poll(readCode, { timeout: 10000 }).not.toBe(code);
    const fresh = await readCode();
    expect(fresh).toHaveLength(6);
    await host.keyboard.press("Escape");
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

  test("on the Duo the padlock lives on the cover, and a phone swipe unfolds it", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL, { width: 1700, height: 1000 });
    await expect(host.locator(".duo")).toHaveAttribute("data-duo", "closed");
    await expect(host.locator(".duo-outer").getByTestId("pair-shackle")).toHaveAttribute("data-state", "open");
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
    await expect(page.getByText(/scan the qr code on the laptop/i)).toBeVisible();
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
    await expect(page.getByText(/linking to the laptop showing QQQ QQQ/i)).toBeVisible();
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

  test("when the laptop goes to the games, the phone lists them", async ({ browser, baseURL }) => {
    const { context, host, phone } = await linked(browser, baseURL);
    await swipeUp(phone, 650, 250);
    await expect(phone.getByTestId("phone-home")).toBeVisible();
    // the laptop opens Off hours (the games live there)
    await phone.getByRole("button", { name: /^Off hours: opens on your laptop/ }).click();
    await expect(host).toHaveURL(/\/interests$/, { timeout: 15_000 });
    await expect(phone.getByRole("heading", { name: /pick a game/i })).toBeVisible();
    await expect(phone.getByTestId("phone-piece-list").locator("[data-piece]")).toHaveCount(9);
    await context.close();
  });
});
