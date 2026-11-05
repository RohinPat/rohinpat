import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Golf: the course (Play). One hole is played start to finish with the keyboard in the real page; the numbers behind
// it (the bots, the lies, the scoring) are in tests/unit/golf-*.test.ts. Kept short: a bounded loop, the ball sped
// up with a press while it flies.

const SLOW = { timeout: 15_000 };
const live = (p: Page) => p.locator('[role="dialog"] p[aria-live="polite"]');
const phase = (p: Page) => p.locator("[data-golf-phase]").getAttribute("data-golf-phase");
const axe = (p: Page) => new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

async function openPlay(p: Page) {
  await p.goto("/interests?linkmock");
  await p.locator('[data-piece="golf"]').click();
  await expect(p.getByRole("dialog")).toBeVisible(SLOW);
  await expect(p.locator("canvas[data-autofocus]")).toBeVisible();
  // Play opens first, then Putt and the driving range (practice)
  await expect(p.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(p.getByRole("dialog").getByRole("button", { name: /^(Play|Putt|Driving range)$/ })).toHaveText(["Play", "Putt", "Driving range"]);
  await expect(p.locator("[data-golf-phase]")).toBeVisible(SLOW);
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
    const said = (await live(page).textContent()) ?? "";
    if (/^Hole 1: \d+ strokes?, /.test(said)) {
      done = true;
      break;
    }
    if (ph === "tee-card") await page.keyboard.press("Space");
    else if (ph === "ready") {
      const m = said.match(/(\d+) yards to the pin/);
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
      const f = said.match(/(\d+) feet to the pin/);
      await putt(page, f ? Number(f[1]) : 12);
      // until it stops (it says how far is left) or goes in
      await expect.poll(async () => (await phase(page)) !== "putt" || ((await live(page).textContent()) ?? "") !== said, { timeout: 12_000, intervals: [100] }).toBe(true);
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
  // the mock-link build exposes the game: play the six holes out in one go (the holes themselves are covered above and in the unit tests)
  await page.evaluate(() => {
    const g = (window as unknown as { __golf: Record<string, (...a: unknown[]) => void> }).__golf;
    const strokes = [4, 3, 5, 6, 3, 5];
    strokes.forEach((s, i) => {
      g.startHole(i);
      g.holeDone(s, false);
      if (i < 5) g.nextHole();
    });
    g.nextHole();
  });
  await expect.poll(() => phase(page), SLOW).toBe("round-card");
  await expect(live(page)).toHaveText("Round: 26 strokes, 3 over par.");
  expect((await axe(page)).violations.map((x) => x.id)).toEqual([]);
  // a press after the guard time plays again, from the first tee
  await page.waitForTimeout(1300);
  await page.keyboard.press("Space");
  await expect(live(page)).toHaveText(/^Hole 1, 340 yards, par 4\. /, SLOW);
  expect(await phase(page)).toBe("tee-card");
});
