import { describe, expect, it } from "vitest";
import { bandLevels, binHz, F_MAX, F_MIN, formatHz, logBands, logX, loudest } from "@/components/offhours/scopeBands";

const SR = 48_000;
const FFT = 4096;

describe("scope bands", () => {
  it("puts F_MIN at the left edge, F_MAX at the right and each octave the same width", () => {
    expect(logX(F_MIN)).toBeCloseTo(0);
    expect(logX(F_MAX)).toBeCloseTo(1);
    expect(logX(200) - logX(100)).toBeCloseTo(logX(4000) - logX(2000));
  });

  it("covers the range with bins in order, at least one bin a bar, inside the analyser's bins", () => {
    const bands = logBands(120, SR, FFT);
    expect(bands).toHaveLength(120);
    for (const [from, to] of bands) {
      expect(to).toBeGreaterThan(from);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeLessThanOrEqual(FFT / 2);
    }
    for (let i = 1; i < bands.length; i++) expect(bands[i][0]).toBeGreaterThanOrEqual(bands[i - 1][0]);
    expect(bands[0][0]).toBe(Math.floor(F_MIN / binHz(SR, FFT)));
    expect(bands[119][1]).toBe(Math.ceil(F_MAX / binHz(SR, FFT)));
  });

  it("takes each band's loudest bin, scaled to 0..1", () => {
    const data = new Uint8Array(16);
    data[2] = 51;
    data[3] = 255;
    expect(bandLevels(data, [[0, 2], [2, 4]])).toEqual([0, 1]);
  });
});

describe("loudest", () => {
  it("finds a tone between bins, not just on the bin grid", () => {
    const w = binHz(SR, FFT); // ~11.7 Hz
    const f = 120;
    const data = new Uint8Array(FFT / 2);
    // a peak shaped like an analyser's: falls off either side of the true frequency
    for (let i = 0; i < data.length; i++) data[i] = Math.max(0, 220 - 60 * Math.abs(i - f / w) ** 2);
    const got = loudest(data, SR, FFT)!;
    expect(Math.abs(got - f)).toBeLessThan(w / 4);
  });

  it("says nothing when everything is under the floor", () => {
    expect(loudest(new Uint8Array(FFT / 2).fill(10), SR, FFT)).toBeNull();
  });
});

it("formats Hz and kHz", () => {
  expect(formatHz(142.4)).toBe("142 Hz");
  expect(formatHz(1234)).toBe("1.2 kHz");
});
