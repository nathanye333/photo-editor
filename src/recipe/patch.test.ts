import { describe, expect, it } from "vitest";
import { createBrushMask, createColorRangeMask, createLuminanceMask, createRadialMask, defaultRecipe } from "./defaults";
import { applyCatalogPatch, applyPatch, clamp } from "./patch";
import { MAX_MASKS } from "./types";

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
