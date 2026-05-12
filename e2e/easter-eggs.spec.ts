import { test, expect } from "@playwright/test";

test('typing "siu" anywhere triggers the goal banner', async ({ page }) => {
  await page.goto("/");
  // Click on the body to make sure no input is focused
  await page.locator("h1").first().click();

  await page.keyboard.type("siu", { delay: 60 });

  await expect(page.getByText(/Goallllll/i)).toBeVisible({ timeout: 2000 });
  // Wait for the celebration to disappear (lockout cleanup)
  await expect(page.getByText(/Goallllll/i)).toBeHidden({ timeout: 5000 });
});

test('typing "barca" also triggers', async ({ page }) => {
  await page.goto("/interests");
  await page.locator("h1").first().click();
  await page.keyboard.type("barca", { delay: 60 });
  await expect(page.getByText(/Goallllll/i)).toBeVisible({ timeout: 2000 });
});

test("Konami code triggers the goal banner", async ({ page }) => {
  await page.goto("/");
  await page.locator("h1").first().click();

  const keys = [
    "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
    "b", "a",
  ];
  for (const k of keys) {
    await page.keyboard.press(k);
  }

  await expect(page.getByText(/Goallllll/i)).toBeVisible({ timeout: 2000 });
});

test("easter eggs do NOT fire when typing in a form field", async ({ page }) => {
  await page.goto("/contact");
  // Find the textarea on the contact form and type into it
  const textarea = page.locator('textarea').first();
  await textarea.click();
  await textarea.fill("siu siu siu, here's a message");

  // No banner should appear
  await expect(page.getByText(/Goallllll/i)).toBeHidden();
});

test("console signature is printed on page load", async ({ page }) => {
  const messages: string[] = [];
  page.on("console", (msg) => messages.push(msg.text()));

  await page.goto("/");
  // Give the script a moment to flush its console.log calls
  await page.waitForTimeout(300);

  const joined = messages.join("\n");
  expect(joined).toContain("rohin here");
  expect(joined.toLowerCase()).toContain("github.com/rohinpat");
});
