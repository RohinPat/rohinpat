import { test, expect } from "@playwright/test";

// Home opens on a lock screen; unlock it the way a visitor would.
async function unlock(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /swipe up to unlock/i });
  await btn.click();
  await expect(btn).toHaveCount(0);
}

// One smoke per route: page renders, title is right, expected content visible.
// Catches the worst failure mode for a portfolio — "the site is broken."

const routes: Array<{
  path: string;
  titleContains: string;
  visibleText: RegExp;
}> = [
  { path: "/",            titleContains: "Rohin Patel",     visibleText: /I build iOS apps/ },
  { path: "/projects",    titleContains: "Work",            visibleText: /SiPhox Health/ },
  { path: "/interests",   titleContains: "Off hours",       visibleText: /Nine things I like outside work/ },
  { path: "/contact",     titleContains: "Contact",         visibleText: /rohinp1124@gmail\.com/ },
];

for (const { path, titleContains, visibleText } of routes) {
  test(`${path} renders successfully`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status(), `${path} should return 2xx`).toBeLessThan(400);

    await expect(page).toHaveTitle(new RegExp(titleContains, "i"));
    await expect(page.getByText(visibleText).first()).toBeVisible();
  });
}

test("/play returns 404 (route removed)", async ({ page }) => {
  const response = await page.goto("/play");
  expect(response?.status()).toBe(404);
});

test("Off hours makes no third-party requests, even when you play", async ({ page }) => {
  test.setTimeout(60_000); // opens the 3D keyboard, slow in a software renderer
  const thirdParty: string[] = [];
  page.on("request", (req) => {
    const host = new URL(req.url()).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") thirdParty.push(host);
  });
  await page.goto("/interests");
  await page.getByRole("button", { name: /^Play Music/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Play Keyboards/ }).click();
  await page.keyboard.type("hello");
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  expect(thirdParty).toEqual([]);
  await expect(page.getByRole("link", { name: /playlist/i })).toHaveAttribute("href", /open\.spotify\.com\/playlist/);
});

test("a plain visit writes nothing to cookies or local storage", async ({ page }) => {
  for (const path of ["/", "/interests", "/contact"]) {
    await page.goto(path);
    await page.waitForTimeout(500);
  }
  // even after interacting with the pieces
  await page.goto("/interests");
  await page.getByRole("button", { name: /^Play Keyboards/ }).click();
  await page.keyboard.type("abc");
  await page.keyboard.press("Escape");
  const { cookies, keys } = await page.evaluate(() => ({
    cookies: document.cookie,
    keys: Object.keys(localStorage),
  }));
  expect(cookies).toBe("");
  expect(keys).toEqual([]);
});

test("case-study diagram: focusing a stage explains it", async ({ page }) => {
  await page.goto("/projects/closet-organizer");
  const stage = page.getByRole("button", { name: /Tagging/ }).first();
  await stage.scrollIntoViewIfNeeded();
  await stage.focus();
  await expect(stage).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/18 categories and 5 styles/).first()).toBeVisible();
});

test("home screen: dock and grid point at the right places", async ({ page }) => {
  await page.goto("/");
  const dock = page.getByRole("navigation", { name: "Dock" });
  const dockHrefs = await dock.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(dockHrefs).toEqual(["/projects", "/interests", "/contact", "mailto:rohinp1124@gmail.com"]);
  await expect(page.getByRole("link", { name: /GitHub/ }).first()).toHaveAttribute("href", "https://github.com/RohinPat");
});

test("home screen: opens locked; unlocking reveals the apps", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /swipe up to unlock/i })).toBeVisible();
  await expect(page.getByLabel(/Boston time \d{1,2}:\d{2}/).first()).toBeAttached();
  await unlock(page);
  await expect(page.getByRole("navigation", { name: "Dock" }).getByRole("link", { name: "Work" })).toBeVisible();
});

test("home screen: on wide screens it's an iPhone Duo that unfolds on unlock", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const duo = page.locator("[data-duo]");
  await expect(duo).toHaveAttribute("data-duo", "closed");
  await unlock(page);
  await expect(duo).toHaveAttribute("data-duo", "open");
  await expect(page.locator(".duo-leaf")).toHaveCount(0);
  const dock = page.getByRole("navigation", { name: "Dock" });
  await expect(dock.getByRole("link", { name: "Work" })).toBeVisible();
  // the open device fits the window
  const box = (await duo.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1920);
  expect(box.y + box.height).toBeLessThanOrEqual(1080);
});

test("home screen: Control Center toggles the wallpaper", async ({ page }) => {
  await page.goto("/");
  await unlock(page);
  await page.getByRole("button", { name: "Open Control Center" }).first().click();
  const cc = page.getByRole("dialog", { name: "Control Center" });
  await expect(cc).toBeVisible();
  const dark = cc.getByRole("button", { name: "Dark wallpaper" });
  await expect(dark).toHaveAttribute("aria-pressed", "false");
  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(cc).toHaveCount(0);
});

