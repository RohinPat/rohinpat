import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The course in 3D on its own page (/golf). The game is the dialog's (golf-course.spec.ts plays it with the keyboard);
// this checks the page: it covers the site, it is not indexed, a shot can be played and comes down, and the controls
// pass axe. Without WebGL the page falls back to the flat course, so these hold either way.

const SLOW = { timeout: 20_000 };
// a software renderer in CI draws a frame in tens of milliseconds
test.describe.configure({ timeout: 60_000 });
type Win = { __golf: { phase: string; strokes: number; ball: [number, number]; step: (dt: number) => void; key: (e: { key: string }, down: boolean) => boolean; suggested: () => { club: number; power: number }; setClub: (i: number) => void; remoteSwing: (s: object) => boolean } };

async function openCourse(p: Page) {
  await p.goto("/golf?linkmock");
  await expect(p.locator("[data-golf-phase]")).toBeVisible(SLOW);
  await p.waitForFunction(() => !!(window as unknown as Win).__golf, null, SLOW);
}

test("the 3D course covers the page and is not indexed", async ({ page }) => {
  await openCourse(page);
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

test("the 3D course's controls pass axe", async ({ page }) => {
  await openCourse(page);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
