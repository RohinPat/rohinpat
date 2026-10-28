import { test, expect, type Browser, type Page } from "@playwright/test";

// Three small things around the phone-as-controller, on the BroadcastChannel
// mock session (run the dev server with NEXT_PUBLIC_LINK_MOCK=1): the "Click
// for sound" pill when a game opened from the phone has no audio yet, the
// stage heading following Cars' mode, and the buzz turning into a screen glow
// where the phone has no navigator.vibrate (Safari on iPhone).

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

type Win = { __linkPhone?: { send: (m: unknown) => void } };

async function pair(browser: Browser, baseURL: string | undefined, init?: () => void) {
  const context = await browser.newContext({ baseURL, viewport: LAPTOP, permissions: ["accelerometer", "gyroscope", "magnetometer"] });
  if (init) await context.addInitScript(init);
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
const send = (phone: Page, m: unknown) => phone.evaluate((x) => (window as unknown as Win).__linkPhone!.send(x), m);

// the Watch winds (and clicks) when the phone sends crown turns
const turnCrown = (phone: Page) => send(phone, { type: "gesture", name: "crown", data: { deg: 40 } });

const audioState = (host: Page) =>
  host.evaluate(() => {
    // the shared context is module state; read it through the page's AudioContext instances
    const all = (window as unknown as { __ctxs?: AudioContext[] }).__ctxs ?? [];
    return all.map((c) => c.state);
  });

// Playwright's browser starts with a user activation, so a real page load would get
// audio for free. Stand in for the autoplay rule: a new AudioContext starts
// suspended and resume() does nothing until a click or a key has reached the page.
const autoplayPolicy = () => {
  const w = window as unknown as { __ctxs: AudioContext[]; __gesture: boolean };
  w.__ctxs = [];
  w.__gesture = false;
  const mark = (e: Event) => {
    if (e.isTrusted) w.__gesture = true;
  };
  window.addEventListener("pointerdown", mark, true);
  window.addEventListener("keydown", mark, true);
  const AC = window.AudioContext;
  class Gated extends AC {
    constructor(o?: AudioContextOptions) {
      super(o);
      w.__ctxs.push(this);
      void super.suspend();
    }
    resume() {
      return w.__gesture ? super.resume() : new Promise<void>(() => {});
    }
  }
  window.AudioContext = Gated as typeof AC;
};

test.describe("Click for sound", () => {
  test("a game opened from the phone asks for one click; clicking it starts audio and the pill goes", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await pair(browser, baseURL, autoplayPolicy);
    await phone.locator('[data-piece="watch"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await expect(phone.getByTestId("phone-piece")).toBeVisible();
    // nobody has touched the laptop: nothing to ask for until the game makes a sound
    await expect(host.getByTestId("sound-prompt")).toHaveCount(0);
    await turnCrown(phone);
    const pill = host.getByTestId("sound-prompt");
    await expect(pill).toBeVisible(SLOW);
    await expect(pill).toHaveText(/click for sound/i);
    expect(await audioState(host)).toEqual(["suspended"]);
    // told to the phone as well
    await expect(phone.getByTestId("phone-sound-note")).toHaveText(/tap the laptop once for sound/i);
    // it is a button in the dialog, and it did not move focus off the game
    expect(await pill.evaluate((el) => el.tagName)).toBe("BUTTON");
    expect(await host.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Click for sound")).toBe(false);
    await pill.click();
    await expect(pill).toHaveCount(0, SLOW);
    await expect.poll(() => audioState(host)).toEqual(["running"]);
    await expect(phone.getByTestId("phone-sound-note")).toHaveCount(0);
    await context.close();
  });

  test("a key press on the laptop starts audio too, and the pill can be used from the keyboard", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await pair(browser, baseURL, autoplayPolicy);
    await phone.locator('[data-piece="watch"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await turnCrown(phone);
    const pill = host.getByTestId("sound-prompt");
    await expect(pill).toBeVisible(SLOW);
    // Tab reaches it inside the dialog; Enter presses it and focus goes back to the game
    await pill.focus();
    await expect(pill).toBeFocused();
    await host.keyboard.press("Enter");
    await expect(pill).toHaveCount(0, SLOW);
    await expect.poll(() => host.evaluate(() => document.activeElement?.hasAttribute("data-autofocus"))).toBe(true);
    await context.close();

    const b = await pair(browser, baseURL, autoplayPolicy);
    await b.phone.locator('[data-piece="watch"]').click();
    await expect(stage(b.host)).toBeVisible(SLOW);
    await turnCrown(b.phone);
    await expect(b.host.getByTestId("sound-prompt")).toBeVisible(SLOW);
    await b.host.keyboard.press("ArrowRight");
    await expect(b.host.getByTestId("sound-prompt")).toHaveCount(0, SLOW);
    await b.context.close();
  });

  test("a game opened with the mouse never shows it, even once it makes a sound", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    await context.addInitScript(autoplayPolicy);
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="keyboard"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    // typing is the click's successor: the browser lets the sound through.
    // The keyboard only sounds once its model has loaded, so keep typing.
    await expect
      .poll(async () => {
        await page.keyboard.press("a");
        return audioState(page);
      }, { timeout: 30_000, intervals: [1000] })
      .toEqual(["running"]);
    await expect(page.getByTestId("sound-prompt")).toHaveCount(0);
    await context.close();
  });
});

test.describe("Cars: the title follows the mode", () => {
  test("Night run, then Drag strip, then Night run again, on the laptop and on the phone", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await pair(browser, baseURL);
    await phone.locator('[data-piece="engine"]').click();
    await expect(stage(host)).toBeVisible(SLOW);
    await expect(stage(host).getByRole("heading", { level: 2 })).toHaveText("Night run");
    await expect(phone.getByTestId("phone-piece-mode")).toHaveText(/night run/i, SLOW);
    await host.getByTestId("engine-mode-drag").click();
    await expect(stage(host).getByRole("heading", { level: 2 })).toHaveText("Drag strip");
    await expect(stage(host)).toHaveAccessibleName("Drag strip");
    await expect(phone.getByTestId("phone-piece-mode")).toHaveText(/drag strip/i, SLOW);
    await host.getByTestId("engine-mode-night").click();
    await expect(stage(host).getByRole("heading", { level: 2 })).toHaveText("Night run");
    await context.close();
  });

  test("with no phone: the mouse-opened stage follows too, and a new stage starts on its own title", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await page.goto("/interests");
    await page.locator('[data-piece="engine"]').click();
    await expect(stage(page)).toBeVisible(SLOW);
    await page.getByTestId("engine-mode-drag").click();
    await expect(stage(page).getByRole("heading", { level: 2 })).toHaveText("Drag strip");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(stage(page)).toHaveCount(0);
    await page.locator('[data-piece="watch"]').click();
    await expect(stage(page).getByRole("heading", { level: 2 })).toHaveText("Wind it, then take it apart", SLOW);
    await context.close();
  });
});

