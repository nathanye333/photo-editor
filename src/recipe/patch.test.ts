import { describe, expect, it } from "vitest";
import { defaultRecipe } from "./defaults";
import { applyCatalogPatch, applyPatch, clamp } from "./patch";

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
