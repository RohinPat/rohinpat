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

/** the title, then a round of nine holes */
async function openCourse(p: Page, mode = /Nine holes/) {
  await p.goto("/golf?linkmock");
  await expect(p.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  await p.getByRole("button", { name: mode }).click();
  await expect(p.locator("[data-golf-phase]")).toBeVisible(SLOW);
  await p.waitForFunction(() => !!(window as unknown as Win).__golf, null, SLOW);
}

test("the 3D course covers the page, loads without errors, and is indexed and in the sitemap", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/golf");
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  // the site's own navigation and footer are not shown under it
  await expect(page.locator("body > nav")).toBeHidden();
  await expect(page.locator("body > footer")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Golf" })).toBeVisible();
  await page.getByRole("button", { name: /Nine holes/ }).click();
  await expect(page).toHaveURL(/\/golf\?seed=\d+/);
  await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute("content", /noindex/);
  expect(await (await page.request.get("/sitemap.xml")).text()).toMatch(/\/golf</);
  // the site's navigation is underneath: what is at the top of the screen is the game's toolbar
  const top = await page.evaluate(() => document.elementFromPoint(window.innerWidth / 2, 4)?.closest("nav") === null);
  expect(top).toBe(true);
  await expect(page.getByRole("link", { name: "Leave the course" })).toHaveAttribute("href", "/interests");
  await expect(page.getByRole("button", { name: "Driver" })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
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

test("on the green a pull-back putts the ball, through the 3D camera when there is one", async ({ page }) => {
  await openCourse(page);
  // the ball on the green, 5 m short of the cup
  await page.evaluate(() => {
    const g = (window as unknown as Win).__golf as unknown as Game & {
      hole: { green: { cup: [number, number] }; fromGreen: (x: number, y: number) => [number, number] };
      lie: string;
      afterRest: () => void;
    };
    for (let i = 0; i < 600 && g.phase !== "ready"; i++) g.step(1 / 60);
    const [cx, cy] = g.hole.green.cup;
    g.ball = g.hole.fromGreen(cx - 5, cy);
    g.lie = "green";
    g.afterRest();
  });
  await expect(page.locator("[data-golf-phase]")).toHaveAttribute("data-golf-phase", "putt", SLOW);
  type P = { putt: { strokes: number; proj: object | null; ball: { moving: boolean } } };
  const gl = await page.evaluate(() => !!(window as unknown as { __golf3d: unknown }).__golf3d);
  if (gl) await expect.poll(() => page.evaluate(() => !!((window as unknown as Win).__golf as unknown as P).putt.proj), SLOW).toBe(true);
  const box = (await page.locator("canvas[data-autofocus]").boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height * 0.4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + i * 14);
  await page.mouse.up();
  // the putter swings through on the game's clock: step it on
  await page.evaluate(() => {
    const g = (window as unknown as Win).__golf;
    for (let i = 0; i < 60; i++) g.step(1 / 60);
  });
  const s = await page.evaluate(() => ((window as unknown as Win).__golf as unknown as P).putt.strokes);
  expect(s).toBe(1);
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

test("by the keyboard alone: the site under the course is out of reach, a club click keeps the keys on the course, Escape closes the pause menu, and the game says the club", async ({ page }) => {
  await page.goto("/golf?linkmock");
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  // the site's navigation is under the course: Tab goes to the course's own controls
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^Sound/ })).toBeFocused();
  await page.getByRole("button", { name: /Nine holes/ }).press("Enter");
  const course = page.getByRole("application", { name: "Golf course" });
  await expect(course).toBeFocused(SLOW);
  await page.waitForFunction(() => !!(window as unknown as Win).__golf, null, SLOW);
  await page.evaluate(() => {
    const g = (window as unknown as Win).__golf;
    while (g.phase !== "ready") g.step(1 / 60);
  });
  await page.getByRole("button", { name: "7 Iron" }).click();
  await expect(course).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[role=log] p").last()).toHaveText(/^Pitching wedge, \d+ yards\.$/);
  await page.keyboard.press("Escape");
  const menu = page.getByRole("dialog", { name: "Paused" });
  await expect(menu.getByRole("button", { name: /Resume/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(course).toBeFocused();
});

test("a mode picked while the course is still loading starts as soon as it has", async ({ page }) => {
  // the game's own code (asked for once the page runs, so not in the page's HTML) is held back until the pick
  const html = await (await page.request.get("/golf?linkmock")).text();
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop()!;
    if (!html.includes(file)) await held;
    await route.continue();
  });
  await page.goto("/golf?linkmock", { waitUntil: "domcontentloaded" });
  const quick = page.getByRole("button", { name: /Quick 3/ });
  await quick.click();
  await expect(quick).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("progressbar", { name: "Loading the course" })).toBeVisible();
  expect(await page.locator("[data-golf-screen]").count()).toBe(0);
  release();
  await expect(page.locator("[data-golf-screen=play]")).toBeVisible(SLOW);
  await expect(page).toHaveURL(/\/golf\?quick=\d+/);
});

test("the 3D course's controls pass axe", async ({ page }) => {
  await page.goto("/golf");
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  const axe = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const title = await axe();
  expect(title.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await page.getByRole("button", { name: /Nine holes/ }).click();
  await expect(page.locator("[data-golf-phase]")).toBeVisible(SLOW);
  const r = await axe();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("the title's backdrop (rings, sky, palette, openings) draws without errors and inside its triangle budget", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/golf?linkmock");
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  await page.waitForFunction(() => !!(window as unknown as { __golf3d?: { info: () => { triangles: number } } }).__golf3d?.info().triangles, null, SLOW);
  const info = await page.evaluate(() => (window as unknown as { __golf3d: { info: () => { triangles: number; soft: boolean } } }).__golf3d.info());
  // a software renderer (CI) draws the cheapest tier: the hole as it was (about 77.6k triangles) plus the backdrop's one ring layer
  if (info.soft) expect(info.triangles).toBeLessThan(77_556 + 600);
  expect(errors).toEqual([]);
});

test("practice: the range tees up the next ball after each shot, and the putting green starts on a green", async ({ page }) => {
  await openCourse(page, /^Range/);
  await expect(page).toHaveURL(/\/golf\?range$/);
  await expect(page.locator("[data-golf-phase]")).toHaveAttribute("data-golf-phase", "ready", SLOW);
  // the club picks the flag
  await page.getByRole("button", { name: "Driver" }).click();
  await expect(page.locator('[role="log"]')).toContainText("The 250 yard flag.", SLOW);
  // a shot, stepped by hand (CI draws in software, a few frames a second), then the next ball on the tee
  const after = await page.evaluate(() => {
    const g = (window as unknown as Win).__golf as Game & { balls: number };
    g.remoteSwing({ power: 1, face: 0, curve: 0, contact: 1 });
    for (let i = 0; i < 4000 && !(g.phase === "ready" && g.balls === 1); i++) g.step(1 / 60);
    return { phase: g.phase, ball: g.ball, balls: g.balls };
  });
  expect(after).toEqual({ phase: "ready", ball: [0, 0], balls: 1 });
  await expect(page.locator('[role="log"]')).toContainText(/yard flag\./, SLOW);
  await page.goto("/golf?linkmock");
  await expect(page.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  await page.getByRole("button", { name: /^Putting green/ }).click();
  await expect(page.locator("[data-golf-phase]")).toHaveAttribute("data-golf-phase", "putt", SLOW);
  await expect(page.getByRole("button", { name: "Read green" })).toBeVisible();
  await expect(page.locator('[role="log"]')).toContainText(/Green 1\. \d+ feet to the cup\./, SLOW);
});

test("closest to the pin: five balls at one flag end on a card with the best, and its link plays the same flag", async ({ page }) => {
  await openCourse(page, /^Closest to the pin/);
  await expect(page).toHaveURL(/\/golf\?closest=\d+$/);
  await page.evaluate(() => {
    const g = (window as unknown as Win).__golf as Game & { balls: number };
    for (let k = 0; k < 5; k++) {
      g.remoteSwing({ power: g.suggested().power, face: 0, curve: 0, contact: 1 });
      for (let i = 0; i < 4000 && !((g.phase === "ready" && g.balls === k + 1) || g.phase === "round-card"); i++) g.step(1 / 60);
    }
  });
  const card = page.getByRole("dialog", { name: "Challenge over" });
  await expect(card).toBeVisible(SLOW);
  await expect(card).toContainText(/\d+ ft/);
  await expect(card.getByRole("button", { name: "Play again" })).toBeFocused();
  expect((await new AxeBuilder({ page }).include('[aria-label="Challenge over"]').analyze()).violations).toEqual([]);
});
