import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The Drag strip as a best of three, end to end: three runs make a set with its own conditions, the cards after runs 1 and 2
// say which run it was, the third run gives the set card, and a key, a tap or the button starts a new set with new conditions.
// The mock link (NEXT_PUBLIC_LINK_MOCK=1) gives the page `window.__drag`. To keep these quick a run is put a few metres short of
// the line once it is under way (the strip's physics are covered by the unit tests and the bots); the staging, the tree and the
// finish are the real ones.

const LAPTOP = { width: 1440, height: 900 };
const SLOW = { timeout: 15_000 };

type DragHook = {
  car: { phase: string; best: number | null; doneT: number; cond: { shift: number; treeMin: number; treeSpread: number }; x: number; v: number };
  ghost: Float32Array | null;
  set: { cond: { shift: number; treeMin: number; treeSpread: number }; runs: { t: number }[]; path: Float32Array | null };
  par: number;
};
const stage = (p: Page) => p.getByRole("dialog");
const live = (p: Page) => p.locator('[role="dialog"] p[aria-live="polite"]');
const phase = (p: Page) => p.evaluate(() => (window as unknown as { __drag: DragHook }).__drag.car.phase);
const snap = (p: Page) =>
  p.evaluate(() => {
    const d = (window as unknown as { __drag: DragHook }).__drag;
    return { cond: { ...d.set.cond }, runs: d.set.runs.length, ets: d.set.runs.map((r) => r.t), par: d.par, best: d.car.best, ghost: d.ghost ? d.ghost.length : 0, setPath: d.set.path ? d.set.path.length : 0, phase: d.car.phase };
  });

async function openStrip(p: Page) {
  await p.goto("/interests");
  await p.locator('[data-piece="engine"]').click();
  await expect(stage(p)).toBeVisible(SLOW);
  await p.getByTestId("engine-mode-drag").click();
  const dash = stage(p).getByRole("img", { name: /race dashboard/i });
  await expect(dash).toBeVisible();
  await dash.focus();
}

/** hold Space through the staging and the tree, then (under way) put the car `to` metres along; let go once it is done */
async function runIt(p: Page, to = 395) {
  await p.keyboard.down(" ");
  await expect.poll(() => phase(p), { timeout: 20_000 }).toBe("run");
  await p.evaluate((x) => {
    const c = (window as unknown as { __drag: DragHook }).__drag.car;
    c.x = x;
    c.v = 50;
  }, to);
  await expect.poll(() => phase(p), SLOW).toBe("done");
  await p.keyboard.up(" ");
}

test.describe("Drag strip: a set is three runs", () => {
  test("the cards say which run it was, the third gives the set card, and a new set has new conditions and a new par", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP, reducedMotion: "reduce" });
    const page = await context.newPage();
    await openStrip(page);
    const first = await snap(page);
    expect(first.runs).toBe(0);
    expect(first.best).toBeNull();
    expect(first.par).toBeGreaterThan(9.5);
    const button = stage(page).getByRole("button", { name: /^(run again|new set|throttle)/i });

    await runIt(page);
    await expect(live(page)).toContainText(/^Run 1 of 3\. Quarter mile in/, SLOW);
    await expect(live(page)).toContainText(/par is \d+\.\d\d\./i);
    await expect(button).toHaveText(/run again/i);
    expect((await snap(page)).runs).toBe(1);

    // the conditions are the set's: the same for the next run, the best carried on
    await page.waitForTimeout(800);
    await runIt(page, 300);
    await expect(live(page)).toContainText(/^Run 2 of 3\./, SLOW);
    const second = await snap(page);
    expect(second.runs).toBe(2);
    expect(second.cond).toEqual(first.cond);
    expect(second.par).toBe(first.par);
    // run 2 was slower (it was put only 300 m along when the first was put 395 m along): the first is still the set's best
    expect(second.ets[1]).toBeGreaterThan(second.ets[0]);
    expect(second.best).toBeCloseTo(second.ets[0], 5);

    await page.waitForTimeout(800);
    await runIt(page);
    await expect(live(page)).toContainText(/^Set done\. Times \d+\.\d\d, \d+\.\d\d, \d+\.\d\d seconds\. Best \d+\.\d\d, .*par \d+\.\d\d\./, SLOW);
    // a run that was not driven for the launch says why on the card (the throttle was held through the tree)
    await expect(live(page)).toContainText(/too many revs at green|get on the throttle|early shift|late shift|launch|shift/i);
    await expect(button).toHaveText(/new set/i);
    const third = await snap(page);
    expect(third.runs).toBe(3);
    expect(third.cond).toEqual(first.cond);

    // the card scans clean
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);

    // Enter straight after the line does not skip the card; a moment later it starts the next set
    await page.keyboard.press("Enter");
    expect((await snap(page)).phase).toBe("done");
    await expect(live(page)).toContainText(/^Set done\./);
    await page.waitForTimeout(1100);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await snap(page)).phase, SLOW).toBe("idle");
    const next = await snap(page);
    expect(next.runs).toBe(0);
    expect(next.best).toBeNull();
    expect(Math.abs(next.cond.shift - first.cond.shift)).toBeGreaterThanOrEqual(150);
    expect(next.par).not.toBe(first.par);
    await expect(live(page)).toHaveText("");
    await expect(button).toHaveText(/throttle/i);
    await context.close();
  });

  test("the ghost races the best run of the set, and on a new set the best of the visit; the button starts the new set", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP });
    const page = await context.newPage();
    await openStrip(page);
    expect((await snap(page)).ghost).toBe(0);

    await runIt(page, 395);
    const a = await snap(page);
    expect(a.setPath).toBeGreaterThan(0);
    expect(a.ghost).toBe(a.setPath);
    await page.waitForTimeout(800);
    await runIt(page, 200); // slower: the set's ghost stays
    const b = await snap(page);
    expect(b.ghost).toBe(a.ghost);
    expect(b.setPath).toBe(a.setPath);
    await page.waitForTimeout(800);
    await runIt(page, 300);
    expect((await snap(page)).runs).toBe(3);

    // the button (a tap) on the set card starts the next set, which races the best run of the visit until it has a run of its own
    await page.waitForTimeout(1100);
    await stage(page).getByRole("button", { name: /new set/i }).click();
    await expect.poll(async () => (await snap(page)).phase, SLOW).toBe("idle");
    const c = await snap(page);
    expect(c.runs).toBe(0);
    expect(c.setPath).toBe(0);
    expect(c.ghost).toBe(a.ghost);
    expect(c.best).toBeNull();
    await context.close();
  });
});
