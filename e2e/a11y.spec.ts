import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Automated WCAG 2.2 AA scan of every route. axe catches roughly a third of
// real-world issues (contrast, labels, names, landmarks) — it is a floor, not
// a substitute for keyboard + screen-reader testing.

const routes = [
  "/",
  "/projects",
  "/projects/closet-organizer",
  "/interests",
  "/contact",
  "/privacy",
  "/terms",
  "/cookies",
];

for (const path of routes) {
  test(`${path} has no detectable WCAG A/AA violations`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    // Let entrance animations settle so contrast is measured on final colors.
    await page.waitForTimeout(1500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  });
}

test("skip link moves focus to main content", async ({ page }) => {
  await page.goto("/projects");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /skip to content/i });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});
