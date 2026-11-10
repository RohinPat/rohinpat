import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Golf: the course, on its own page (/golf). One hole is played start to finish with the keyboard in the real page;
// the numbers behind it (the bots, the lies, the scoring) are in tests/unit/golf-*.test.ts. Kept short: a bounded
// loop, the ball sped up with a press while it flies.

const SLOW = { timeout: 15_000 };
/** the last thing the game said (the page reads them out as a log) */
const live = (p: Page) => p.locator('[role="log"] p').last();
/** everything it said lately, oldest first */
const said = (p: Page) => p.locator('[role="log"] p').allTextContents();
const phase = (p: Page) => p.locator("[data-golf-phase]").getAttribute("data-golf-phase");
const axe = (p: Page) => new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

async function openPlay(p: Page) {
  await p.goto("/golf?linkmock");
  await p.getByRole("button", { name: /Nine holes/ }).click();
  await expect(p.locator("[data-golf-phase]")).toBeVisible(SLOW);
  await p.waitForFunction(() => !!(window as unknown as { __golf?: unknown }).__golf, null, SLOW);
  await p.locator("canvas[data-autofocus]").focus();
}

type Win = { __golf: { yawT: number; phase: string; mapOpen: boolean; mapView: { x: number; y: number; w: number; h: number } | null; [k: string]: unknown } };
/** the game's own state, from the page (the mock-link build exposes it) */
const state = (p: Page) =>
  p.evaluate(() => {
    const g = (window as unknown as Win).__golf;
    return { yawT: g.yawT, phase: g.phase, mapOpen: g.mapOpen, view: g.mapView ? { x: g.mapView.x, y: g.mapView.y, w: g.mapView.w, h: g.mapView.h } : null };
  });

/** full carry of each club, yards (what the chips say) */
const CARRY: Record<string, number> = { Driver: 246, "3 Wood": 222, "5 Iron": 184, "7 Iron": 150, "Pitching wedge": 115, "Sand wedge": 81 };
const CLUB_CHIP = /^(Driver|3 Wood|5 Iron|7 Iron|Pitching wedge|Sand wedge)$/;

/** the three presses of Space: the power by how long the first and second are apart, the line by the third */
async function swing(p: Page, yards: number) {
  const club = await p.getByRole("button", { name: CLUB_CHIP }).and(p.locator('[aria-pressed="true"]')).getAttribute("aria-label");
  // carry goes with the square of the ball's speed, which is 30% + 70% of the backswing
  const sf = Math.sqrt(Math.min(1, yards / (CARRY[club ?? "Driver"] ?? 246)));
  const back = Math.max(0.05, Math.min(1, (sf - 0.3) / 0.7));
  await p.keyboard.press("Space");
  const t0 = Date.now();
  await p.waitForTimeout(Math.max(0, 1100 * back - 40));
  await p.keyboard.press("Space");
  const t1 = Date.now();
  await p.waitForTimeout(Math.max(0, 460 + 100 * back - (Date.now() - t1) - 40));
  await p.keyboard.press("Space");
  void t0;
}

/** a putt: hold Space for the power that rolls it a little past the cup */
async function putt(p: Page, feet: number) {
  const v = Math.sqrt(2 * 0.065 * 9.81 * (feet / 3.281 + 0.3));
  const power = Math.pow(Math.max(0, v - 0.12) / 4.7, 1 / 1.6);
  await p.keyboard.down("Space");
  await p.waitForTimeout(Math.max(80, (power / 0.62) * 1000));
  await p.keyboard.up("Space");
}

test("play hole 1 with the keyboard, and the page stays clean on the tee card, in flight and on the hole card", async ({ page }) => {
  test.setTimeout(100_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openPlay(page);
  await expect(live(page)).toHaveText(/^Hole 1, 340 yards, par 4\. /, SLOW);
  expect(await phase(page)).toBe("tee-card");
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);

  const scanned = new Set<string>();
  let done = false;
  for (const start = Date.now(); Date.now() - start < 70_000 && !done; ) {
    const ph = await phase(page);
    const lines = await said(page);
    const last = lines[lines.length - 1] ?? "";
    /** the latest line that says it */
    const latest = (re: RegExp) => lines.map((l) => l.match(re)).filter(Boolean).pop();
    if (/^Hole 1: \d+ strokes?, /.test(last)) {
      done = true;
      break;
    }
    if (ph === "tee-card") await page.keyboard.press("Space");
    else if (ph === "ready") {
      const m = latest(/(\d+) yards to the pin/);
      await swing(page, m ? Number(m[1]) : 250);
    } else if (ph === "swing") await page.waitForTimeout(150);
    else if (ph === "fly") {
      if (!scanned.has("fly")) {
        scanned.add("fly");
        expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
      }
      await page.keyboard.press("Space"); // a press while the ball flies plays it faster
      await expect.poll(() => phase(page), { timeout: 12_000, intervals: [100] }).not.toBe("fly");
    } else if (ph === "rest") await page.keyboard.press("Space");
    else if (ph === "putt") {
      const f = latest(/(\d+) feet to the pin/);
      await putt(page, f ? Number(f[1]) : 12);
      // until it stops (it says how far is left) or goes in
      await expect.poll(async () => (await phase(page)) !== "putt" || ((await live(page).textContent()) ?? "") !== last, { timeout: 12_000, intervals: [100] }).toBe(true);
    } else await page.waitForTimeout(150);
  }
  // the live region reports the hole done; the card is up
  await expect(live(page)).toHaveText(/^Hole 1: \d+ strokes?, [a-z +0-9]+\.$/, SLOW);
  await expect.poll(() => phase(page), SLOW).toBe("hole-card");
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  // a press moves on to the next hole
  await page.waitForTimeout(600);
  await page.keyboard.press("Space");
  await expect(live(page)).toHaveText(/^Hole 2, 135 yards, par 3\. /, SLOW);
  expect(errors).toEqual([]);
});

