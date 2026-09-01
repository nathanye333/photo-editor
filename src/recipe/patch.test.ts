import { describe, expect, it } from "vitest";
import { createBrushMask, createColorRangeMask, createLuminanceMask, createRadialMask, defaultRecipe } from "./defaults";
import { applyCatalogPatch, applyPatch, clamp, parseRecipe } from "./patch";
import { isNeutralGrading, MAX_MASKS } from "./types";

describe("applyPatch", () => {
  it("sets absolute values and clamps", () => {
    const r = applyPatch(defaultRecipe(), { globals: { exposure: 12, contrast: -200 } }, "absolute");
    expect(r.globals.exposure).toBe(5);
    expect(r.globals.contrast).toBe(-100);
  });

  it("applies relative deltas then clamps", () => {
    const base = applyPatch(defaultRecipe(), { globals: { exposure: 4 } }, "absolute");
    const r = applyPatch(base, { globals: { exposure: 2, shadows: 20 } }, "delta");
    expect(r.globals.exposure).toBe(5);
    expect(r.globals.shadows).toBe(20);
  });

  it("patches nested HSL", () => {
    const r = applyPatch(
      defaultRecipe(),
      { globals: { hsl: { orange: { sat: 15 } } } },
      "delta",
    );
    expect(r.globals.hsl.orange.sat).toBe(15);
    expect(r.globals.hsl.red.sat).toBe(0);
  });

  it("patches one colour grading zone at a time", () => {
    const r = applyPatch(
      defaultRecipe(),
      { globals: { colorGrading: { shadows: { hue: 200, sat: 30 }, balance: -20 } } },
      "absolute",
    );
    expect(r.globals.colorGrading.shadows).toEqual({ hue: 200, sat: 30, lum: 0 });
    expect(r.globals.colorGrading.highlights).toEqual({ hue: 0, sat: 0, lum: 0 });
    expect(r.globals.colorGrading.balance).toBe(-20);
    expect(r.globals.colorGrading.blending).toBe(50);
  });

  it("wraps grading hue and clamps the rest", () => {
    const r = applyPatch(
      defaultRecipe(),
      { globals: { colorGrading: { highlights: { hue: 400, sat: 250, lum: -400 }, blending: 900 } } },
      "absolute",
    );
    expect(r.globals.colorGrading.highlights).toEqual({ hue: 40, sat: 100, lum: -100 });
    expect(r.globals.colorGrading.blending).toBe(100);
  });

  it("wraps hue deltas past the ends of the wheel", () => {
    const base = applyPatch(
      defaultRecipe(),
      { globals: { colorGrading: { midtones: { hue: 350 } } } },
      "absolute",
    );
    const r = applyPatch(base, { globals: { colorGrading: { midtones: { hue: 30 } } } }, "delta");
    expect(r.globals.colorGrading.midtones.hue).toBe(20);
  });

  it("reads neutral grading as a no-op", () => {
    expect(isNeutralGrading(defaultRecipe().globals.colorGrading)).toBe(true);
    const graded = applyPatch(defaultRecipe(), {
      globals: { colorGrading: { shadows: { sat: 10 } } },
    });
    expect(isNeutralGrading(graded.globals.colorGrading)).toBe(false);
  });

  it("keeps optics profile ids and clamps optics sliders", () => {
    const r = applyPatch(
      defaultRecipe(),
      { globals: { optics: { profileId: "wide-zoom", distortion: -400, ca: 220, defringePurple: 30 } } },
      "absolute",
    );
    expect(r.globals.optics.profileId).toBe("wide-zoom");
    expect(r.globals.optics.distortion).toBe(-100);
    expect(r.globals.optics.ca).toBe(100);
    expect(r.globals.optics.defringePurple).toBe(30);
    expect(r.globals.optics.defringeGreen).toBe(0);
  });

  it("keeps effects midpoints when only grain changes", () => {
    const r = applyPatch(defaultRecipe(), { globals: { effects: { grainAmount: 40 } } }, "absolute");
    expect(r.globals.effects.grainAmount).toBe(40);
    expect(r.globals.effects.grainSize).toBe(50);
    expect(r.globals.effects.vignetteMidpoint).toBe(50);
    expect(r.globals.effects.vignetteAmount).toBe(0);
  });

  it("defaults optics and effects for recipes saved before they existed", () => {
    const legacy = parseRecipe({ version: 1, globals: { exposure: 0.5, lensCorrection: 40 } });
    expect(legacy.globals.optics.profileId).toBe("");
    expect(legacy.globals.effects.grainSize).toBe(50);
    expect(legacy.globals.exposure).toBe(0.5);
  });

  it("clamps the split detail controls", () => {
    const r = applyPatch(
      defaultRecipe(),
      {
        globals: {
          texture: -300,
          sharpening: 60,
          sharpenRadius: 400,
          sharpenDetail: -20,
          sharpenMasking: 40,
          noiseReduction: 30,
          noiseReductionDetail: 150,
          colorNoiseReduction: 25,
          moire: -5,
        },
      },
      "absolute",
    );
    expect(r.globals.texture).toBe(-100);
    expect(r.globals.sharpening).toBe(60);
    expect(r.globals.sharpenRadius).toBe(100);
    expect(r.globals.sharpenDetail).toBe(0);
    expect(r.globals.sharpenMasking).toBe(40);
    expect(r.globals.noiseReductionDetail).toBe(100);
    expect(r.globals.colorNoiseReduction).toBe(25);
    expect(r.globals.moire).toBe(0);
  });

  it("keeps detail params local to a mask", () => {
    const mask = createBrushMask({ id: "b1", params: { texture: -40, sharpening: 20 } });
    const r = applyPatch(defaultRecipe(), { masks: { upsert: [mask] } }, "absolute");
    expect(r.masks[0].params.texture).toBe(-40);
    expect(r.masks[0].params.sharpening).toBe(20);
    expect(r.globals.texture).toBe(0);
  });

  it("does not invent masks", () => {
    expect(applyPatch(defaultRecipe(), { globals: { exposure: 1 } }, "delta").masks).toEqual([]);
  });

  it("upserts a radial mask", () => {
    const mask = createRadialMask({ id: "r1", name: "Center", params: { exposure: 1 } });
    const r = applyPatch(defaultRecipe(), { masks: { upsert: [mask] } }, "absolute");
    expect(r.masks).toHaveLength(1);
    expect(r.masks[0].id).toBe("r1");
    expect(r.masks[0].params.exposure).toBe(1);
    expect(r.masks[0].components[0]).toMatchObject({ type: "radial", cx: 0.5, cy: 0.5 });
  });

  it("replaces mask on upsert by id", () => {
    const a = createRadialMask({ id: "r1", name: "A", params: { exposure: 0.5 } });
    const base = applyPatch(defaultRecipe(), { masks: { upsert: [a] } }, "absolute");
    const b = createRadialMask({ id: "r1", name: "B", params: { exposure: 1.5 } });
    const r = applyPatch(base, { masks: { upsert: [b] } }, "absolute");
    expect(r.masks).toHaveLength(1);
    expect(r.masks[0].name).toBe("B");
    expect(r.masks[0].params.exposure).toBe(1.5);
  });

  it("removes masks by id", () => {
    const a = createRadialMask({ id: "a" });
    const b = createRadialMask({ id: "b" });
    const base = applyPatch(defaultRecipe(), { masks: { upsert: [a, b] } }, "absolute");
    const r = applyPatch(base, { masks: { remove: ["a"] } }, "absolute");
    expect(r.masks.map((m) => m.id)).toEqual(["b"]);
  });

  it("reorders masks", () => {
    const a = createRadialMask({ id: "a" });
    const b = createRadialMask({ id: "b" });
    const c = createRadialMask({ id: "c" });
    const base = applyPatch(defaultRecipe(), { masks: { upsert: [a, b, c] } }, "absolute");
    const r = applyPatch(base, { masks: { reorder: ["c", "a", "b"] } }, "absolute");
    expect(r.masks.map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("clamps mask params and geometry", () => {
    const mask = createRadialMask({
      id: "r1",
      cx: 2,
      radiusX: 0,
      density: 500,
      feather: -10,
      params: { exposure: 99, contrast: -999 },
    });
    const r = applyPatch(defaultRecipe(), { masks: { upsert: [mask] } }, "absolute");
    const m = r.masks[0];
    expect(m.density).toBe(100);
    expect(m.feather).toBe(0);
    expect(m.params.exposure).toBe(5);
    expect(m.params.contrast).toBe(-100);
    const radial = m.components[0];
    if (radial.type !== "radial") throw new Error("expected radial");
    expect(radial.cx).toBe(1);
    expect(radial.radiusX).toBe(0.01);
  });

  it("caps mask count", () => {
    const many = Array.from({ length: MAX_MASKS + 3 }, (_, i) => createRadialMask({ id: `m${i}` }));
    const r = applyPatch(defaultRecipe(), { masks: { upsert: many } }, "absolute");
    expect(r.masks).toHaveLength(MAX_MASKS);
  });

  it("upserts brush luminance and color masks", () => {
    const brush = createBrushMask({
      id: "b1",
      strokes: [{ points: [[0.4, 0.5]], size: 20, hardness: 50, opacity: 100, erase: false }],
      params: { exposure: 0.8 },
    });
    const luma = createLuminanceMask({ id: "l1", min: 0.6, max: 1, params: { highlights: -20 } });
    const color = createColorRangeMask({ id: "c1", hue: 0.3, tolerance: 0.15, params: { exposure: 0.3 } });
    const r = applyPatch(defaultRecipe(), { masks: { upsert: [brush, luma, color] } }, "absolute");
    expect(r.masks.map((m) => m.components[0]?.type)).toEqual(["brush", "luminance_range", "color_range"]);
    expect(r.masks[0].components[0]).toMatchObject({ type: "brush" });
    if (r.masks[0].components[0].type === "brush") {
      expect(r.masks[0].components[0].strokes).toHaveLength(1);
    }
    expect(r.masks[1].params.highlights).toBe(-20);
  });
});

describe("applyCatalogPatch", () => {
  it("clamps rating", () => {
    expect(applyCatalogPatch({ rating: 0, flag: "unflagged" }, { rating: 9 }).rating).toBe(5);
  });
});

describe("clamp", () => {
  it("stays in range", () => {
    expect(clamp(3, [0, 1])).toBe(1);
    expect(clamp(-2, [0, 1])).toBe(0);
  });
});
