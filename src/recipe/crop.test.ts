import { describe, expect, it } from "vitest";
import { applyAspectPreset, cropAffectsPixels, defaultCrop, normalizeCrop } from "./crop";
import { defaultRecipe } from "./defaults";
import { applyPatch } from "./patch";

describe("crop", () => {
  it("normalizes crop rect", () => {
    const c = normalizeCrop({ x: -1, y: 2, width: 2, height: 0, angle: 99 });
    expect(c.x).toBe(0);
    expect(c.y).toBe(1);
    expect(c.width).toBe(1);
    expect(c.height).toBeGreaterThanOrEqual(0.02);
    expect(c.angle).toBe(45);
  });

  it("applies 4:5 aspect preset", () => {
    const next = applyAspectPreset(defaultCrop(), "4:5", 4000, 3000);
    expect(next.aspect).toBe("4:5");
    expect(next.enabled).toBe(true);
    const ratio = (next.width * 4000) / (next.height * 3000);
    expect(ratio).toBeCloseTo(4 / 5, 2);
  });

  it("renders the crop pass for straighten without a crop rect", () => {
    expect(cropAffectsPixels(defaultCrop())).toBe(false);
    expect(cropAffectsPixels({ ...defaultCrop(), angle: 2 })).toBe(true);
    expect(cropAffectsPixels({ ...defaultCrop(), enabled: true })).toBe(true);
  });
});

describe("applyPatch crop", () => {
  it("patches crop and syncs legacy cropAngle", () => {
    const r = applyPatch(defaultRecipe(), { crop: { angle: 3.5, enabled: true } }, "absolute");
    expect(r.crop.angle).toBe(3.5);
    expect(r.globals.cropAngle).toBe(3.5);
  });

  it("migrates legacy cropAngle from globals", () => {
    const base = applyPatch(defaultRecipe(), { globals: { cropAngle: -2 } }, "absolute");
    expect(base.crop.angle).toBe(-2);
  });
});
