import { test, expect, type Page } from "@playwright/test";

// Night run's second road, the climb, end to end: a two-way choice on the ready screen and the end card (keys, Tab, taps), its own
// run, its own words, and a picture that draws from the first gate to the summit without an error. The mock link
// (NEXT_PUBLIC_LINK_MOCK=1) gives the page `window.__night`, the running game.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

type Hook = {
  phase: string;
  track: { id: string };
  road: { checks: number[]; finish: number; track: string; kappa: Float32Array };
  car: { s: number; u: number; lat: number; w: number; r: number; psi: number };
  timeLeft: number;
  score: number;
  result: { finished: boolean; score: number; newBest: boolean } | null;
  scene: { ghosts: { show: boolean }[] };
};
const stage = (p: Page) => p.getByRole("dialog");
const canvas = (p: Page) => p.getByTestId("night-canvas");
const live = (p: Page) => p.locator('[role="dialog"] p[aria-live="polite"]');
const pick = (p: Page, id: "canyon" | "climb") => p.getByTestId(`night-track-${id}`);
const nightEval = <T,>(p: Page, fn: (g: Hook, ...a: number[]) => T, ...a: number[]) => p.evaluate(`(${fn.toString()})((window).__night, ...${JSON.stringify(a)})`) as Promise<T>;

async function openCars(p: Page) {
  await p.goto("/interests");
  await p.locator('[data-piece="engine"]').click();
  await expect(stage(p)).toBeVisible(SLOW);
  await expect(canvas(p)).toHaveAttribute("data-phase", "ready", SLOW);
  await expect(canvas(p)).toBeFocused(SLOW);
}

