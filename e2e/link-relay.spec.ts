import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

// The phone link's networking, end to end: two browser contexts (laptop and
// phone) talk through the standalone dev relay (scripts/link-relay-dev.mjs, the
// same relay code the Vercel route runs) and the test page /lab/linktest.
// Needs `next dev` for the page (playwright.config.ts starts it) and starts the
// relay itself on LINK_RELAY_PORT (default 3311).

/* eslint-disable @typescript-eslint/no-explicit-any */
const RELAY_PORT = Number(process.env.LINK_RELAY_PORT ?? 3311);
const RELAY_HTTP = `http://localhost:${RELAY_PORT}`;
const RELAY_WS = `ws://localhost:${RELAY_PORT}`;

test.describe.configure({ mode: "serial" });

let relay: ChildProcess | null = null;

async function relayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${RELAY_HTTP}/__health`);
    return r.ok;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  if (await relayUp()) return;
  relay = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join("scripts", "link-relay-dev.mjs")], {
    env: { ...process.env, PORT: String(RELAY_PORT), REDIS_URL: "", KV_URL: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 100 && !(await relayUp()); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await relayUp())) throw new Error("dev relay did not start");
});

test.afterAll(async () => {
  relay?.kill(); // only the process this file started
  relay = null;
});

const post = (p: string) => fetch(`${RELAY_HTTP}${p}`, { method: "POST" }).then((r) => r.json());

interface Pair {
  laptopCtx: BrowserContext;
  phoneCtx: BrowserContext;
  laptop: Page;
  phone: Page;
  code: string;
}

const q = (o: Record<string, string>) => new URLSearchParams({ relay: RELAY_WS, ...o }).toString();
const status = (p: Page) => p.getByTestId("status");

async function openHost(browser: Browser, baseURL: string | undefined, extra: Record<string, string> = {}) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`/lab/linktest?${q({ role: "host", ...extra })}`);
  await expect(status(page)).toHaveAttribute("data-code", /^[A-HJ-KM-NP-Z2-9]{5}$/, { timeout: 15_000 });
  const code = (await status(page).getAttribute("data-code"))!;
  return { ctx, page, code };
}

async function openPhone(browser: Browser, baseURL: string | undefined, code: string, extra: Record<string, string> = {}) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`/lab/linktest?${q({ role: "phone", code, ...extra })}`);
  return { ctx, page };
}

async function pair(browser: Browser, baseURL: string | undefined, extra: Record<string, string> = {}): Promise<Pair> {
  const h = await openHost(browser, baseURL, extra);
  const p = await openPhone(browser, baseURL, h.code, extra);
  return { laptopCtx: h.ctx, phoneCtx: p.ctx, laptop: h.page, phone: p.page, code: h.code };
}

const live = async (...pages: Page[]) => {
  for (const p of pages) await expect(status(p)).toHaveAttribute("data-state", "live", { timeout: 20_000 });
};
const pathIs = async (want: string, ...pages: Page[]) => {
  for (const p of pages) await expect(status(p)).toHaveAttribute("data-path", want, { timeout: 20_000 });
};
const closeAll = async (...c: BrowserContext[]) => {
  for (const x of c) await x.close();
};

test.describe("phone link networking", () => {
  test("a phone joins the laptop's room by code and both go live", async ({ browser, baseURL }) => {
    const { laptopCtx, phoneCtx, laptop, phone, code } = await pair(browser, baseURL);
    await live(laptop, phone);
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}$/);
    // hello both ways
    await expect.poll(() => laptop.evaluate(() => (window as any).__t.msgs.some((m: any) => m.type === "hello" && m.role === "phone"))).toBe(true);
    await expect.poll(() => phone.evaluate(() => (window as any).__t.msgs.some((m: any) => m.type === "hello" && m.role === "host"))).toBe(true);
    await closeAll(laptopCtx, phoneCtx);
  });

  test("upgrades to a direct WebRTC channel on localhost, with an RTT", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { laptopCtx, phoneCtx, laptop, phone } = await pair(browser, baseURL);
    await pathIs("direct", laptop, phone);
    await expect
      .poll(() => laptop.evaluate(() => (window as any).__t.session.stats().rttMs), { timeout: 10_000 })
      .not.toBeNull();
    const stats = await laptop.evaluate(() => (window as any).__t.session.stats());
    expect(stats.path).toBe("direct");
    expect(stats.rttMs).toBeLessThan(200);
    await closeAll(laptopCtx, phoneCtx);
  });

  test("messages and orientation flow both ways, on the direct path", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { laptopCtx, phoneCtx, laptop, phone } = await pair(browser, baseURL);
    await pathIs("direct", laptop, phone);

    await phone.evaluate(() => {
      const s = (window as any).__t.session;
      s.send({ type: "tap", x: 0.25, y: 0.75 });
      s.send({ type: "unlock" });
    });
    await laptop.evaluate(() => (window as any).__t.session.send({ type: "screen", name: "piece", piece: "golf" }));
    await expect.poll(() => laptop.evaluate(() => (window as any).__t.msgs.filter((m: any) => m.type !== "hello"))).toEqual([
      { type: "tap", x: 0.25, y: 0.75 },
      { type: "unlock" },
    ]);
    await expect
      .poll(() => phone.evaluate(() => (window as any).__t.msgs.filter((m: any) => m.type !== "hello")))
      .toEqual([{ type: "screen", name: "piece", piece: "golf" }]);

    // orientation phone -> laptop, and laptop -> phone, a few frames each
    for (const [from, to] of [
      [phone, laptop],
      [laptop, phone],
    ] as const) {
      await from.evaluate(async () => {
        const s = (window as any).__t.session;
        for (let i = 0; i < 20; i++) {
          s.sendOrient({ seq: i, t: performance.now(), alpha: 100 + i, beta: -30.5, gamma: 4.25, screenAngle: 90 });
          await new Promise((r) => setTimeout(r, 20));
        }
      });
      await expect.poll(() => to.evaluate(() => (window as any).__t.orients.length)).toBeGreaterThan(5);
      const last = await to.evaluate(() => (window as any).__t.orients.at(-1));
      expect(last.beta).toBeCloseTo(-30.5, 3);
      expect(last.gamma).toBeCloseTo(4.25, 3);
      expect(last.screenAngle).toBe(90);
      expect(last.alpha).toBeGreaterThanOrEqual(100);
    }
    await closeAll(laptopCtx, phoneCtx);
  });

  test("falls back to the relay when the direct channel is forced closed, and traffic keeps flowing", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { laptopCtx, phoneCtx, laptop, phone } = await pair(browser, baseURL, { retry: "0" });
    await pathIs("direct", laptop, phone);
    await laptop.evaluate(() => (window as any).__t.peers[0].close());
    await pathIs("relay", laptop, phone);
    await live(laptop, phone);

    await phone.evaluate(async () => {
      const s = (window as any).__t.session;
      s.send({ type: "lock" });
      for (let i = 0; i < 10; i++) {
        s.sendOrient({ seq: 1000 + i, t: i, alpha: 7, beta: 8, gamma: 9, screenAngle: 0 });
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await expect.poll(() => laptop.evaluate(() => (window as any).__t.msgs.some((m: any) => m.type === "lock"))).toBe(true);
    await expect.poll(() => laptop.evaluate(() => (window as any).__t.orients.filter((o: any) => o.seq >= 1000).length)).toBeGreaterThan(3);
    const states = await laptop.evaluate(() => (window as any).__t.states.map((s: any) => s.join("/")));
    expect(states.slice(-2)).toEqual(["live/direct", "live/relay"]);
    await closeAll(laptopCtx, phoneCtx);
  });

  test("a dropped relay socket reconnects and resumes the session", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    // relay only (no WebRTC), so the relay is the only path and the drop is visible
    const { laptopCtx, phoneCtx, laptop, phone, code } = await pair(browser, baseURL, { direct: "0" });
    await live(laptop, phone);
    await pathIs("relay", laptop, phone);

    const r = await post(`/__drop?code=${code}&side=phone`);
    expect(r.dropped).toBe(true);
    await expect(status(laptop)).toHaveAttribute("data-state", "reconnecting", { timeout: 5_000 });
    await live(laptop, phone); // the phone reconnects after about a second and takes its seat back

    // traffic works again, in both directions
    await phone.evaluate(() => (window as any).__t.session.send({ type: "tap", x: 0.5, y: 0.5 }));
    await laptop.evaluate(() => (window as any).__t.session.send({ type: "recenter" }));
    await expect.poll(() => laptop.evaluate(() => (window as any).__t.msgs.some((m: any) => m.type === "tap"))).toBe(true);
    await expect.poll(() => phone.evaluate(() => (window as any).__t.msgs.some((m: any) => m.type === "recenter"))).toBe(true);

    // and the host's socket can drop too
    expect((await post(`/__drop?code=${code}&side=host`)).dropped).toBe(true);
    await expect(status(phone)).toHaveAttribute("data-state", "reconnecting", { timeout: 5_000 });
    await live(laptop, phone);
    const hostStates = await laptop.evaluate(() => (window as any).__t.states.map((s: any) => s[0]));
    expect(hostStates).toContain("reconnecting");
    await closeAll(laptopCtx, phoneCtx);
  });

  test("throttles orientation to about 30 Hz over the relay", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { laptopCtx, phoneCtx, laptop, phone } = await pair(browser, baseURL, { direct: "0" });
    await live(laptop, phone);
    await phone.evaluate(async () => {
      const s = (window as any).__t.session;
      const t0 = performance.now();
      let i = 0;
      while (performance.now() - t0 < 1000) {
        s.sendOrient({ seq: i, t: performance.now(), alpha: i, beta: 0, gamma: 0, screenAngle: 0 });
        i++;
        await new Promise((r) => setTimeout(r, 4)); // ~100-250 Hz of input
      }
      s.sendOrient({ seq: 99999, t: performance.now(), alpha: 1, beta: 2, gamma: 3, screenAngle: 0 });
    });
    await expect.poll(() => laptop.evaluate(() => (window as any).__t.orients.at(-1)?.seq)).toBe(99999);
    const n = await laptop.evaluate(() => (window as any).__t.orients.length);
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(45);
    await closeAll(laptopCtx, phoneCtx);
  });

  test("a wrong code closes the phone's session", async ({ browser, baseURL }) => {
    const { ctx, page } = await openPhone(browser, baseURL, "ZZZZZ");
    await expect(status(page)).toHaveAttribute("data-state", "closed", { timeout: 10_000 });
    await ctx.close();
    const bad = await openPhone(browser, baseURL, "not a code");
    await expect(status(bad.page)).toHaveAttribute("data-state", "closed", { timeout: 10_000 });
    await bad.ctx.close();
  });

  test("an expired code closes the host, and the phone joining it is closed too", async ({ browser, baseURL }) => {
    test.setTimeout(30_000);
    await post("/__limits?codeTtlMs=1500");
    try {
      const h = await openHost(browser, baseURL);
      await expect(status(h.page)).toHaveAttribute("data-state", "closed", { timeout: 10_000 });
      const p = await openPhone(browser, baseURL, h.code);
      await expect(status(p.page)).toHaveAttribute("data-state", "closed", { timeout: 10_000 });
      await closeAll(h.ctx, p.ctx);
    } finally {
      await post("/__limits?codeTtlMs=120000");
    }
  });

  test("the phone closes when the laptop leaves, and the laptop waits again when the phone leaves", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const a = await pair(browser, baseURL);
    await live(a.laptop, a.phone);
    await a.phone.evaluate(() => (window as any).__t.session.close());
    await expect(status(a.laptop)).toHaveAttribute("data-state", "waiting", { timeout: 10_000 });
    const again = await openPhone(browser, baseURL, a.code);
    await live(a.laptop, again.page);
    await a.laptop.evaluate(() => (window as any).__t.session.close());
    await expect(status(again.page)).toHaveAttribute("data-state", "closed", { timeout: 10_000 });
    await closeAll(a.laptopCtx, a.phoneCtx, again.ctx);
  });
});
