import { test, expect, type Page } from "@playwright/test";

// The air pointer lab on the BroadcastChannel mock session (run the server
// with NEXT_PUBLIC_LINK_MOCK=1). The phone's orientation is faked by
// dispatching deviceorientation events on its page.

const LAPTOP = { width: 1440, height: 900 };
const REACH = 40; // DEFAULT_TUNING.reach

const orient = (phone: Page, alpha: number, beta: number, gamma = 0) =>
  phone.evaluate(([a, b, g]) => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: a, beta: b, gamma: g })), [alpha, beta, gamma]);

async function hold(phone: Page, alpha: number, beta: number, n = 20) {
  for (let i = 0; i < n; i++) {
    await orient(phone, alpha, beta);
    await phone.waitForTimeout(30);
  }
}

test("the phone aims the dot and clicks a drill target", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: LAPTOP, permissions: ["accelerometer", "gyroscope", "magnetometer"] });
  const host = await context.newPage();
  await host.goto("/lab/pointer");
  const codeEl = host.getByTestId("pair-code");
  await expect(codeEl).toHaveText(/[A-Z0-9]{3}\s?[A-Z0-9]{3}/, { timeout: 15_000 });
  const code = ((await codeEl.textContent()) ?? "").replace(/\s/g, "");

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`/p#c=${code}`);
  await phone.getByTestId("connect").click();
  await expect(phone.getByTestId("pointer-pad")).toBeVisible({ timeout: 15_000 });

  await hold(phone, 0, 0);
  await phone.getByTestId("pointer-center").click();
  const dot = host.getByTestId("pointer-dot");
  await expect.poll(() => dot.evaluate((d) => d.style.transform)).toBe("translate(720px, 450px)");

  // 10° right and 5° up: a quarter of the reach across, an eighth of the width up
  await hold(phone, -10, 5);
  await expect.poll(() => dot.evaluate((d) => d.style.transform)).toBe(`translate(${720 + (10 * LAPTOP.width) / REACH}px, ${450 - (5 * LAPTOP.width) / REACH}px)`);

  await host.getByRole("button", { name: "Start the drill" }).click();
  const t = (await host.getByTestId("pointer-target").boundingBox())!;
  const px = LAPTOP.width / REACH;
  await hold(phone, -(t.x + t.width / 2 - 720) / px, -(t.y + t.height / 2 - 450) / px, 30);
  await host.waitForTimeout(300);
  const pad = (await phone.getByTestId("pointer-pad").boundingBox())!;
  await phone.mouse.click(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await expect(host.getByTestId("pointer-stats")).toContainText(/px\s*1\s*0/);
  await context.close();
});
