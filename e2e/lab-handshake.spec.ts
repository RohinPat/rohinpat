import { test, expect, chromium, webkit, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { answerQr } from "../lib/lab/handshake/qr";
import { renderFrame, type SimOptions } from "../lib/lab/handshake/sim";

// Two browser contexts on localhost: one is the "laptop", one is the "phone".
// Run with PORT=3201. Results are written to HS_OUT (default: scratchpad lab-out).
const OUT =
  process.env.HS_OUT ??
  "C:/Users/rohin/AppData/Local/Temp/claude/C--Users-rohin-Documents-NLP-programming/02091cd0-b508-4be1-a47e-6ce728796fdb/scratchpad/bruno/lab-out/handshake";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3201}`;

type HS = Record<string, any>;
const hs = <T,>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, a]) => (window as unknown as { __hs: HS }).__hs[f as string](...(a as unknown[])), [fn, args] as [string, unknown[]]) as Promise<T>;
const get = <T,>(page: Page, key: string): Promise<T> =>
  page.evaluate((k) => (window as unknown as { __hs: HS }).__hs[k], key) as Promise<T>;

function save(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 1));
}

async function ready(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __hs?: HS }).__hs?.ready === true, undefined, { timeout: 20000 });
}

async function pairQr(laptop: Page, phone: Page) {
  const t0 = Date.now();
  await laptop.goto(`${BASE}/lab/handshake`);
  await ready(laptop);
  const tOffer = Date.now() - t0;
  const url = await get<string>(laptop, "offerUrl");
  const t1 = Date.now();
  await phone.goto(url); // exactly what the phone's camera app would open
  await phone.waitForFunction(() => (window as unknown as { __hs?: HS }).__hs?.answerPayload, undefined, { timeout: 20000 });
  const tAnswer = Date.now() - t1;
  const answer = await get<string>(phone, "answerPayload");
  const t2 = Date.now();
  await laptop.evaluate((a) => (window as unknown as { __hs: HS }).__hs.submitAnswer(a), answer); // stands in for the camera scan
  await ready(phone);
  await Promise.all([hs(laptop, "whenOpen"), hs(phone, "whenOpen")]);
  const tOpen = Date.now() - t2;
  return { tOfferMs: tOffer, tAnswerMs: tAnswer, tAnswerToOpenMs: tOpen, tTotalMs: Date.now() - t0 };
}

async function pairRelay(laptop: Page, phone: Page) {
  const t0 = Date.now();
  await laptop.goto(`${BASE}/lab/handshake?mode=relay`);
  await ready(laptop);
  const tOffer = Date.now() - t0;
  const url = await get<string>(laptop, "offerUrl");
  const t1 = Date.now();
  await phone.goto(url);
  await ready(phone);
  await Promise.all([hs(laptop, "whenOpen"), hs(phone, "whenOpen")]);
  const tOpen = Date.now() - t1;
  const relay = await get<Record<string, number>>(laptop, "relayInfo");
  const phoneTimes = await phone.evaluate(() => {
    const h = (window as unknown as { __hs: HS }).__hs;
    return { getOfferMs: h.getOfferMs, postAnswerMs: h.postAnswerMs };
  });
  return { tOfferMs: tOffer, tPhoneOpenToConnectedMs: tOpen, tTotalMs: Date.now() - t0, relay, phoneTimes };
}

async function measure(laptop: Page, phone: Page) {
  const iceServers = await get<unknown[]>(laptop, "iceServers");
  const sctpNow = await hs<unknown>(laptop, "sctp");
  const pings = await laptop.evaluate(async () => {
    const h = (window as unknown as { __hs: HS }).__hs;
    const raw: number[] = await h.pingRaw(200);
    return raw;
  });
  const sorted = [...pings].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  const ping = { n: pings.length, minMs: sorted[0], medianMs: pct(50), p95Ms: pct(95), p99Ms: pct(99), maxMs: sorted[sorted.length - 1] };

  // 60 Hz orientation stream, phone -> laptop, unordered + maxRetransmits 0
  await hs(laptop, "resetMotion");
  const sent = await hs<number>(phone, "startMotion", 60, 10);
  await laptop.waitForTimeout(500);
  const motion60 = await hs<Record<string, unknown>>(laptop, "motionAnalysis", sent);

  // stress: 5000 messages as fast as send() allows (shows the channel can drop)
  await hs(laptop, "resetMotion");
  const blasted = await hs<number>(phone, "blast", 5000);
  await laptop.waitForTimeout(1500);
  const blast = await hs<Record<string, unknown>>(laptop, "motionAnalysis", blasted);

  // overload: 3000 x 16 KB back-to-back (48 MB) into the unordered, maxRetransmits:0 channel
  await hs(laptop, "resetMotion");
  const big = await hs<{ attempted: number; accepted: number; threw: number; bufferedAmount: number }>(phone, "blastBig", 3000, 16000);
  await laptop.waitForTimeout(4000);
  const bigRx = await hs<number>(laptop, "motionSeqs");
  const bigResult = { ...big, receivedByLaptop: bigRx, lostAfterAccepted: big.accepted - bigRx };

  const pairL = await hs<unknown>(laptop, "selectedPair");
  const pairP = await hs<unknown>(phone, "selectedPair");
  const candL = await hs<unknown>(laptop, "localCandidates");
  const candP = await hs<unknown>(phone, "localCandidates");
  return { iceServers, sctpNow, ping, rawPingsHead: pings.slice(0, 20), motion60, blast, bigResult, selected: { laptop: pairL, phone: pairP }, candidates: { laptop: candL, phone: candP } };
}

async function newPair(browserA: Browser, browserB: Browser = browserA) {
  const lc: BrowserContext = await browserA.newContext({ viewport: { width: 1280, height: 800 } });
  const pc: BrowserContext = await browserB.newContext({ viewport: { width: 390, height: 844 } });
  return { laptop: await lc.newPage(), phone: await pc.newPage(), close: async () => { await lc.close(); await pc.close(); } };
}

test.describe.configure({ mode: "serial" });

for (const variant of [
  { name: "default", args: [] as string[] },
  { name: "no-mdns", args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
]) {
  test(`mode B relay pairing + data channel metrics [chromium ${variant.name}]`, async () => {
    test.setTimeout(120000);
    const browser = await chromium.launch({ args: variant.args });
    const { laptop, phone, close } = await newPair(browser);
    try {
      const pairing = await pairRelay(laptop, phone);
      const report = await get<Record<string, unknown>>(laptop, "report");
      const m = await measure(laptop, phone);
      save(`relay-${variant.name}.json`, { pairing, report, ...m });
      expect(m.iceServers).toEqual([]);
      expect((m.sctpNow as { ctrl: { ordered: boolean }; motion: { ordered: boolean; maxRetransmits: number } }).motion).toMatchObject({ ordered: false, maxRetransmits: 0 });
      expect((m.motion60 as { received: number }).received).toBeGreaterThan(0);
    } finally {
      await close();
      await browser.close();
    }
  });

  test(`mode A two-way QR (answer via test hook) + metrics [chromium ${variant.name}]`, async () => {
    test.setTimeout(120000);
    const browser = await chromium.launch({ args: variant.args });
    const { laptop, phone, close } = await newPair(browser);
    try {
      const pairing = await pairQr(laptop, phone);
      const report = await get<Record<string, unknown>>(laptop, "report");
      const phoneReport = await get<Record<string, unknown>>(phone, "report");
      const m = await measure(laptop, phone);
      const rawSdp = await get<string>(laptop, "rawSdp");
      const rawAnswer = await phone.evaluate(() => (window as unknown as { __hs: HS }).__hs.peer.pc.localDescription.sdp as string);
      save(`qr-${variant.name}.json`, { pairing, report, phoneReport, ...m, rawSdp, rawAnswer });
      expect(m.iceServers).toEqual([]);
      expect((m.ping as { n: number }).n).toBe(200);
    } finally {
      await close();
      await browser.close();
    }
  });
}

test("mode A with WebKit as the phone and Chromium as the laptop", async () => {
  test.setTimeout(120000);
  const cb = await chromium.launch();
  let wb: Browser | null = null;
  try {
    wb = await webkit.launch();
  } catch (e) {
    save("qr-webkit.json", { skipped: String(e) });
    await cb.close();
    test.skip(true, "webkit unavailable");
    return;
  }
  const probe = await (await wb.newContext()).newPage();
  const hasRtc = await probe.evaluate(() => typeof RTCPeerConnection !== "undefined");
  if (!hasRtc) {
    save("qr-webkit.json", { skipped: "Playwright WebKit on this platform has no RTCPeerConnection", ua: await probe.evaluate(() => navigator.userAgent) });
    await cb.close();
    await wb.close();
    test.skip(true, "Playwright WebKit build has no WebRTC");
    return;
  }
  const { laptop, phone, close } = await newPair(cb, wb);
  try {
    const pairing = await pairQr(laptop, phone);
    const report = await get<Record<string, unknown>>(laptop, "report");
    const phoneReport = await get<Record<string, unknown>>(phone, "report");
    const ping = await laptop.evaluate(async () => (window as unknown as { __hs: HS }).__hs.runPings(50));
    save("qr-webkit.json", { pairing, report, phoneReport, ping });
  } catch (e) {
    save("qr-webkit.json", { failed: String(e) });
    throw e;
  } finally {
    await close();
    await cb.close();
    await wb.close();
  }
});

// ---- camera path: Chromium fake video device fed with a rendered answer QR ----

function writeY4m(file: string, frames: { data: Uint8ClampedArray; width: number; height: number }[]) {
  const { width: w, height: h } = frames[0];
  const parts: Buffer[] = [Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`)];
  for (const f of frames) {
    const y = Buffer.alloc(w * h);
    for (let i = 0; i < w * h; i++) y[i] = f.data[i * 4];
    parts.push(Buffer.from("FRAME\n"), y, Buffer.alloc((w * h) / 2, 128));
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}

