import { test, expect, type Page } from "@playwright/test";

// A phone on its side: the stage is about 340px tall. Night run (Cars) and
// Decks (Music) each lay themselves out for it, and these check that nothing
// on the page sits on anything else or runs off the screen: every control,
// the stage's title, and (Night run) the card drawn on the canvas, whose box
// the canvas publishes as data-card. The mock link gives the page
// `window.__night`, the running game.

const SLOW = { timeout: 15_000 };
const SIZES = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];

type Rect = { x: number; y: number; w: number; h: number };
type Box = Rect & { name: string; frame?: Rect };

/** every visible control in the stage, and its title; a control in the piece (not the heading) must stay inside the piece's frame */
const layout = (p: Page) =>
  p.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    const piece = dialog.lastElementChild!.getBoundingClientRect();
    const els = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, #stage-title"));
    return els
      .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden")
      .map((el) => {
        const r = el.getBoundingClientRect();
        const name = el.getAttribute("aria-label") || el.dataset.testid || el.textContent?.trim() || el.tagName;
        const frame = el.closest("header") ? undefined : { x: piece.x, y: piece.y, w: piece.width, h: piece.height };
        return { name, x: r.x, y: r.y, w: r.width, h: r.height, frame };
      })
      .filter((b) => b.w > 0 && b.h > 0);
  });

/** the card drawn on the night run canvas, in page coordinates (null when none is up) */
const card = (p: Page) =>
  p.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="night-canvas"]')!;
    const v = c.dataset.card;
    if (!v) return null;
    const [x, y, w, h] = v.split(",").map(Number);
    const r = c.getBoundingClientRect();
    return { name: "canvas card", x: r.x + x, y: r.y + y, w, h, frame: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });

const hit = (a: Box, b: Box) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

function expectClear(boxes: Box[], vw: number, vh: number, what: string) {
  for (const b of boxes) {
    const f = b.frame ?? { x: 0, y: 0, w: vw, h: vh };
    const inside = b.x >= f.x - 0.5 && b.y >= f.y - 0.5 && b.x + b.w <= f.x + f.w + 0.5 && b.y + b.h <= f.y + f.h + 0.5;
    expect(inside, `${what}: "${b.name}" runs out of ${b.frame ? "the piece" : "the screen"} (${JSON.stringify(b)})`).toBe(true);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(hit(boxes[i], boxes[j]), `${what}: "${boxes[i].name}" overlaps "${boxes[j].name}"`).toBe(false);
}

for (const size of SIZES) {
  test.describe(`a phone on its side, ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });

    test("Night run: ready, driving and the end card, nothing overlaps and nothing is off screen", async ({ page }) => {
      await page.goto("/interests?linkmock");
      await page.locator('[data-piece="engine"]').click();
      const canvas = page.getByTestId("night-canvas");
      await expect(canvas).toHaveAttribute("data-phase", "ready", SLOW);
      await expect(page.getByTestId("night-track-climb")).toBeVisible();
      await page.waitForTimeout(300); // a few frames: the card is drawn and the road switch placed

      const title = await card(page);
      expectClear([...(await layout(page)), ...(title ? [title] : [])], size.width, size.height, "ready");
      expect(title, "the title card publishes its box").not.toBeNull();
      // the mode switch is in the heading, beside Sound
      await expect(page.locator("header").getByTestId("engine-mode-night")).toBeVisible();

      await canvas.focus();
      await page.keyboard.press("Enter");
      await expect(canvas).toHaveAttribute("data-phase", /count|run/, SLOW);
      await expect(page.getByTestId("night-restart")).toBeVisible();
      expectClear(await layout(page), size.width, size.height, "driving");

      await page.evaluate(() => ((window as unknown as { __night: { timeLeft: number } }).__night.timeLeft = 0.05));
      await expect(canvas).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
      await expect(page.getByTestId("night-again")).toBeVisible();
      await page.waitForTimeout(300);
      const end = await card(page);
      expectClear([...(await layout(page)), ...(end ? [end] : [])], size.width, size.height, "end card");
      expect(end, "the end card publishes its box").not.toBeNull();
    });

    test("Decks: all sixteen steps fit, with and without the scope, and nothing overlaps", async ({ page }) => {
      await page.goto("/interests?linkmock");
      await page.locator('[data-piece="decks"]').click();
      const grid = page.getByRole("group", { name: "Step sequencer" });
      await expect(grid).toBeVisible(SLOW);
      await expect(grid.getByRole("button")).toHaveCount(64);

      for (const scope of [false, true]) {
        if (scope) {
          await page.getByTestId("scope-toggle").click();
          await expect(page.getByTestId("scope")).toBeVisible();
        }
        const what = scope ? "with the scope" : "grid";
        // no sideways scroll in the grid, and no scroll in the panel it is in
        const fit = await grid.evaluate((g) => ({ x: g.scrollWidth - g.clientWidth, y: g.parentElement!.scrollHeight - g.parentElement!.clientHeight }));
        expect(fit.x, `${what}: the grid scrolls sideways`).toBeLessThanOrEqual(1);
        expect(fit.y, `${what}: the panel scrolls`).toBeLessThanOrEqual(1);
        expectClear(await layout(page), size.width, size.height, what);
      }
    });
  });
}
