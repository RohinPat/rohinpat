import { describe, expect, it } from "vitest";
import { hsv, nameOf, vote, type Name } from "@/lib/colour";

// Pixels labelled by Closet Organizer's own _closest_color (Python), so this
// port can't drift from the backend. The port was also checked against the
// backend on 20,256 pixels (20,000 random plus every grey) with no mismatch.
const BACKEND: [Name, [number, number, number][]][] = [
  ["Beige", [[253, 226, 175], [245, 232, 186], [214, 201, 154]]],
  ["Black", [[11, 13, 4], [36, 42, 8], [23, 7, 2]]],
  ["Blue", [[14, 113, 224], [118, 112, 235], [51, 95, 151]]],
  ["Brown", [[138, 91, 37], [121, 73, 28], [111, 115, 90]]],
  ["Gray", [[159, 152, 153], [162, 166, 167], [132, 130, 129]]],
  ["Green", [[48, 249, 14], [52, 162, 15], [97, 155, 145]]],
  ["Navy", [[20, 43, 68], [22, 27, 46], [39, 47, 52]]],
  ["Orange", [[241, 194, 107], [255, 201, 17], [246, 186, 102]]],
  ["Pink", [[253, 119, 176], [245, 124, 206], [212, 88, 187]]],
  ["Purple", [[68, 32, 130], [195, 110, 216], [148, 11, 213]]],
  ["Red", [[228, 136, 117], [201, 87, 86], [117, 90, 92]]],
  ["Teal", [[60, 253, 230], [61, 170, 216], [35, 85, 81]]],
  ["White", [[225, 230, 226], [210, 204, 218], [230, 226, 235]]],
  ["Yellow", [[199, 221, 1], [212, 177, 0], [254, 242, 58]]],
];

const rgba = (px: [number, number, number][], alpha = 255) => px.flatMap(([r, g, b]) => [r, g, b, alpha]);
const fill = (rgb: [number, number, number], n: number) => Array.from({ length: n }, () => rgb);

describe("nameOf", () => {
  it.each(BACKEND)("names %s like the backend", (name, px) => {
    for (const [r, g, b] of px) expect(nameOf(r, g, b)).toBe(name);
  });

  it("keeps full precision at the red/orange edge, like Python's float %", () => {
    // these two sit a hair under 15°; a sloppier wrap calls them Orange
    expect(nameOf(240, 69, 12)).toBe("Red");
    expect(nameOf(233, 92, 45)).toBe("Red");
  });
});

describe("hsv", () => {
  it("matches colorsys", () => {
    expect(hsv(255, 0, 0)).toEqual([0, 1, 1]);
    expect(hsv(0, 0, 255)[0]).toBeCloseTo(240);
    expect(hsv(128, 128, 128)).toEqual([0, 0, 128 / 255]);
  });
});

describe("vote", () => {
  it("names the lit and shaded sides of a navy shirt the same", () => {
    const { picked } = vote(rgba([...fill([24, 34, 84], 60), ...fill([16, 22, 52], 40)]));
    expect(picked.map((v) => v.name)).toEqual(["Navy"]);
  });

  it("only counts a second colour with at least 8% of the vote", () => {
    const stripe = vote(rgba([...fill([20, 30, 80], 90), ...fill([245, 245, 245], 10)]));
    expect(stripe.picked.map((v) => v.name)).toEqual(["Navy", "White"]);
    const fleck = vote(rgba([...fill([20, 30, 80], 95), ...fill([245, 245, 245], 5)]));
    expect(fleck.picked.map((v) => v.name)).toEqual(["Navy"]);
    expect(fleck.all.map((v) => v.name)).toEqual(["Navy", "White"]);
  });

  it("ignores see-through pixels, like the cutout mask", () => {
    const { all } = vote([...rgba(fill([200, 30, 30], 10)), ...rgba(fill([20, 30, 80], 50), 0)]);
    expect(all).toEqual([{ name: "Red", share: 1, rgb: [200, 30, 30] }]);
  });

  it("samples big frames the same way every time", () => {
    const big = rgba(Array.from({ length: 9000 }, (_, i) => (i % 3 ? [40, 140, 60] : [240, 220, 60]) as [number, number, number]));
    const a = vote(big);
    expect(a).toEqual(vote(big));
    expect(a.all.reduce((s, v) => s + v.share, 0)).toBeCloseTo(1);
    expect(a.picked[0].name).toBe("Green");
  });
});
