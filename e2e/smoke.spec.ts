import { test, expect } from "@playwright/test";

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
  const thirdParty: string[] = [];
  page.on("request", (req) => {
    const host = new URL(req.url()).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") thirdParty.push(host);
  });
  await page.goto("/interests");
  await page.getByRole("button", { name: /spin the record/i }).click();
  await page.mouse.click(4, 420);
  await page.keyboard.type("hello");
  await page.waitForTimeout(500);
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
  await page.getByRole("button", { name: /spin the record/i }).click();
  await page.keyboard.type("abc");
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

test("home field: hotspots point at the four detailed pages", async ({ page }) => {
  await page.goto("/");
  const spots = page.getByRole("navigation", { name: "Sections" });
  const hrefs = await spots.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(hrefs).toEqual(["/projects", "/projects/closet-organizer", "/interests", "/contact"]);
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

test("watch lume lights up while held", async ({ page }) => {
  await page.goto("/interests");
  const watch = page.getByRole("button", { name: /watch face/i });
  await watch.hover();
  await page.mouse.down();
  await expect(watch).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await expect(watch).toHaveAttribute("aria-pressed", "false");
});

test("Off hours canvas pieces work from the keyboard", async ({ page }) => {
  await page.goto("/interests");
  const golf = page.getByRole("img", { name: /putting green/i });
  await golf.focus();
  await expect(golf).toBeFocused();
  // focusing scrolls the tile into view (smoothly) — let that finish first
  let before = -1;
  await expect
    .poll(async () => {
      const y = await page.evaluate(() => window.scrollY);
      const settled = y === before;
      before = y;
      return settled;
    }, { intervals: [250] })
    .toBe(true);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  // arrows drive the piece instead of scrolling the page
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  for (const name of [/night highway/i, /Blaugrana/i, /ridgelines/i, /dithered/i, /shot chart/i]) {
    await expect(page.getByRole("img", { name })).toHaveAttribute("tabindex", "0");
  }
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
