import { it, vi } from "vitest";
import { BOTS, mean, playRound } from "./golf-bots";
import { stubScratchCanvas } from "./golf-headless";

it("bots", { timeout: 300_000 }, () => {
  stubScratchCanvas();
  for (const name of ["skilled", "casual", "keyboard", "oneButton"]) {
    const rs = Array.from({ length: 30 }, (_, i) => playRound(BOTS[name], i + 1));
    console.log("BOT", name, "total", mean(rs.map((r) => r.total)).toFixed(2), "min", Math.min(...rs.map((r) => r.total)), "max", Math.max(...rs.map((r) => r.total)), "fin", rs.every((r) => r.finished), "pick", rs.reduce((a, r) => a + r.pickedUp, 0), [0, 1, 2, 3, 4, 5].map((h) => mean(rs.map((r) => r.holes[h])).toFixed(2)).join(" "), "sec", mean(rs.map((r) => r.seconds)).toFixed(0));
  }
  vi.restoreAllMocks();
});
