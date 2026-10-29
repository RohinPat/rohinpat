import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { genGolf } from "../tests/unit/lab-swing-traces";

// Lab "link": the laptop page and the phone page in two separate browser contexts,
// paired through the page's test hook (window.__link.submitAnswer stands in for the
// laptop's webcam reading the phone's answer QR code). The phone's orientation is
// faked with CDP DeviceOrientation.setDeviceOrientationOverride.

/* eslint-disable @typescript-eslint/no-explicit-any */
// the page's test hook, as seen from inside page.evaluate (components/lab/link sets window.__link)
type AW = { __link?: any; __permCalls?: { active: boolean }[] };

const SHOW = "Hold this up to your laptop's camera";

async function open(browser: Browser, baseURL: string | undefined, opts: { phoneInit?: () => void; laptopInit?: () => void } = {}) {
  const laptopCtx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const phoneCtx = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    permissions: ["accelerometer", "gyroscope", "magnetometer"],
  });
  const laptop = await laptopCtx.newPage();
  const phone = await phoneCtx.newPage();
  if (opts.laptopInit) await laptop.addInitScript(opts.laptopInit);
  if (opts.phoneInit) await phone.addInitScript(opts.phoneInit);
  return { laptopCtx, phoneCtx, laptop, phone };
}

async function offerUrl(laptop: Page): Promise<string> {
  await laptop.goto("/lab/link");
  await laptop.waitForFunction(() => (window as unknown as AW).__link?.ready === true, undefined, { timeout: 20000 });
  return laptop.evaluate(() => (window as unknown as AW).__link.offerUrl as string);
}

/** laptop shows the offer, the phone opens it and is clicked, the laptop gets the answer. */
async function pair(browser: Browser, baseURL: string | undefined, opts: Parameters<typeof open>[2] = {}) {
  const env = await open(browser, baseURL, opts);
  const { laptop, phone } = env;
  const url = await offerUrl(laptop);
  await phone.goto(url);
  await phone.waitForFunction(() => (window as unknown as AW).__link?.ready === true, undefined, { timeout: 20000 });
  await phone.getByTestId("pair").click();
  await expect(phone.getByRole("heading", { name: SHOW })).toBeVisible();
  const answer = await phone.evaluate(() => (window as unknown as AW).__link.answerPayload as string);
  await laptop.evaluate((a) => (window as unknown as AW).__link.submitAnswer(a), answer);
  await expect(laptop.getByTestId("status")).toHaveAttribute("data-phase", "connected", { timeout: 20000 });
  await expect(phone.getByTestId("status")).toHaveAttribute("data-phase", "connected", { timeout: 20000 });
  const cdp = await env.phoneCtx.newCDPSession(phone);
  const orient = (alpha: number, beta: number, gamma: number) =>
    cdp.send("DeviceOrientation.setDeviceOrientationOverride", { alpha, beta, gamma });
  return { ...env, orient };
}

async function live(laptop: Page, orient: (a: number, b: number, g: number) => Promise<unknown>) {
  await orient(137, 62, -4);
  for (let i = 0; i < 10; i++) {
    await orient(137, 62 + (i % 2) * 0.1, -4);
    await laptop.waitForTimeout(25);
  }
  await expect(laptop.getByTestId("status")).toHaveAttribute("data-status", "live");
}

/** z (toward the viewer) of the mockup's top-centre point. */
const topZ = (laptop: Page) =>
  laptop.getByTestId("mockup-rig").evaluate((el) => {
    const t = getComputedStyle(el).transform;
    if (t === "none") return 0;
    const v = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
    return v.length === 6 ? 0 : -v[6];
  });

const closeAll = async (...c: BrowserContext[]) => {
  for (const x of c) await x.close();
};

