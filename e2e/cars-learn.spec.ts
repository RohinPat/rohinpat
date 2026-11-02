import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Cars, Learn mode, end to end: 24 cars learn the canyon in a worker while the page plays them back. A seed in the
// address (?learnseed=1) makes the learning the same each time; that seed's best car finishes in about 30 generations.
// The mock link (NEXT_PUBLIC_LINK_MOCK=1) gives the page `window.__night`, the running Night run.

const LAPTOP = { width: 1440, height: 900 };
const SLOW = { timeout: 15_000 };

const stage = (p: Page) => p.getByRole("dialog");
const learn = (p: Page) => p.getByTestId("learn-canvas");
const gen = async (p: Page) => Number((await learn(p).getAttribute("data-gen")) ?? 0);

async function openLearn(p: Page) {
  await p.goto("/interests?learnseed=1");
  await p.locator('[data-piece="engine"]').click();
  await expect(stage(p)).toBeVisible(SLOW);
  await p.getByTestId("engine-mode-learn").click();
  await expect(learn(p)).toBeVisible(SLOW);
}

/** a number that changes whenever the canvas picture does (a sparse sample of its pixels) */
const picture = (p: Page) =>
  p.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="learn-canvas"]')!;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4 * 97) sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1_000_003;
    return sum;
  });

test.describe("Cars: Learn", () => {
  test("watch, skip ahead, and race the best car", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(LAPTOP);
    await openLearn(page);
    // a generation is on screen and the worker is the one driving them
    await expect.poll(() => gen(page), SLOW).toBeGreaterThanOrEqual(1);
    await expect(learn(page)).toHaveAttribute("data-link", "worker");
    await expect(learn(page)).toHaveAttribute("data-mode", "watch");
    expect(await picture(page)).toBeGreaterThan(0);
    await expect(page.getByTestId("learn-race")).toHaveCount(0);

    // skipping ahead moves the generation count on
    const before = await gen(page);
    await page.getByTestId("learn-skip").click();
    await expect(page.getByTestId("learn-skip")).toHaveAttribute("aria-pressed", "true");
    await expect(learn(page)).toHaveAttribute("data-mode", "skip");
    await expect.poll(() => gen(page), { timeout: 30_000 }).toBeGreaterThan(before + 5);

    // once a car has finished, it can be raced: Night run starts with it as the ghost
    await expect(page.getByTestId("learn-race")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("learn-race").click();
    await expect(page.getByTestId("night-canvas")).toBeVisible(SLOW);
    await expect(page.getByTestId("engine-mode-night")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("night-canvas")).toHaveAttribute("data-phase", /count|run/, SLOW);
    const ghost = await page.evaluate(() => {
      const g = (window as unknown as { __night: { scene: { ghosts: { kind: number; show: boolean }[] } } }).__night.scene.ghosts[1];
      return { kind: g.kind, show: g.show };
    });
    expect(ghost).toEqual({ kind: 3, show: true });

    // going back to Night run by hand (or leaving) lets the learner go
    await page.getByTestId("engine-mode-drag").click();
    await page.getByTestId("engine-mode-night").click();
    await expect(page.getByTestId("night-canvas")).toBeVisible(SLOW);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __night: { scene: { ghosts: { kind: number }[] } } }).__night.scene.ghosts[1].kind), SLOW)
      .toBe(1);
  });

  test("with reduced motion it still plays, and the page scans clean", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, viewport: LAPTOP, reducedMotion: "reduce" });
    const page = await context.newPage();
    await openLearn(page);
    await expect.poll(() => gen(page), SLOW).toBeGreaterThanOrEqual(1);
    const a = await picture(page);
    await page.waitForTimeout(600);
    expect(await picture(page)).not.toBe(a);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) - ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
    // the keys: S skips ahead, R starts over
    await learn(page).focus();
    await page.keyboard.press("s");
    await expect(learn(page)).toHaveAttribute("data-mode", "skip");
    await page.keyboard.press("s");
    await expect(learn(page)).toHaveAttribute("data-mode", "watch");
    await context.close();
  });
});
