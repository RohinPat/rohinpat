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

  const projects = page.getByRole("link", { name: /See the work/i });
  await expect(projects).toBeVisible();
  await projects.click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goBack();
  const contact = page.getByRole("link", { name: /^Get in touch$/i });
  await expect(contact).toBeVisible();
  await contact.click();
  await expect(page).toHaveURL(/\/contact$/);

  await page.goBack();
  const interests = page.getByRole("link", { name: /play with the toys/i });
  await expect(interests).toBeVisible();
  await interests.click();
  await expect(page).toHaveURL(/\/interests$/);
});

