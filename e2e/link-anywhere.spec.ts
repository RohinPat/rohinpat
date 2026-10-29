import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// The code away from the lock screen, on the BroadcastChannel mock session
// (run the server with NEXT_PUBLIC_LINK_MOCK=1): the home screen's widget once
// it's unlocked, and the Pair chip on Off hours and in each game's stage.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SLOW = { timeout: 15_000 };

async function laptop(context: BrowserContext, path: string) {
  const host = await context.newPage();
  await host.goto(path);
  return host;
}

async function join(context: BrowserContext, code: string) {
  const phone = await context.newPage();
  await phone.setViewportSize(PHONE);
  await phone.goto(`/p#c=${code}`);
  await phone.getByTestId("connect").click();
  await expect(phone.getByTestId("phone-live")).toBeVisible(SLOW);
  return phone;
}

const codeIn = async (host: Page, testId: string) => {
  const el = host.getByTestId(testId);
  await expect(el).toHaveText(/[A-Z0-9]{3}\s?[A-Z0-9]{3}/, SLOW);
  return ((await el.textContent()) ?? "").replace(/\s/g, "");
};

test.describe("pairing away from the lock screen", () => {
  test.use({ viewport: LAPTOP, permissions: ["accelerometer", "gyroscope", "magnetometer"] });

  test("the unlocked home screen keeps the code in a widget, and a phone can link with it", async ({ context }) => {
    const host = await laptop(context, "/");
    await host.getByRole("button", { name: "Pair your phone with this one" }).waitFor(SLOW);
    await host.getByRole("button", { name: "Swipe up to unlock" }).first().click();

    const widget = host.getByTestId("pair-widget");
    await expect(widget).toBeVisible();
    await expect(widget.getByTestId("pair-widget-qr")).toBeVisible(SLOW);
    const code = await codeIn(host, "pair-widget-code");

    const phone = await join(context, code);
    await expect(phone.getByTestId("phone-home")).toBeVisible(SLOW);
    await expect(widget).toHaveAttribute("data-state", "linked");
    await expect(widget).toContainText("Tap an app on your phone");
  });

  test("Off hours starts a link only when Pair is pressed, and the phone lands on the game list", async ({ context }) => {
    const host = await laptop(context, "/interests");
    const chip = host.getByTestId("pair-chip");
    await expect(chip).toBeVisible(SLOW);
    await expect(host.getByTestId("pair-card")).toHaveCount(0);

    await chip.click();
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    const code = await codeIn(host, "pair-code");

    const phone = await join(context, code);
    await expect(phone.getByTestId("phone-piece-list")).toBeVisible(SLOW);
    await expect(chip).toHaveAttribute("data-state", "linked");
    await expect(host.getByTestId("pair-linked")).toContainText("Pick a game on your phone");

    await host.keyboard.press("Escape");
    await expect(host.getByTestId("pair-card")).toHaveCount(0);
    await expect(chip).toBeFocused();
  });

  test("in a game, Escape closes the pairing card first and the game second", async ({ context }) => {
    const host = await laptop(context, "/interests");
    await host.getByRole("button", { name: /play/i }).first().click();
    const stage = host.getByRole("dialog");
    await expect(stage).toBeVisible();

    await stage.getByTestId("pair-chip").click();
    await expect(stage.getByTestId("pair-card")).toBeVisible(SLOW);
    await host.keyboard.press("Escape");
    await expect(host.getByTestId("pair-card")).toHaveCount(0);
    await expect(stage).toBeVisible();

    await host.keyboard.press("Escape");
    await expect(stage).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("there's no Pair chip (the link is for laptops)", async ({ page }) => {
    await page.goto("/interests");
    await expect(page.getByRole("heading", { level: 1, name: "Off hours" })).toBeVisible();
    await expect(page.getByTestId("pair-chip")).toHaveCount(0);
  });
});
