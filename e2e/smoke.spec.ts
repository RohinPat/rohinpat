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

test("Spotify embed iframe is present on /interests (quiet mode)", async ({ page }) => {
  await page.goto("/interests");
  // Quiet mode (fun mode off) renders the Spotify playlist iframe in the Music cell.
  // Wait for hydration so the toggle is interactive.
  const toggle = page.getByRole("switch", { name: /fun mode/i }).first();
  await expect(toggle).toBeVisible({ timeout: 10_000 });

  // If fun mode is on, click to switch to quiet mode.
  if ((await toggle.getAttribute("aria-checked")) === "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }

  await expect(
    page.locator('iframe[src*="open.spotify.com/embed/playlist"]'),
  ).toBeAttached({ timeout: 5_000 });
});
