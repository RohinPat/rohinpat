import { test, expect } from "@playwright/test";

// The Scope toggle on Music and Cars: off until pressed, then a live spectrum
// of what the piece is playing, with the loudest frequency read out.

test.describe("Scope", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Music: Scope draws the beat and names its loudest frequency", async ({ page }) => {
    await page.goto("/interests");
    await page.getByRole("button", { name: /^Play Music/ }).click();
    const stage = page.getByRole("dialog");
    await expect(stage.getByTestId("scope")).toHaveCount(0);
    await stage.getByRole("button", { name: "Play", exact: true }).click();
    await stage.getByTestId("scope-toggle").click();
    await expect(stage.getByTestId("scope-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(stage.getByTestId("scope")).toBeVisible();
    await expect(stage.getByTestId("scope-peak")).toHaveText(/Loudest \d/, { timeout: 10_000 });
  });

  test("Cars: after a click on Scope, Space is the throttle again, and the engine's note climbs", async ({ page }) => {
    await page.goto("/interests");
    await page.getByRole("button", { name: /^Play Cars/ }).click();
    const stage = page.getByRole("dialog");
    await stage.getByTestId("engine-mode-drag").click();
    await stage.getByTestId("scope-toggle").click();
    await expect(page.locator("[data-autofocus]")).toBeFocused();

    await page.keyboard.down("Space");
    const peak = stage.getByTestId("scope-peak");
    await expect(peak).toHaveText(/Loudest \d/, { timeout: 10_000 });
    const hz = async () => Number(((await peak.textContent()) ?? "").match(/(\d+)/)?.[1] ?? 0);
    const first = await hz();
    await expect.poll(hz, { timeout: 5_000 }).toBeGreaterThan(first + 40);
    await page.keyboard.up("Space");
  });
});

test.describe("Scope on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Cars leaves it out (it would cover the rev counter); Music keeps it", async ({ page }) => {
    await page.goto("/interests");
    await page.getByRole("button", { name: /^Play Cars/ }).click();
    await expect(page.getByRole("dialog").getByTestId("scope-toggle")).toBeHidden();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: /^Play Music/ }).click();
    await expect(page.getByRole("dialog").getByTestId("scope-toggle")).toBeVisible();
  });
});