test.describe("Haptics without navigator.vibrate", () => {
  const noVibrate = () => {
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
  };

  // the Drag strip controller buzzes 25 ms when Shift is tapped
  async function onTheStrip(browser: Browser, baseURL: string | undefined, init?: () => void) {
    const r = await pair(browser, baseURL, init);
    await r.phone.locator('[data-piece="engine"]').click();
    await expect(stage(r.host)).toBeVisible(SLOW);
    await r.host.getByTestId("engine-mode-drag").click();
    await expect(r.phone.getByTestId("engine-shift")).toBeVisible(SLOW);
    return r;
  }

  test("a buzz becomes a glow on the phone's screen, then goes", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, host, phone } = await onTheStrip(browser, baseURL, noVibrate);
    expect(await phone.evaluate(() => typeof navigator.vibrate)).toBe("undefined");
    await expect(phone.getByTestId("buzz-flash")).toHaveCount(0);
    await phone.getByTestId("engine-shift").click();
    const glow = phone.getByTestId("buzz-flash");
    await expect(glow).toHaveCount(1);
    await expect(glow).toHaveAttribute("aria-hidden", "true");
    await expect(glow).toHaveAttribute("data-reduced", "false");
    expect(await glow.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    expect(await glow.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
    expect(await glow.getAttribute("data-strength")).toBe("0.42");
    await expect(glow).toHaveCount(0);
    await expect(host.getByTestId("buzz-flash")).toHaveCount(0);
    await context.close();
  });

  test("under reduced motion it is a faint tint, not a glow", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, phone } = await onTheStrip(browser, baseURL, noVibrate);
    await phone.emulateMedia({ reducedMotion: "reduce" });
    await phone.getByTestId("engine-shift").click();
    const glow = phone.getByTestId("buzz-flash");
    await expect(glow).toHaveCount(1);
    await expect(glow).toHaveAttribute("data-reduced", "true");
    expect(await glow.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
    await expect(glow).toHaveCount(0);
    await context.close();
  });

  test("where the browser can vibrate it vibrates and draws nothing", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { context, phone } = await onTheStrip(browser, baseURL, () => {
      const w = window as unknown as { __buzzed: unknown[] };
      w.__buzzed = [];
      navigator.vibrate = ((p: VibratePattern) => (w.__buzzed.push(p), true)) as typeof navigator.vibrate;
    });
    await phone.getByTestId("engine-shift").click();
    expect(await phone.evaluate(() => (window as unknown as { __buzzed: unknown[] }).__buzzed)).toContain(25);
    await expect(phone.getByTestId("buzz-flash")).toHaveCount(0);
    await context.close();
  });
});
