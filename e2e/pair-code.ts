import { expect, type Page } from "@playwright/test";

/**
 * The code the lock screen offers, read the way a visitor would: open the
 * padlock above the date, read the card, put it away again. Waits for the
 * link to start (the padlock only becomes a button then).
 */
export async function pairCode(host: Page, timeout = 15000): Promise<string> {
  const lock = host.getByRole("button", { name: "Pair your phone with this one" });
  await lock.waitFor({ timeout });
  if ((await lock.getAttribute("aria-expanded")) !== "true") await lock.click();
  const text = (await host.getByTestId("pair-code").textContent({ timeout })) ?? "";
  const code = text.replace(/\s/g, "");
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await host.keyboard.press("Escape");
  await expect(host.getByTestId("pair-card")).toHaveCount(0);
  return code;
}
