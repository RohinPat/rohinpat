import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Golf: faster range shots, the challenge's club and aim lock, and fairer putts. The numbers are checked
// headless in tests/unit/golf-*.test.ts; this is the real page.

const SLOW = { timeout: 15_000 };
const live = (p: Page) => p.locator('[role="dialog"] p[aria-live="polite"]');

async function openGolf(p: Page) {
  await p.goto("/interests?linkmock");
  await p.locator('[data-piece="golf"]').click();
  await expect(p.getByRole("dialog")).toBeVisible(SLOW);
  await expect(p.locator("canvas[data-autofocus]")).toBeVisible();
  await p.waitForTimeout(600);
}
const axe = (p: Page) => new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

test("putt: Alt+arrow is taken for the fine aim step, axe is clean", async ({ page }) => {
  await openGolf(page);
  // the range opens first; Play is a link to the course
  await expect(page.getByRole("button", { name: "Driving range" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Putt", exact: true }).click();
  await expect(page.getByRole("button", { name: "Putt", exact: true })).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator("canvas[data-autofocus]");
  await canvas.focus();
  // Alt+arrow is a fine aim step, so the browser's Alt+Left (back) must not run: the key is taken
  const handled = await page.evaluate(() => {
    const out: boolean[] = [];
    const h = (e: KeyboardEvent) => out.push(e.defaultPrevented);
    document.addEventListener("keydown", h);
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true }));
    document.removeEventListener("keydown", h);
    return out;
  });
  expect(handled).toEqual([true]);
  const results = await axe(page);
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("challenge: the suggested club is picked, and a tap says the aim is set", async ({ page }) => {
  await openGolf(page);
  await page.getByRole("button", { name: "Driving range" }).click();
  await page.getByRole("button", { name: "Challenge" }).click();
  await page.waitForTimeout(500);
  // exactly one club chip is on (the suggested one, picked for the target)
  await expect(page.getByRole("button", { name: /^(Driver|3 Wood|5 Iron|7 Iron|Pitching wedge|Sand wedge)$/ }).and(page.locator('[aria-pressed="true"]'))).toHaveCount(1);
  const canvas = page.locator("canvas[data-autofocus]");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.7);
  await expect(live(page)).toHaveText("Aim is set for the target.", SLOW);
  const results = await axe(page);
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("range: a press while the ball flies speeds it up and never swings", async ({ page }) => {
  test.setTimeout(60_000);
  await openGolf(page);
  await page.getByRole("button", { name: "Driving range" }).click();
  await page.getByRole("button", { name: "Driver" }).click();
  await page.locator("canvas[data-autofocus]").focus();
  // the keyboard swing: Space, Space for power, Space on the line
  await page.keyboard.press("Space");
  await page.waitForTimeout(1090);
  await page.keyboard.press("Space");
  await page.waitForTimeout(520);
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const t0 = Date.now();
  await page.keyboard.press("Space"); // in flight: speeds it up
  // the card with the result arrives long before an unhurried driver shot (about 10 s) would be down
  await expect(live(page)).toContainText(/Driver: \d+ yards carry/, { timeout: 8_000 });
  expect(Date.now() - t0).toBeLessThan(5_000);
  // and that press did not start a swing: the next Space is the one that does
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  const results = await axe(page);
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("reduced motion: putt and range still play", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openGolf(page);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Driving range" }).click();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  await context.close();
});

test("the window is practice: it opens on the range, and Play goes to the course", async ({ page }) => {
  await openGolf(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Range and green" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Driving range" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Putt", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("link", { name: "Play", exact: true }).click();
  await page.waitForURL("**/golf", SLOW);
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  await expect(page.getByRole("button", { name: /Nine holes/ })).toBeVisible();
});
