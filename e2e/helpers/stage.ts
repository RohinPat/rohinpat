import { expect, type Page } from "@playwright/test";

/** The full-screen stage a piece opens into. */
export const stageOf = (page: Page) => page.getByRole("dialog");

/**
 * Wait until a piece's stage has grown and holds focus: the state keys need before they reach the game.
 * Waits on data-stage and focus, never on time. A 3D piece can take a while to mount in CI's software renderer,
 * hence the timeout (the same ceiling the specs use for a stage).
 */
export async function stageReady(page: Page, timeout = 15_000) {
  const stage = stageOf(page);
  await expect(stage).toHaveAttribute("data-stage", "open", { timeout });
  await expect.poll(() => stage.evaluate((el) => el.contains(document.activeElement)), { timeout }).toBe(true);
  return stage;
}

/**
 * Open a piece from its tile, then wait for its stage. `via: "enter"` focuses the tile and presses Enter,
 * the way a keyboard visitor does.
 */
export async function openPiece(page: Page, piece: string, { via = "click", timeout = 15_000 }: { via?: "click" | "enter"; timeout?: number } = {}) {
  const tile = page.locator(`[data-piece="${piece}"]`);
  if (via === "enter") {
    await tile.focus();
    await page.keyboard.press("Enter");
  } else {
    await tile.click();
  }
  return stageReady(page, timeout);
}