test("reduced motion: the course still plays a tee shot", async ({ browser, baseURL }) => {
  test.setTimeout(45_000);
  const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openPlay(page);
  await page.keyboard.press("Space"); // the tee card
  await expect.poll(() => phase(page), SLOW).toBe("ready");
  await swing(page, 250);
  await expect.poll(() => phase(page), SLOW).toBe("fly");
  await page.keyboard.press("Space");
  await expect(live(page)).toContainText(/Driver: \d+ yards carry/, { timeout: 20_000 });
  expect(errors).toEqual([]);
  await context.close();
});

test("phone size: no sideways scroll, and the chips fit", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await openPlay(page);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
  await expect(page.getByRole("button", { name: "Aim left" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sand wedge" })).toBeVisible();
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  await context.close();
});

test("a phone on its side: the clubs and the page's buttons keep to one row, and a drag swings", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 844, height: 390 }, hasTouch: true });
  const page = await context.newPage();
  await openPlay(page);
  const canvas = page.locator("canvas[data-autofocus]");
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
  const driver = (await page.getByRole("button", { name: "Driver" }).boundingBox())!;
  const leave = (await page.getByRole("link", { name: "Leave the course" }).boundingBox())!;
  expect(Math.abs(driver.y - leave.y)).toBeLessThan(6);
  // the course keeps most of the height
  const box = (await canvas.boundingBox())!;
  expect(box.height).toBeGreaterThan(280);
  // a drag down and back up off the tee is a swing
  await page.evaluate(() => { const g = (window as unknown as Win).__golf; if (g.phase === "tee-card") (g as unknown as { key(e: { key: string }, d: boolean): void }).key({ key: " " }, true); });
  await expect.poll(() => phase(page), SLOW).toBe("ready");
  const x = box.x + box.width / 2, y0 = box.y + box.height * 0.35;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y0 + i * 13);
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y0 + 130 - i * 24);
  await page.mouse.up();
  await expect.poll(() => phase(page), SLOW).not.toBe("ready");
  expect(await page.evaluate(() => (window as unknown as Win).__golf.strokes)).toBe(1);
  await context.close();
});

test("the map: open on a wide screen, M and the chip toggle it, a tap on it sets the aim", async ({ page }) => {
  await openPlay(page);
  const chip = page.getByRole("button", { name: "Map", exact: true });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await state(page)).view !== null, SLOW).toBe(true);
  // M toggles it, and says so
  await page.keyboard.press("m");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(live(page)).toHaveText("Map closed.");
  await page.keyboard.press("m");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(live(page)).toHaveText("Map open.");
  await page.keyboard.press("Space"); // the tee card
  await expect.poll(() => phase(page), SLOW).toBe("ready");
  await expect.poll(async () => (await state(page)).view !== null, SLOW).toBe(true);
  const before = await state(page);
  const box = (await page.locator("canvas[data-autofocus]").boundingBox())!;
  // a tap on the right-hand part of the map, up the hole: the aim turns right
  const v = before.view!;
  await page.mouse.click(box.x + v.x + v.w * 0.8, box.y + v.y + v.h * 0.3);
  await expect.poll(async () => (await state(page)).yawT, SLOW).toBeGreaterThan(before.yawT + 0.03);
  // and it did not swing
  expect(await phase(page)).toBe("ready");
  expect((await axe(page)).violations.map((x) => x.id)).toEqual([]);
});

test("phone size: the Map chip opens the map across the screen, and a tap on it aims", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await openPlay(page);
  const chip = page.getByRole("button", { name: "Map", exact: true });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Space");
  await expect.poll(() => phase(page), SLOW).toBe("ready");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await state(page)).view !== null, SLOW).toBe(true);
  const before = await state(page);
  const v = before.view!;
  expect(v.w).toBeGreaterThan(350);
  const box = (await page.locator("canvas[data-autofocus]").boundingBox())!;
  await page.touchscreen.tap(box.x + v.x + v.w * 0.75, box.y + v.y + v.h * 0.25);
  await expect.poll(async () => Math.abs((await state(page)).yawT - before.yawT), SLOW).toBeGreaterThan(0.02);
  expect(await phase(page)).toBe("ready");
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
  expect((await axe(page)).violations.map((x) => x.id)).toEqual([]);
  await context.close();
});

test("the round card: total, over or under par, the holes, play again; axe is clean", async ({ page }) => {
  await openPlay(page);
  // the mock-link build exposes the game: play the nine holes out in one go (the holes themselves are covered above and in the unit tests)
  const par = await page.evaluate(() => {
    const g = (window as unknown as { __golf: Record<string, (...a: unknown[]) => void> & { defs: { par: number }[] } }).__golf;
    g.defs.forEach((d, i) => {
      g.startHole(i);
      g.holeDone(d.par + (i === 0 ? 1 : 0), false);
      if (i < g.defs.length - 1) g.nextHole();
    });
    g.nextHole();
    return g.defs.reduce((a, d) => a + d.par, 0);
  });
  await expect.poll(() => phase(page), SLOW).toBe("round-card");
  await expect(live(page)).toHaveText(`Round: ${par + 1} strokes, 1 over par.`);
  const card = page.getByRole("dialog", { name: "Round over" });
  await expect(card.getByRole("button", { name: "Play again" })).toBeFocused();
  expect((await axe(page)).violations.map((x) => x.id)).toEqual([]);
  // play again, from the first tee
  await page.keyboard.press("Enter");
  await expect(live(page)).toHaveText(/^Hole 1, 340 yards, par 4\. /, SLOW);
  expect(await phase(page)).toBe("tee-card");
});