test.describe("Night run: the climb", () => {
  test("the ready screen offers the two roads, the canyon first, and a tap changes the road", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await expect(page.getByRole("group", { name: "Road" })).toBeVisible();
    await expect(pick(page, "canyon")).toHaveText("Canyon");
    await expect(pick(page, "climb")).toHaveText("Climb");
    await expect(pick(page, "canyon")).toHaveAttribute("aria-pressed", "true");
    await expect(pick(page, "climb")).toHaveAttribute("aria-pressed", "false");
    await expect(canvas(page)).toHaveAttribute("data-track", "canyon", SLOW);
    await pick(page, "climb").click();
    await expect(pick(page, "climb")).toHaveAttribute("aria-pressed", "true");
    await expect(pick(page, "canyon")).toHaveAttribute("aria-pressed", "false");
    await expect(canvas(page)).toHaveAttribute("data-track", "climb", SLOW);
    await expect(live(page)).toHaveText(/climb/i);
    expect(await nightEval(page, (g) => g.road.track)).toBe("climb");
    await expect(canvas(page)).toHaveAttribute("aria-label", /switchback road up a mountain/i);
    // the keys still work after the click
    await expect(canvas(page)).toBeFocused();
    // and back
    await pick(page, "canyon").click();
    await expect(canvas(page)).toHaveAttribute("data-track", "canyon", SLOW);
    await expect(canvas(page)).toHaveAttribute("aria-label", /canyon road after midnight/i);
    await context.close();
  });

  test("left and right choose the road before a run, Enter starts it, and on the road the arrows steer", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await page.keyboard.press("ArrowRight");
    await expect(canvas(page)).toHaveAttribute("data-track", "climb", SLOW);
    await expect(pick(page, "climb")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowRight");
    await expect(canvas(page)).toHaveAttribute("data-track", "canyon", SLOW);
    await page.keyboard.press("ArrowLeft");
    await expect(canvas(page)).toHaveAttribute("data-track", "climb", SLOW);
    // Enter starts the run on the chosen road
    await page.keyboard.press("Enter");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 20_000 });
    await expect(canvas(page)).toHaveAttribute("data-track", "climb");
    // on the road the arrows are the wheel, not the choice
    await page.keyboard.down("ArrowUp");
    await expect.poll(async () => Number(await canvas(page).getAttribute("data-speed")), { timeout: 15_000 }).toBeGreaterThan(20);
    await page.keyboard.down("ArrowRight");
    await expect.poll(() => nightEval(page, (g) => g.car.psi), { timeout: 5000 }).toBeGreaterThan(0.01);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-track", "climb");
    // and the road cannot be changed mid-run
    expect(await nightEval(page, (g) => g.road.track)).toBe("climb");
    await context.close();
  });

  test("works from Tab: the picker is in the tab order, the arrows move the choice and the focus, Enter on the chosen road starts", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openCars(page);
    await pick(page, "canyon").focus();
    await expect(pick(page, "canyon")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(pick(page, "climb")).toBeFocused();
    await expect(pick(page, "climb")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas(page)).toHaveAttribute("data-track", "climb", SLOW);
    // Tab from the canvas gets to it: assist, gearbox, then the roads
    await canvas(page).focus();
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      seen.push((await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "")) as string);
    }
    expect(seen).toContain("night-track-canyon");
    expect(seen).toContain("night-track-climb");
    // Enter on the road that is chosen starts the run
    await pick(page, "climb").focus();
    await page.keyboard.press("Enter");
    await expect(canvas(page)).toHaveAttribute("data-phase", "count", SLOW);
    await expect(canvas(page)).toHaveAttribute("data-track", "climb");
    await context.close();
  });

  test("a run on the climb is its own: the gates, the words, the summit, the best of the visit for it alone, and the picker on the end card", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await openCars(page);
    await pick(page, "climb").click();
    await page.keyboard.down("ArrowUp");
    await expect(canvas(page)).toHaveAttribute("data-phase", "run", { timeout: 25_000 });
    await expect.poll(async () => Number(await canvas(page).getAttribute("data-speed")), { timeout: 15_000 }).toBeGreaterThan(20);
    const road = await nightEval(page, (g) => ({ checks: g.road.checks, finish: g.road.finish }));
    expect(road.checks).toHaveLength(7);
    // drive it by the clock's own gates: a few metres short of each, in turn, and the screen draws every stretch
    for (let i = 0; i < road.checks.length - 1; i++) {
      const gate = road.checks[i];
      await nightEval(page, (g, s) => ((g.car.s = s - 20), (g.car.u = 26), (g.car.lat = 0), (g.car.w = 0), (g.car.r = 0), (g.car.psi = 0), (g.timeLeft = 90), 0), gate);
      await expect.poll(() => nightEval(page, (g) => (g as unknown as { cp: number }).cp), { timeout: 5000 }).toBeGreaterThan(i);
    }
    await expect(live(page)).toContainText(/checkpoint 6 of 7/i, SLOW);
    // the summit
    await nightEval(page, (g, s) => ((g.car.s = s - 25), (g.car.u = 26), (g.car.lat = 0), (g.car.w = 0), (g.car.r = 0), (g.car.psi = 0), (g.timeLeft = 90), 0), road.finish);
    await expect(canvas(page)).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
    await expect(live(page)).toContainText(/you reached the summit/i, SLOW);
    expect(await nightEval(page, (g) => g.result?.finished)).toBe(true);
    await page.keyboard.up("ArrowUp");
    // the end card has the picker too: the canyon from here, and it has no best run to race
    await expect(pick(page, "canyon")).toBeVisible();
    await pick(page, "canyon").click();
    await expect(canvas(page)).toHaveAttribute("data-phase", "ready", SLOW);
    await expect(canvas(page)).toHaveAttribute("data-track", "canyon");
    expect(await nightEval(page, (g) => g.scene.ghosts[1].show)).toBe(false);
    // and the climb has the one it set
    await pick(page, "climb").click();
    expect(await nightEval(page, (g) => g.scene.ghosts[1].show)).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("on a phone-sized screen the picker is clear of the other switches and inside the screen", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await openCars(page);
    const box = (await pick(page, "canyon").boundingBox())!;
    const box2 = (await pick(page, "climb").boundingBox())!;
    const gear = (await page.getByTestId("night-manual").boundingBox())!;
    const assist = (await page.getByTestId("night-assist").boundingBox())!;
    expect(box.y).toBeGreaterThan(gear.y + gear.height);
    expect(box.y).toBeGreaterThan(assist.y + assist.height);
    expect(box2.x + box2.width).toBeLessThan(PHONE.width);
    expect(box.x).toBeGreaterThan(0);
    // a tap on it changes the road and leaves the pads where they were
    await pick(page, "climb").tap();
    await expect(canvas(page)).toHaveAttribute("data-track", "climb", SLOW);
    await expect(page.getByTestId("night-pads")).toBeVisible();
    await context.close();
  });
});
