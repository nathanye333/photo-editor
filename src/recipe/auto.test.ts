import { describe, expect, it } from "vitest";
import {
  analyzePixels,
  autoTone,
  autoWhiteBalance,
  whiteBalanceFromGains,
  whiteBalanceFromNeutral,
} from "./auto";

/** Builds an RGBA buffer where every pixel has the given colour. */
function flat(r: number, g: number, b: number, count = 64): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** A ramp from black to white, so percentiles have something to find. */
function ramp(count = 256): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const v = Math.round((i / (count - 1)) * 255);
    out.set([v, v, v, 255], i * 4);
  }
  return out;
}

describe("analyzePixels", () => {
  it("measures channel means and percentiles", () => {
    const stats = analyzePixels(ramp());
    expect(stats.meanLuma).toBeCloseTo(0.5, 1);
    expect(stats.black).toBeLessThan(0.05);
    expect(stats.white).toBeGreaterThan(0.95);
  });

  it("reports clipping at both ends", () => {
    const stats = analyzePixels(flat(0, 0, 0));
    expect(stats.clipLow).toBe(1);
    expect(stats.clipHigh).toBe(0);
    expect(analyzePixels(flat(255, 255, 255)).clipHigh).toBe(1);
  });

  it("handles three-channel buffers and empty input", () => {
    const rgb = new Uint8Array([255, 128, 0, 255, 128, 0]);
    expect(analyzePixels(rgb, 3).mean[0]).toBeCloseTo(1, 5);
    expect(analyzePixels(new Uint8Array()).meanLuma).toBe(0);
  });
});

describe("white balance estimates", () => {
  it("is neutral for a grey scene", () => {
    expect(autoWhiteBalance(analyzePixels(flat(128, 128, 128)))).toEqual({ temp: 0, tint: 0 });
  });

  it("cools a warm scene and warms a cool one", () => {
    expect(autoWhiteBalance(analyzePixels(flat(200, 150, 100))).temp).toBeLessThan(0);
    expect(autoWhiteBalance(analyzePixels(flat(100, 150, 200))).temp).toBeGreaterThan(0);
  });

  it("pulls tint away from a green cast", () => {
    expect(autoWhiteBalance(analyzePixels(flat(120, 200, 120))).tint).toBeLessThan(0);
  });

  it("inverts the DNG as-shot neutral", () => {
    // A camera that sees grey as red-heavy was shooting under warm light.
    expect(whiteBalanceFromNeutral([0.9, 1, 0.5]).temp).toBeLessThan(0);
    expect(whiteBalanceFromNeutral([1, 1, 1])).toEqual({ temp: 0, tint: 0 });
  });

  it("survives zero and non-finite gains", () => {
    expect(whiteBalanceFromGains(0, 0, 0)).toEqual({ temp: 0, tint: 0 });
    expect(whiteBalanceFromNeutral([0, 0, 0])).toEqual({ temp: 0, tint: 0 });
  });
});

describe("autoTone", () => {
  it("brightens a dark image and darkens a bright one", () => {
    expect(autoTone(analyzePixels(flat(40, 40, 40))).exposure).toBeGreaterThan(0);
    expect(autoTone(analyzePixels(flat(220, 220, 220))).exposure).toBeLessThan(0);
  });

  it("stays within one and a half stops", () => {
    expect(autoTone(analyzePixels(flat(1, 1, 1))).exposure).toBe(1.5);
    const bright = autoTone(analyzePixels(flat(255, 255, 255))).exposure ?? 0;
    expect(bright).toBeGreaterThanOrEqual(-1.5);
    expect(bright).toBeLessThan(-1);
  });

  it("adds contrast to a flat image but not to a full-range one", () => {
    const flatScene = autoTone(analyzePixels(flat(120, 120, 120)));
    const fullRange = autoTone(analyzePixels(ramp()));
    expect(flatScene.contrast).toBeGreaterThan(0);
    expect(fullRange.contrast).toBeLessThan(flatScene.contrast ?? 0);
  });

  it("recovers clipped ends", () => {
    expect(autoTone(analyzePixels(flat(255, 255, 255))).highlights).toBeLessThan(0);
    expect(autoTone(analyzePixels(flat(0, 0, 0))).shadows).toBeGreaterThan(0);
  });

  it("leaves a well-exposed grey ramp roughly alone", () => {
    const patch = autoTone(analyzePixels(ramp()));
    expect(Math.abs(patch.exposure ?? 0)).toBeLessThan(0.2);
    expect(patch.temp).toBe(0);
    expect(patch.tint).toBe(0);
  });
});
