import { test, expect, type Page } from "@playwright/test";

// The hold-to-read view on the green: Tab held at address shows it (the game's root carries data-read-view), and
// letting go returns to the putt. Waits are on the page's state, never on the clock.

const SLOW = { timeout: 20_000 };
test.describe.configure({ timeout: 60_000 });

type Win = {
  __golf: {
    phase: string;
    step: (dt: number) => void;
    afterRest: () => void;
    hole: { green: { cup: [number, number] }; fromGreen: (x: number, y: number) => [number, number] };
    ball: [number, number];
    lie: string;
    putt: { ball: { moving: boolean } };
  };
};

async function openCourse(p: Page) {
  await p.goto("/golf?linkmock");
  await expect(p.locator("[data-golf-screen=title]")).toBeVisible(SLOW);
  await p.getByRole("button", { name: /Nine holes/ }).click();
  await expect(p.locator("[data-golf-phase]")).toBeVisible(SLOW);
  await p.waitForFunction(() => !!(window as unknown as Win).__golf, null, SLOW);
}

/** the ball on the green, 5 m short of the cup, at address */
async function toAddress(p: Page) {
  await p.evaluate(() => {
    const g = (window as unknown as Win).__golf;
    for (let i = 0; i < 600 && g.phase !== "ready"; i++) g.step(1 / 60);
    const [cx, cy] = g.hole.green.cup;
    g.ball = g.hole.fromGreen(cx - 5, cy);
    g.lie = "green";
    g.afterRest();
  });
  await expect(p.locator("[data-golf-phase]")).toHaveAttribute("data-golf-phase", "putt", SLOW);
}

test("holding Tab on the green shows the read view, and letting go returns to the putt", async ({ page }) => {
  await openCourse(page);
  await toAddress(page);
  await expect(page.locator("[data-read-view]")).toHaveAttribute("data-read-view", "off");
  await page.locator("canvas[data-autofocus]").focus();
  await page.keyboard.down("Tab");
  await expect(page.locator("[data-read-view]")).toHaveAttribute("data-read-view", "map", SLOW);
  // 2 switches to the low view while Tab is held
  await page.keyboard.press("2");
  await expect(page.locator("[data-read-view]")).toHaveAttribute("data-read-view", "low", SLOW);
  await page.keyboard.up("Tab");
  await expect(page.locator("[data-read-view]")).toHaveAttribute("data-read-view", "off", SLOW);
  // back at address, still putting
  await expect(page.locator("[data-golf-phase]")).toHaveAttribute("data-golf-phase", "putt");
});

test("Tab is not kept from the page away from the green, and Escape still pauses while the view is held", async ({ page }) => {
  await openCourse(page);
  await toAddress(page);
  await page.locator("canvas[data-autofocus]").focus();
  await page.keyboard.down("Tab");
  await expect(page.locator("[data-read-view]")).toHaveAttribute("data-read-view", "map", SLOW);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible(SLOW);
  await expect(page.locator("[data-read-view]")).toHaveAttribute("data-read-view", "off", SLOW);
  await page.keyboard.up("Tab");
});
