import { test, expect } from "@playwright/test";

test("nav links route between top-level pages", async ({ page }) => {
  await page.goto("/");

  // Click Projects → /projects
  await page.getByRole("link", { name: /^Projects$/ }).first().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText(/What I've built/)).toBeVisible();

  // Click Interests → /interests
  await page.getByRole("link", { name: /^Interests$/ }).first().click();
  await expect(page).toHaveURL(/\/interests$/);
  await expect(page.getByText(/What I'm into/)).toBeVisible();

  // Click logo → home
  await page.getByRole("link", { name: /rohin patel/i }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Hero CTAs go to the right places", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: /See the projects/i }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goBack();
  await page.getByRole("link", { name: /Get in touch/i }).click();
  await expect(page).toHaveURL(/\/contact$/);

  await page.goBack();
  await page.getByRole("link", { name: /just see what I'm into/i }).click();
  await expect(page).toHaveURL(/\/interests$/);
});

test("Selected Interests tiles deep-link into /interests", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Full page/ }).click();
  await expect(page).toHaveURL(/\/interests$/);
});
