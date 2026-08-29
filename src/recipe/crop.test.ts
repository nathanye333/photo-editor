import { describe, expect, it } from "vitest";
import { handleHitBox } from "../ui/crop";
import { applyAspectPreset, cropAffectsPixels, cropZoom, defaultCrop, normalizeCrop } from "./crop";
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

describe("cropZoom", () => {
  it("does not zoom a full-frame crop", () => {
    expect(cropZoom(defaultCrop(), 800, 600, 800, 600).scale).toBe(1);
  });

  it("zooms so a half-size crop fills the viewport", () => {
    const crop = normalizeCrop({ enabled: true, x: 0, y: 0, width: 0.5, height: 0.5 });
    const { scale, dx, dy } = cropZoom(crop, 800, 600, 800, 600, 0);
    expect(scale).toBeCloseTo(2, 5);
    // Crop centre (0.25, 0.25) must move to the frame centre (0.5, 0.5).
    expect(dx).toBeCloseTo(200, 5);
    expect(dy).toBeCloseTo(150, 5);
  });

  it("stays at scale 1 when sizes are not measured yet", () => {
    expect(cropZoom(defaultCrop(), 0, 0, 0, 0)).toEqual({ scale: 1, dx: 0, dy: 0 });
  });
});

describe("handleHitBox", () => {
  it("keeps a corner handle inside the preview bounds", () => {
    const size = 24;
    for (const [x, y] of [
      [0, 0],
      [800, 0],
      [0, 600],
      [800, 600],
    ]) {
      const box = handleHitBox(x, y, size, 800, 600);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeLessThanOrEqual(800);
      expect(box.top + box.height).toBeLessThanOrEqual(600);
    }
  });

  it("centres a handle that is away from the edges", () => {
    expect(handleHitBox(400, 300, 24, 800, 600)).toEqual({ left: 388, top: 288, width: 24, height: 24 });
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
