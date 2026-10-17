import { chromium, devices } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch();
for (const [name, dev] of [["iphone13", devices["iPhone 13"]], ["se", devices["iPhone SE"]]]) {
  const ctx = await b.newContext({ ...dev });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await p.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${name}-lock.png` });
  await p.getByRole("button", { name: /swipe up to unlock/i }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${name}-home.png` });
  await ctx.close();
}
// Duo opening, frame by frame
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/duo-0.png` });
await p.getByRole("button", { name: /swipe up to unlock/i }).click();
for (let i = 1; i <= 9; i++) {
  await p.waitForTimeout(90);
  await p.screenshot({ path: `${out}/duo-${i}.png`, clip: { x: 360, y: 120, width: 1200, height: 860 } });
}
await b.close();
