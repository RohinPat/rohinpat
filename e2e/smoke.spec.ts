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
  { path: "/interests",   titleContains: "Off hours",       visibleText: /Nine things I'm into/ },
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

test("hero phone shows the live Boston time", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel(/Boston time \d{1,2}:\d{2}\s?(AM|PM)/i)).toBeVisible();
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

test("signal lab: heart-rate slider drives the readout", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByLabel("Heart rate");
  await slider.scrollIntoViewIfNeeded();
  await slider.fill("120");
  await expect(page.getByText("120 bpm")).toBeVisible();
  await expect(page.getByRole("img", { name: /120 beats per minute/ })).toBeAttached();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText("72 bpm")).toBeVisible();
});

test("work filmstrip: next/previous step through frames", async ({ page }) => {
  await page.goto("/");
  const prev = page.getByRole("button", { name: "Previous project" });
  const next = page.getByRole("button", { name: "Next project" });
  await next.scrollIntoViewIfNeeded();
  await expect(prev).toBeDisabled();
  await next.click();
  await expect(prev).toBeEnabled();
  await expect(page.getByRole("link", { name: /Closet Organizer/ }).last()).toHaveAttribute(
    "href",
    "/projects#closet-organizer",
  );
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

test("footer sign-off only on home; inner pages get one quiet line", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: /say hi/i })).toBeVisible();
  await page.goto("/projects");
  await expect(page.locator("footer").getByRole("link", { name: /say hi/i })).toHaveCount(0);
  await expect(page.locator("footer").getByRole("link", { name: /privacy/i })).toBeVisible();
});
