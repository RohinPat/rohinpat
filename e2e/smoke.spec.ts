import { test, expect } from "@playwright/test";

// One smoke per route: page renders, title is right, expected content visible.
// Catches the worst failure mode for a portfolio — "the site is broken."

const routes: Array<{
  path: string;
  titleContains: string;
  visibleText: RegExp;
}> = [
  { path: "/",            titleContains: "Rohin Patel",     visibleText: /Incoming Software Engineer at WHOOP/ },
  { path: "/projects",    titleContains: "Work",            visibleText: /What I've built/ },
  { path: "/experience",  titleContains: "Experience",      visibleText: /Where I've worked/ },
  { path: "/skills",      titleContains: "Skills",          visibleText: /I mostly live in/ },
  { path: "/interests",   titleContains: "Interests",       visibleText: /What I'm into/ },
  { path: "/contact",     titleContains: "Contact",         visibleText: /Just email me/ },
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

test("homepage shows the live Boston time pill", async ({ page }) => {
  await page.goto("/");
  // Match a 12-hour time like "11:42 AM" or "9:05 PM"
  await expect(
    page.locator("p").filter({ hasText: /\d{1,2}:\d{2}\s?(AM|PM)/i }).first(),
  ).toBeVisible();
});

test("homepage has scroll progress bar", async ({ page }) => {
  await page.goto("/");
  const bar = page.locator("div.fixed.top-0").first();
  await expect(bar).toBeAttached();
});

test("Spotify embed on /interests loads only after the visitor asks", async ({ page }) => {
  const thirdParty: string[] = [];
  page.on("request", (req) => {
    const host = new URL(req.url()).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") thirdParty.push(host);
  });

  await page.goto("/interests");
  // Wait for hydration so the toggle is interactive.
  const toggle = page.getByRole("switch", { name: /fun mode/i }).first();
  await expect(toggle).toBeVisible({ timeout: 10_000 });

  if ((await toggle.getAttribute("aria-checked")) === "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }

  // Click-to-load: no iframe and no third-party requests until asked.
  const iframe = page.locator('iframe[src*="open.spotify.com/embed/playlist"]');
  await expect(page.getByRole("button", { name: /load spotify player/i })).toBeVisible();
  await expect(iframe).toHaveCount(0);
  expect(thirdParty).toEqual([]);

  await page.getByRole("button", { name: /load spotify player/i }).click();
  await expect(iframe).toBeAttached({ timeout: 5_000 });
});

test("a plain visit writes nothing to cookies or local storage", async ({ page }) => {
  for (const path of ["/", "/interests", "/contact"]) {
    await page.goto(path);
    await page.waitForTimeout(500);
  }
  const { cookies, keys } = await page.evaluate(() => ({
    cookies: document.cookie,
    keys: Object.keys(localStorage),
  }));
  expect(cookies).toBe("");
  expect(keys).toEqual([]);
});