test("home screen: long-press an icon to jiggle, Done to stop", async ({ page }) => {
  await page.goto("/");
  await unlock(page);
  const icon = page.locator('[data-tile="colophon"]');
  const box = (await icon.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  const done = page.getByRole("button", { name: "Done" });
  await expect(done).toBeVisible();
  await done.click();
  await expect(done).toHaveCount(0);
});

test("case study: renders, links its code, and every excerpt links to GitHub", async ({ page }) => {
  const res = await page.goto("/projects/closet-organizer");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/Closet Organizer/);
  await expect(page.getByRole("heading", { level: 1, name: /Closet Organizer/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Read the code on GitHub/ })).toHaveAttribute(
    "href",
    "https://github.com/RohinPat/Closet-Org",
  );
  const excerpts = page.locator("figure.code-block figcaption a");
  expect(await excerpts.count()).toBeGreaterThanOrEqual(2);
  for (const href of await excerpts.evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
    expect(href).toMatch(/^https:\/\/github\.com\/RohinPat\/Closet-Org\/blob\/[0-9a-f]{40}\/.+#L\d+-L\d+$/);
  }
});

test("work page links the write-up and the code", async ({ page }) => {
  await page.goto("/projects");
  const row = page.locator("#closet-organizer");
  await expect(row.getByRole("link", { name: /Read the write-up/ })).toHaveAttribute("href", "/projects/closet-organizer");
  await expect(row.getByRole("link", { name: /Code/ })).toHaveAttribute("href", "https://github.com/RohinPat/Closet-Org");
});

test("project deep link lands on that entry", async ({ page }) => {
  await page.goto("/projects#aimessage");
  await expect(page.locator("#aimessage")).toBeInViewport();
});

test("watch: turning the crown winds the power reserve", async ({ page }) => {
  test.setTimeout(60_000); // 3D in a software renderer is slow to start
  await page.goto("/interests");
  await page.getByRole("button", { name: /^Play Watches/ }).click();
  const crown = page.getByRole("slider", { name: /Crown/ });
  await expect(crown).toBeFocused({ timeout: 15_000 });
  const before = Number(await crown.getAttribute("aria-valuenow"));
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(async () => Number(await crown.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
});

test("Off hours: every piece opens full screen from the keyboard and Escape brings you back", async ({ page }) => {
  test.setTimeout(150_000); // nine pieces, three of them 3D in a software renderer
  await page.goto("/interests");
  await page.waitForLoadState("networkidle");
  for (const name of ["Watches", "Gaming", "Basketball", "Barça", "Music", "Cars", "Keyboards", "Golf", "Skiing"]) {
    const tile = page.getByRole("button", { name: new RegExp(`^Play ${name}`) });
    await tile.focus();
    await page.keyboard.press("Enter");
    const stage = page.getByRole("dialog");
    await expect(stage).toBeVisible();
    // focus moves into the stage
    await expect.poll(() => stage.evaluate((el) => el.contains(document.activeElement)), { timeout: 15_000 }).toBe(true);
    await page.keyboard.press("Escape");
    await expect(stage).toHaveCount(0);
    await expect(tile).toBeFocused();
  }
});

test("Off hours: the maze solvers find the exit", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/interests");
  await page.getByRole("button", { name: /^Play Gaming/ }).click();
  const stage = page.getByRole("dialog");
  await stage.getByRole("button", { name: "BFS", exact: true }).click();
  await expect(stage.locator("[aria-live]")).toHaveText(/BFS: expanded \d+ cells, path \d+ steps/, { timeout: 30_000 });
});

test("footer is one quiet line on every page", async ({ page }) => {
  for (const path of ["/", "/projects"]) {
    await page.goto(path);
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: /say hi/i })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: /privacy/i })).toBeVisible();
  }
});

test("colophon measures this page in the browser: no other domains, no cookies", async ({ page }) => {
  await page.goto("/colophon");
  await expect(page.getByRole("heading", { level: 1, name: /Colophon/ })).toBeVisible();
  const stat = (label: string) => page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
  await expect(stat("Requests")).toHaveText(/^\d+$/);
  await expect(stat("Other domains")).toHaveText("0");
  await expect(stat("Cookies")).toHaveText("0");
  await expect(stat("Storage keys")).toHaveText("0");
  await page.getByRole("button", { name: "Measure again" }).click();
  await expect(stat("Other domains")).toHaveText("0");
});

test("case study: 'On this page' tracks the section you're reading", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects/closet-organizer");
  const rail = page.getByRole("navigation", { name: "On this page" });
  // wait for hydration (the rail builds itself from the headings), then scroll
  await expect(rail.getByRole("link", { name: "Trade-offs" })).toBeAttached();
  // bring the heading to the top, as clicking its rail link would
  await page.evaluate(() =>
    document.querySelector("#trade-offs")?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior }),
  );
  await expect(rail.locator("[aria-current]")).toHaveText("Trade-offs");
});
