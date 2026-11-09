import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The course in 3D on its own page (/golf). The game is the dialog's (golf-course.spec.ts plays it with the keyboard);
// this checks the page: it covers the site, it is not indexed, a round starts from the title in each mode and its link
// replays it, a shot can be played and comes down, the round ends on a scorecard, and the controls pass axe. Without
// WebGL the page falls back to the flat course, so these hold either way.

const SLOW = { timeout: 20_000 };
// a software renderer in CI draws a frame in tens of milliseconds
test.describe.configure({ timeout: 60_000 });
type Game = {
  phase: string;
  strokes: number;
  ball: [number, number];
  defs: { n: number; par: number }[];
  hole: { def: { par: number } };
  step: (dt: number) => void;
  key: (e: { key: string }, down: boolean) => boolean;
  suggested: () => { club: number; power: number };
  setClub: (i: number) => void;
  remoteSwing: (s: object) => boolean;
  nextHole: () => void;
};
type Win = { __golf: Game };

/** the title, then a round of six holes */
async function openCourse(p: Page, mode = /Six holes/) {
  await p.goto("/golf?linkmock");
  await expect(p.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  await p.getByRole("button", { name: mode }).click();
  await expect(p.locator("[data-golf-phase]")).toBeVisible(SLOW);
  await p.waitForFunction(() => !!(window as unknown as Win).__golf, null, SLOW);
}

test("the 3D course covers the page and is not indexed", async ({ page }) => {
  await page.goto("/golf");
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  await expect(page.getByRole("heading", { name: "Golf" })).toBeVisible();
  await page.getByRole("button", { name: /Six holes/ }).click();
  await expect(page).toHaveURL(/\/golf\?seed=\d+/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // the site's navigation is underneath: what is at the top of the screen is the game's toolbar
  const top = await page.evaluate(() => document.elementFromPoint(window.innerWidth / 2, 4)?.closest("nav") === null);
  expect(top).toBe(true);
  await expect(page.getByRole("link", { name: "Leave the course" })).toHaveAttribute("href", "/interests");
  await expect(page.getByRole("button", { name: "Driver" })).toHaveAttribute("aria-pressed", "true");
});

test("a tee shot on the 3D course flies and comes to rest", async ({ page }) => {
  await openCourse(page);
  await page.locator("canvas[data-autofocus]").focus();
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__golf.phase), SLOW).toBe("ready");
  await page.evaluate(() => {
    const g = (window as unknown as Win).__golf;
    const sg = g.suggested();
    g.setClub(sg.club);
    g.remoteSwing({ power: sg.power, face: 0, curve: 0, contact: 1 });
  });
  await expect(page.locator("[data-golf-phase]")).toHaveAttribute("data-golf-phase", /swing|fly/, SLOW);
  // the flight is stepped on: a software renderer in CI draws few frames a second
  await page.evaluate(() => {
    const g = (window as unknown as Win).__golf;
    for (let i = 0; i < 4000 && g.phase !== "ready" && g.phase !== "putt"; i++) g.step(1 / 60);
  });
  const s = await page.evaluate(() => {
    const g = (window as unknown as Win).__golf;
    return { phase: g.phase, strokes: g.strokes, z: g.ball[1] };
  });
  expect(s.strokes).toBe(1);
  expect(s.z).toBeGreaterThan(150);
});

test("quick 3 ends on a scorecard with a link that replays it", async ({ page }) => {
  await openCourse(page, /Quick 3/);
  await expect(page).toHaveURL(/\/golf\?quick=\d+/);
  const url = page.url();
  // the holes are played out at par by hand: the round is what is checked here, not the swing
  const holes = await page.evaluate(() => {
    const g = (window as unknown as Win).__golf as unknown as Game & { holeDone: (s: number, up: boolean) => void };
    for (let i = 0; i < 20 && g.phase !== "round-card"; i++) {
      if (g.phase === "hole-card") g.nextHole();
      else g.holeDone(g.hole.def.par, false);
    }
    return g.defs.length;
  });
  expect(holes).toBe(3);
  const card = page.getByRole("dialog", { name: "Round over" });
  await expect(card).toBeVisible(SLOW);
  await expect(card.getByText("Even par", { exact: false })).toBeVisible();
  await expect(card.getByRole("button", { name: "Play again" })).toBeFocused();
  // the link plays the same three holes
  await page.goto(url);
  await expect(page.getByRole("button", { name: /Play this round/ })).toBeVisible(SLOW);
  await page.getByRole("button", { name: /Play this round/ }).click();
  await expect(page).toHaveURL(url);
});

test("Escape pauses the round, and the pause menu goes back to the modes", async ({ page }) => {
  await openCourse(page, /Daily/);
  await expect(page).toHaveURL(/\/golf\?daily=\d{4}-\d{2}-\d{2}/);
  await page.locator("canvas[data-autofocus]").focus();
  await page.keyboard.press("Escape");
  const menu = page.getByRole("dialog", { name: "Paused" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /Resume/ })).toBeFocused();
  await menu.getByRole("button", { name: "Change mode" }).click();
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible();
  await expect(page).toHaveURL(/\/golf$/);
});

test("the 3D course's controls pass axe", async ({ page }) => {
  await page.goto("/golf");
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  const axe = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const title = await axe();
  expect(title.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await page.getByRole("button", { name: /Six holes/ }).click();
  await expect(page.locator("[data-golf-phase]")).toBeVisible(SLOW);
  const r = await axe();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
