import { existsSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The recruiter fast lane: the lock screen's 30-second card, and /resume.

const NAME = /Rohin Patel Software Engineer · WHOOP/;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1400, height: 900 };
const DUO = { width: 1700, height: 1000 };

const notification = (page: Page) => page.getByRole("button", { name: NAME });
const card = (page: Page) => page.getByRole("dialog", { name: "Rohin Patel" });
const stillLocked = (page: Page) => expect(page.getByRole("button", { name: /swipe up to unlock/i })).toBeVisible();

async function open(page: Page, viewport = DESKTOP) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  if (viewport === DUO) await expect(page.locator(".duo")).toBeVisible();
  await notification(page).click();
  await expect(card(page)).toBeVisible();
}

test.describe("the 30-second card", () => {
  test("opens from the lock screen with the mouse; Escape closes it and focus returns", async ({ page }) => {
    await open(page);
    const dlg = card(page);
    await expect(dlg.getByText(/Software Engineer on WHOOP's A&A Shop team/)).toBeVisible();
    await expect(dlg.getByRole("listitem")).toHaveCount(3);
    await expect(dlg.getByRole("link", { name: "rohinp1124@gmail.com" })).toHaveAttribute("href", "mailto:rohinp1124@gmail.com");
    await expect(dlg.getByRole("link", { name: "Resume" })).toHaveAttribute("href", "/resume");
    await expect(dlg.getByRole("link", { name: "See the work" })).toHaveAttribute("href", "/projects");
    await expect(dlg.getByRole("button", { name: "Close the card" })).toBeFocused();
    await stillLocked(page);

    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(notification(page)).toBeFocused();
    await stillLocked(page);
  });

  test("opens from the keyboard; Tab and Shift+Tab stay inside; Escape returns focus", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await notification(page).focus();
    await page.keyboard.press("Enter");
    const dlg = card(page);
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Close the card" })).toBeFocused();

    const inside = () => dlg.evaluate((el) => el.contains(document.activeElement));
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      expect(await inside(), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true);
    }
    // the first control wraps back to the last one
    await dlg.getByRole("button", { name: "Close the card" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dlg.getByRole("link", { name: "See the work" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dlg.getByRole("button", { name: "Close the card" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(notification(page)).toBeFocused();
    await stillLocked(page);
  });

  test("Space opens it too, and the close button closes it", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await notification(page).focus();
    await page.keyboard.press("Space");
    await expect(card(page)).toBeVisible();
    await card(page).getByRole("button", { name: "Close the card" }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(notification(page)).toBeFocused();
  });

  test("does not unlock the phone, whatever you do on it", async ({ page }) => {
    await open(page);
    const box = (await card(page).boundingBox())!;
    const cx = box.x + box.width / 2;
    // scrolling over it, and dragging up across it, are not unlock gestures here
    await page.mouse.move(cx, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await page.mouse.move(cx, box.y + box.height - 60);
    await page.mouse.down();
    await page.mouse.move(cx, box.y + 60, { steps: 8 });
    await page.mouse.up();
    await expect(card(page)).toBeVisible();
    await stillLocked(page);
  });

  test("on a phone it is full screen, over the site nav", async ({ page }) => {
    await open(page, PHONE);
    const box = (await card(page).boundingBox())!;
    expect(Math.round(box.width)).toBe(PHONE.width);
    expect(Math.round(box.height)).toBe(PHONE.height);
    // every control is on screen or reachable by scrolling the card
    await card(page).getByRole("link", { name: "See the work" }).scrollIntoViewIfNeeded();
    await expect(card(page).getByRole("link", { name: "See the work" })).toBeInViewport();
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(hScroll).toBeLessThanOrEqual(1);
    await stillLocked(page);
    await page.keyboard.press("Escape");
    await expect(notification(page)).toBeFocused();
  });

  test("on the desktop phone it sits inside the phone's screen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // measure it where it lands
    await open(page);
    const dlg = (await card(page).boundingBox())!;
    const screen = (await page.locator(".dev-screen").boundingBox())!;
    expect(dlg.x).toBeGreaterThanOrEqual(screen.x - 1);
    expect(dlg.y).toBeGreaterThanOrEqual(screen.y - 1);
    expect(dlg.x + dlg.width).toBeLessThanOrEqual(screen.x + screen.width + 1);
    expect(dlg.y + dlg.height).toBeLessThanOrEqual(screen.y + screen.height + 1);
    await expect(page.locator(".dev-screen").getByRole("dialog")).toHaveCount(1);
  });

  test("on the Duo's cover it opens on the cover and keeps the Duo closed", async ({ page }) => {
    await open(page, DUO);
    await expect(page.locator(".duo-outer").getByRole("dialog")).toHaveCount(1);
    await expect(page.locator(".duo")).not.toHaveClass(/is-open/);
    await stillLocked(page);
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await expect(notification(page)).toBeFocused();
    await expect(page.locator(".duo")).not.toHaveClass(/is-open/);
  });

  test("its links work: Resume and See the work", async ({ page }) => {
    await open(page);
    await card(page).getByRole("link", { name: "Resume" }).click();
    await expect(page).toHaveURL(/\/resume$/);
    await expect(page.getByRole("heading", { level: 1, name: "Rohin Patel" })).toBeVisible();

    await open(page);
    await card(page).getByRole("link", { name: "See the work" }).click();
    await expect(page).toHaveURL(/\/projects$/);

    await open(page);
    await card(page).getByRole("link", { name: "Closet Organizer" }).click();
    await expect(page).toHaveURL(/\/projects\/closet-organizer$/);
  });

  test("has no detectable WCAG A/AA violations while open (phone and desktop)", async ({ page }) => {
    for (const vp of [DESKTOP, PHONE]) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, vp);
      const results = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`);
      expect(summary, `${vp.width}px\n${summary.join("\n")}`).toEqual([]);
    }
  });
});

test.describe("/resume", () => {
  test("renders the header, experience, projects, education and skills", async ({ page }) => {
    const res = await page.goto("/resume");
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Resume — Rohin Patel/);
    await expect(page.getByRole("heading", { level: 1, name: "Rohin Patel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "rohinp1124@gmail.com" })).toHaveAttribute("href", "mailto:rohinp1124@gmail.com");
    await expect(page.getByRole("link", { name: /github\.com\/RohinPat/ })).toHaveAttribute("href", "https://github.com/RohinPat");
    await expect(page.getByRole("link", { name: /linkedin\.com\/in\/rohinpat/ })).toHaveAttribute("href", /linkedin\.com\/in\/rohinpat/);
    for (const h of ["Experience", "Projects", "Education", "Skills"]) {
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    }
    for (const t of ["WHOOP", "SiPhox Health", "Varidx", "Closet Organizer", "AiMessage", "BlueBikes"]) {
      await expect(page.getByRole("heading", { level: 3, name: new RegExp(t) })).toBeVisible();
    }
    // nothing the repo doesn't say is invented: gaps are marked in dev, and
    // left out of a production build (CI tests one) rather than shown to visitors
    if (process.env.CI) await expect(page.locator("[data-placeholder]")).toHaveCount(0);
    else await expect(page.locator("[data-placeholder]").first()).toContainText("TODO(rohin)");
  });

  test('"Download PDF" appears only when public/resume.pdf exists', async ({ page }) => {
    await page.goto("/resume");
    const exists = existsSync(path.join(process.cwd(), "public", "resume.pdf"));
    await expect(page.getByRole("link", { name: "Download PDF" })).toHaveCount(exists ? 1 : 0);
  });

  test("Print / Save as PDF opens the print dialog", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { printed: number }).printed = 0;
      window.print = () => {
        (window as unknown as { printed: number }).printed++;
      };
    });
    await page.goto("/resume");
    await page.getByRole("button", { name: "Print / Save as PDF" }).click();
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  });

  test("print media: no nav, footer or buttons; ink on white", async ({ page }) => {
    await page.goto("/resume");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await expect(page.locator("footer")).toBeHidden();
    await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Rohin Patel" })).toBeVisible();
    const style = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return {
        body: getComputedStyle(document.body).backgroundColor,
        main: getComputedStyle(main).backgroundColor,
        mainImage: getComputedStyle(main).backgroundImage,
        text: getComputedStyle(main).color,
      };
    });
    expect(style.body).toBe("rgb(255, 255, 255)");
    expect(style.main).toBe("rgb(255, 255, 255)");
    expect(style.mainImage).toBe("none");
    expect(style.text).toBe("rgb(0, 0, 0)");
  });

  test("prints to one or two pages", async ({ page }) => {
    await page.goto("/resume");
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ format: "Letter", printBackground: false });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(2);
  });

  test("has no detectable WCAG A/AA violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/resume");
    await page.waitForTimeout(1000);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });

  test("makes no third-party requests and writes no cookies or storage", async ({ page }) => {
    const hosts: string[] = [];
    page.on("request", (r) => {
      const h = new URL(r.url()).hostname;
      if (h !== "localhost" && h !== "127.0.0.1") hosts.push(h);
    });
    await page.goto("/resume");
    expect(hosts).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test("has an Open Graph image", async ({ page }) => {
    await page.goto("/resume");
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(og).toMatch(/\/resume\/opengraph-image/);
    const res = await page.request.get(new URL(og!).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });
});

test.describe("Resume in the nav and footer", () => {
  test("desktop nav and footer link to /resume", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/projects");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Resume$/ }).click();
    await expect(page).toHaveURL(/\/resume$/);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Resume$/ })).toHaveAttribute("aria-current", "page");
    await page.goto("/colophon");
    await page.locator("footer").getByRole("link", { name: /^Resume$/ }).click();
    await expect(page).toHaveURL(/\/resume$/);
  });

  test("the mobile menu has it too", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/projects");
    await page.getByRole("button", { name: /toggle menu/i }).click();
    await page.locator("#mobile-menu").getByRole("link", { name: /^Resume$/ }).click();
    await expect(page).toHaveURL(/\/resume$/);
  });
});