async function camRun(w: number, h: number, fill: number, sim: Partial<SimOptions>, label: string) {
  const y4m = path.join(OUT, `cam-${label}.y4m`);
  fs.mkdirSync(OUT, { recursive: true });
  writeY4m(y4m, [renderFrame(answerQr("A".repeat(20)), { width: w, height: h, fill })]); // placeholder
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${y4m}`,
    ],
  });
  const { laptop, phone, close } = await newPair(browser);
  try {
    // the site's Permissions-Policy header says camera=() on this route; strip it for the positive test
    await laptop.route("**/lab/handshake", async (route) => {
      const resp = await route.fetch();
      const headers = { ...resp.headers() };
      headers["permissions-policy"] = "camera=(self)";
      await route.fulfill({ response: resp, headers });
    });
    await laptop.goto(`${BASE}/lab/handshake`);
    await ready(laptop);
    await phone.goto(await get<string>(laptop, "offerUrl"));
    await phone.waitForFunction(() => (window as unknown as { __hs?: HS }).__hs?.answerPayload);
    const payload = await get<string>(phone, "answerPayload");
    const q = answerQr(payload);
    const frames = [1, 2, 3, 4].map((seed) => renderFrame(q, { width: w, height: h, fill, seed, ...sim }));
    writeY4m(y4m, frames);
    const t0 = Date.now();
    await laptop.getByRole("button", { name: /open camera/i }).click();
    await Promise.all([hs(laptop, "whenOpen"), hs(phone, "whenOpen")]);
    const scanToOpenMs = Date.now() - t0;
    const stats = await get<unknown>(laptop, "scanStats");
    return { w, h, fill, sim, qrVersion: q.version, scanToOpenMs, stats, ok: true };
  } catch (e) {
    const stats = await get<unknown>(laptop, "scanStats").catch(() => null);
    const status = await laptop.getByTestId("status").textContent().catch(() => null);
    return { w, h, fill, sim, ok: false, error: String(e).slice(0, 200), stats, status };
  } finally {
    await close();
    await browser.close();
  }
}

// The POC found the site-wide camera=() header blocked the scanner here; the
// lab now gets camera=(self) (next.config.mjs), and everywhere else keeps it off.
test("camera: allowed on /lab, still off elsewhere", async ({ request }) => {
  const lab = await request.get(`${BASE}/lab/handshake`);
  expect(lab.headers()["permissions-policy"]).toContain("camera=(self)");
  const other = await request.get(`${BASE}/projects`);
  expect(other.headers()["permissions-policy"]).toContain("camera=()");
});

for (const c of [
  { label: "640x480-clean", w: 640, h: 480, fill: 0.7, sim: {} },
  { label: "640x480-screen", w: 640, h: 480, fill: 0.6, sim: { angleDeg: 6, blur: 1, noise: 3, contrast: 0.6 } },
  { label: "640x480-lowlight", w: 640, h: 480, fill: 0.7, sim: { angleDeg: 6, blur: 1, noise: 8, contrast: 0.5 } },
  { label: "320x240-screen", w: 320, h: 240, fill: 0.8, sim: { angleDeg: 6, blur: 1, noise: 3, contrast: 0.6 } },
]) {
  test(`camera scan end to end [${c.label}]`, async () => {
    test.setTimeout(90000);
    const r = await camRun(c.w, c.h, c.fill, c.sim, c.label);
    save(`camera-${c.label}.json`, r);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
}

test("pairing latency over 10 repeats, both modes", async () => {
  test.setTimeout(240000);
  const browser = await chromium.launch();
  const qr: Awaited<ReturnType<typeof pairQr>>[] = [];
  const relay: Awaited<ReturnType<typeof pairRelay>>[] = [];
  try {
    for (let i = 0; i < 10; i++) {
      for (const mode of ["qr", "relay"] as const) {
        const { laptop, phone, close } = await newPair(browser);
        try {
          if (mode === "qr") qr.push(await pairQr(laptop, phone));
          else relay.push(await pairRelay(laptop, phone));
        } finally {
          await close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  const stat = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
  };
  const summary = {
    qr: {
      total: stat(qr.map((r) => r.tTotalMs)),
      offerReady: stat(qr.map((r) => r.tOfferMs)),
      phoneAnswer: stat(qr.map((r) => r.tAnswerMs)),
      answerToOpen: stat(qr.map((r) => r.tAnswerToOpenMs)),
    },
    relay: {
      total: stat(relay.map((r) => r.tTotalMs)),
      phoneOpenToConnected: stat(relay.map((r) => r.tPhoneOpenToConnectedMs)),
      postOffer: stat(relay.map((r) => r.relay.postOfferMs)),
      getOffer: stat(relay.map((r) => r.phoneTimes.getOfferMs as number)),
      postAnswer: stat(relay.map((r) => r.phoneTimes.postAnswerMs as number)),
      pollsUntilAnswer: stat(relay.map((r) => r.relay.polls)),
      lastPoll: stat(relay.map((r) => r.relay.lastPollMs)),
    },
  };
  save("pairing-repeats.json", { summary, qr, relay });
  expect(qr.length).toBe(10);
  expect(relay.length).toBe(10);
});