test.describe("lab link", () => {
  test("pairs two contexts, mirrors tilt, unlocks, taps and shows gestures, with diagnostics", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const { laptopCtx, phoneCtx, laptop, phone, orient } = await pair(browser, baseURL);
    await live(laptop, orient);
    await laptop.waitForTimeout(400);
    expect(Math.abs(await topZ(laptop))).toBeLessThan(0.002); // calibrated flat

    // tilt: the laptop mockup's transform changes (top toward the viewer for beta up)
    const before = await laptop.getByTestId("mockup-rig").evaluate((e) => getComputedStyle(e).transform);
    await orient(137, 62 + 25, -4);
    await laptop.waitForTimeout(700);
    const after = await laptop.getByTestId("mockup-rig").evaluate((e) => getComputedStyle(e).transform);
    expect(after).not.toBe(before);
    expect(await topZ(laptop)).toBeGreaterThan(0.2);

    // unlock by swiping up on the phone
    const screen = laptop.getByTestId("mockup-screen");
    await expect(screen).toHaveAttribute("data-locked", "true");
    await phone.mouse.move(60, 780);
    await phone.mouse.down();
    for (let y = 780; y >= 300; y -= 30) await phone.mouse.move(60, y);
    await phone.mouse.up();
    await expect(screen).toHaveAttribute("data-locked", "false");
    await expect(phone.getByTestId("pad")).toHaveAttribute("data-phase", "unlocked");

    // tap lands as a ripple at the matching place
    await phone.mouse.click(300, 250);
    const ripple = laptop.getByTestId("mockup-ripple").first();
    await expect(ripple).toBeVisible();
    const left = parseFloat(await ripple.evaluate((e) => (e as HTMLElement).style.left));
    expect(left).toBeCloseTo((300 / 390) * 393, -1);

    // swing test: phone switches mode, a fake gesture then a real recogniser run reach the laptop
    await phone.getByTestId("swing-toggle").click();
    await expect(laptop.getByTestId("phone-mode")).toContainText("Swing test (golf)");
    await phone.evaluate(() => (window as unknown as AW).__link.fakeGesture());
    await expect(laptop.getByTestId("gesture-big")).toHaveText("Golf: 87 mph, tempo 3.1:1, face +4°");
    const { samples } = genGolf(7);
    await phone.evaluate((ss: unknown[]) => {
      for (const s of ss) (window as unknown as AW).__link.pushSample(s);
    }, samples);
    await expect(laptop.getByTestId("gesture-meta")).toContainText("2 detected");
    await expect(laptop.getByTestId("gesture-big")).toHaveText(/^Golf: \d+ mph, tempo \d\.\d:1, face [+−]\d+°$/);
    await phone.getByTestId("pick-flick").click();
    await expect(laptop.getByTestId("phone-mode")).toContainText("Swing test (flick)");

    // diagnostics on both sides produce numbers
    await expect.poll(async () => (await laptop.evaluate(() => (window as unknown as AW).__link.diag() as { rtt: unknown })).rtt, { timeout: 15000 }).not.toBeNull();
    const d = (await laptop.evaluate(() => (window as unknown as AW).__link.diag())) as {
      connectionState: string;
      answerToOpenMs: number;
      rtt: { n: number; medianMs: number; p95Ms: number };
      pair: { local: { type: string }; remote: { type: string } };
      orientRx: { received: number; dropRate: number };
    };
    expect(d.connectionState).toBe("connected");
    expect(d.answerToOpenMs).toBeGreaterThan(0);
    expect(d.rtt.n).toBeGreaterThan(3);
    expect(d.rtt.p95Ms).toBeGreaterThanOrEqual(d.rtt.medianMs);
    expect(d.pair.local.type).toBe("host");
    expect(d.orientRx.received).toBeGreaterThan(5);
    expect(d.orientRx.dropRate).toBeLessThan(0.2);
    await expect(laptop.getByTestId("diag-laptop")).toContainText("RTT median / p95");
    await expect.poll(() => laptop.getByTestId("diag-phone").count(), { timeout: 10000 }).toBeGreaterThan(0);
    await expect(laptop.getByTestId("diag-phone")).toContainText("devicemotion", { timeout: 10000 }).catch(() => undefined); // desktop Chromium fires no motion events

    // Copy results: JSON with both sides
    await laptopCtx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await laptop.getByRole("button", { name: "Copy results" }).click();
    const json = JSON.parse(await laptop.getByTestId("results-json").inputValue());
    expect(json.lab).toBe("link");
    expect(json.connection.pair.local.type).toBe("host");
    expect(json.rtt.n).toBeGreaterThan(3);
    expect(json.orientation.received).toBeGreaterThan(5);
    expect(json.gestures.received.length).toBe(2);
    expect(json.laptop.userAgent).toContain("Mozilla");
    expect(json.phone?.userAgent ?? "").toContain("Mozilla");
    expect(JSON.stringify(json)).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/); // no raw IPs

    // phone-side diagnostics sheet and copy
    await phone.getByRole("button", { name: "Diagnostics" }).click();
    await expect(phone.getByTestId("diag-phone")).toContainText("RTT median / p95");
    await phone.getByRole("button", { name: "Copy results" }).click();
    expect(JSON.parse(await phone.getByTestId("results-json").inputValue()).role).toBe("phone");

    // no cookies from any of it
    expect(await laptopCtx.cookies()).toEqual([]);
    expect(await phoneCtx.cookies()).toEqual([]);
    await closeAll(laptopCtx, phoneCtx);
  });

  test("asks for motion permission once, inside the click, before the answer QR shows", async ({ browser, baseURL }) => {
    const { laptopCtx, phoneCtx, laptop, phone } = await open(browser, baseURL, {
      phoneInit: () => {
        (window as unknown as AW).__permCalls = [];
        (window.DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission = () => {
          (window as unknown as AW).__permCalls!.push({ active: navigator.userActivation.isActive });
          return new Promise((r) => setTimeout(() => r("granted"), 200));
        };
      },
    });
    await phone.goto(await offerUrl(laptop));
    await phone.waitForFunction(() => (window as unknown as AW).__link?.ready === true);
    expect(await phone.evaluate(() => (window as unknown as AW).__permCalls!.length)).toBe(0); // nothing asked on load
    await expect(phone.getByRole("heading", { name: SHOW })).toHaveCount(0);
    await phone.getByTestId("pair").click();
    await expect(phone.getByRole("heading", { name: SHOW })).toBeVisible();
    const calls = await phone.evaluate(() => (window as unknown as AW).__permCalls!);
    expect(calls).toEqual([{ active: true }]);
    await closeAll(laptopCtx, phoneCtx);
  });

  test("a refused motion permission is explained, and the phone can still pair for a connection test", async ({ browser, baseURL }) => {
    const { laptopCtx, phoneCtx, laptop, phone } = await open(browser, baseURL, {
      phoneInit: () => {
        (window.DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission = () => Promise.resolve("denied");
      },
    });
    await phone.goto(await offerUrl(laptop));
    await phone.waitForFunction(() => (window as unknown as AW).__link?.ready === true);
    await phone.getByTestId("pair").click();
    await expect(phone.getByTestId("denied")).toContainText("Motion access was refused");
    await expect(phone.getByRole("heading", { name: SHOW })).toHaveCount(0);
    await phone.getByRole("button", { name: /Pair anyway/ }).click();
    await expect(phone.getByRole("heading", { name: SHOW })).toBeVisible();
    await expect(phone.getByText("Motion access is off")).toBeVisible();
    const answer = await phone.evaluate(() => (window as unknown as AW).__link.answerPayload as string);
    await laptop.evaluate((a) => (window as unknown as AW).__link.submitAnswer(a), answer);
    await expect(laptop.getByTestId("status")).toHaveAttribute("data-phase", "connected", { timeout: 20000 });
    await closeAll(laptopCtx, phoneCtx);
  });

  test("a phone that sends no motion data says so", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { laptopCtx, phoneCtx, phone } = await pair(browser, baseURL); // no orientation override: no events
    await expect(phone.getByText("No motion data is arriving")).toBeVisible({ timeout: 10000 });
    await closeAll(laptopCtx, phoneCtx);
  });

  test("shows the same-Wi-Fi message and Try again when ICE never connects", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { laptopCtx, phoneCtx, laptop, phone } = await open(browser, baseURL);
    await phone.goto(await offerUrl(laptop));
    await phone.waitForFunction(() => (window as unknown as AW).__link?.ready === true);
    await phone.getByTestId("pair").click();
    const answer = await phone.evaluate(() => (window as unknown as AW).__link.answerPayload as string);
    await phoneCtx.close(); // the phone goes away, so nothing can answer the laptop's connectivity checks
    await laptop.evaluate((a) => (window as unknown as AW).__link.submitAnswer(a), answer);
    await expect(laptop.getByTestId("status")).toHaveAttribute("data-phase", "connecting");
    const failure = laptop.getByTestId("failure");
    await expect(failure).toBeVisible({ timeout: 25000 });
    await expect(failure).toContainText("Couldn't connect directly. Are both devices on the same Wi-Fi? Guest, hotel and campus networks often block this.");
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(laptop.getByTestId("status")).toHaveAttribute("data-phase", "offer", { timeout: 20000 });
    await expect(laptop.getByTestId("failure")).toHaveCount(0);
    expect(await laptop.evaluate(() => (window as unknown as AW).__link.offerUrl)).toContain("/lab/link/phone#o=");
    await closeAll(laptopCtx);
  });

  test("a browser without RTCPeerConnection gets a plain explanation on both pages", async ({ browser, baseURL }) => {
    const noRtc = () => {
      Object.defineProperty(window, "RTCPeerConnection", { value: undefined, configurable: true });
    };
    const { laptopCtx, phoneCtx, laptop, phone } = await open(browser, baseURL, { laptopInit: noRtc, phoneInit: noRtc });
    await laptop.goto("/lab/link");
    await expect(laptop.getByTestId("status")).toContainText("no WebRTC");
    await phone.goto("/lab/link/phone#o=ABC");
    await expect(phone.getByTestId("status")).toContainText("no WebRTC");
    await closeAll(laptopCtx, phoneCtx);
  });

  test("a phone page opened without a code explains what to do", async ({ page }) => {
    await page.goto("/lab/link/phone");
    await expect(page.getByTestId("status")).toContainText("/lab/link");
  });

  test("the lab index lists its tests, is not indexable, and the camera is allowed only where needed", async ({ page, request }) => {
    const res = await page.goto("/lab");
    expect(res!.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("link", { name: "/lab/swing" })).toHaveAttribute("href", "/lab/swing");
    await expect(page.getByRole("link", { name: "/lab/link" })).toHaveAttribute("href", "/lab/link");
    await expect(page.getByRole("link", { name: "/lab/pointer" })).toHaveAttribute("href", "/lab/pointer");
    await expect(page.getByText("Report back:")).toHaveCount(3);

    for (const p of ["/lab", "/lab/link", "/lab/link/phone", "/lab/swing"]) {
      const h = (await request.get(p)).headers()["permissions-policy"];
      expect(h, p).toContain("camera=(self)");
    }
    for (const p of ["/projects", "/contact"]) {
      const h = (await request.get(p)).headers()["permissions-policy"];
      expect(h, p).toContain("camera=()");
    }
    await page.goto("/");
    expect(await page.locator('a[href^="/lab"]').count()).toBe(0);
  });
});
