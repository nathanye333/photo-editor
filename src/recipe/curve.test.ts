import { describe, expect, it } from "vitest";
import { curveLut, evalCurve, identityPoints, isIdentityToneCurve, toneCurveTexture } from "./curve";
import { defaultGlobals } from "./defaults";
import { applyPatch, parseRecipe } from "./patch";
import type { CurvePoints } from "./types";

const sCurve: CurvePoints = [
  [0, 0],
  [0.25, 0.15],
  [0.75, 0.85],
  [1, 1],
];

describe("evalCurve", () => {
  it("passes through the identity curve", () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(evalCurve(identityPoints(), x)).toBeCloseTo(x, 5);
    }
  });

  it("honours endpoints and control points", () => {
    expect(evalCurve(sCurve, 0)).toBe(0);
    expect(evalCurve(sCurve, 1)).toBe(1);
    expect(evalCurve(sCurve, 0.25)).toBeCloseTo(0.15, 5);
    expect(evalCurve(sCurve, 0.75)).toBeCloseTo(0.85, 5);
  });

  it("stays monotone and in range on steep curves", () => {
    const steep: CurvePoints = [
      [0, 0],
      [0.4, 0.05],
      [0.45, 0.95],
      [1, 1],
    ];
    let prev = -1;
    for (let i = 0; i <= 256; i++) {
      const y = evalCurve(steep, i / 256);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it("clamps outside the point range", () => {
    const lifted: CurvePoints = [
      [0, 0.2],
      [1, 1],
    ];
    expect(evalCurve(lifted, -1)).toBe(0.2);
    expect(evalCurve(lifted, 2)).toBe(1);
  });
});

describe("curveLut", () => {
  it("spans the full input range", () => {
    const lut = curveLut(sCurve);
    expect(lut).toHaveLength(256);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(1);
  });
});

describe("toneCurveTexture", () => {
  it("is identity RGBA for untouched curves", () => {
    const curve = defaultGlobals().toneCurve;
    expect(isIdentityToneCurve(curve)).toBe(true);
    const tex = toneCurveTexture(curve);
    expect(tex).toHaveLength(256 * 4);
    for (const i of [0, 64, 128, 255]) {
      expect(tex[i * 4]).toBe(i);
      expect(tex[i * 4 + 1]).toBe(i);
      expect(tex[i * 4 + 2]).toBe(i);
      expect(tex[i * 4 + 3]).toBe(255);
    }
  });

  it("folds the composite curve over the channel curve", () => {
    const curve = {
      ...defaultGlobals().toneCurve,
      channels: {
        rgb: sCurve,
        red: [
          [0, 0.5],
          [1, 1],
        ] as CurvePoints,
        green: identityPoints(),
        blue: identityPoints(),
      },
    };
    expect(isIdentityToneCurve(curve)).toBe(false);
    const tex = toneCurveTexture(curve);
    expect(tex[0]).toBe(Math.round(evalCurve(sCurve, 0.5) * 255));
    expect(tex[1]).toBe(0);
  });
});

describe("tone curve patches", () => {
  it("replaces points for one channel only", () => {
    const next = applyPatch(
      { version: 2, globals: defaultGlobals(), crop: parseRecipe({}).crop, masks: [] },
      { globals: { toneCurve: { channels: { red: sCurve } } } },
      "absolute",
    );
    expect(next.globals.toneCurve.channels.red).toEqual(sCurve);
    expect(next.globals.toneCurve.channels.rgb).toEqual(identityPoints());
  });

  it("sorts, clamps and pins endpoints", () => {
    const messy = [
      [0.8, 2],
      [0.2, -1],
      [0.5, 0.5],
    ] as CurvePoints;
    const next = applyPatch(parseRecipe({}), { globals: { toneCurve: { channels: { rgb: messy } } } });
    expect(next.globals.toneCurve.channels.rgb).toEqual([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]);
  });

  it("falls back to identity when given too few points", () => {
    const next = applyPatch(parseRecipe({}), {
      globals: { toneCurve: { channels: { blue: [[0.5, 0.5]] as CurvePoints } } },
    });
    expect(next.globals.toneCurve.channels.blue).toEqual(identityPoints());
  });
});

describe("parseRecipe migration", () => {
  it("moves a v1 points array onto the composite channel", () => {
    const recipe = parseRecipe({
      version: 1,
      globals: { ...defaultGlobals(), toneCurve: { highlights: 10, lights: 0, darks: 0, shadows: 0, points: sCurve } },
    });
    expect(recipe.version).toBe(2);
    expect(recipe.globals.toneCurve.channels.rgb).toEqual(sCurve);
    expect(recipe.globals.toneCurve.channels.red).toEqual(identityPoints());
    expect(recipe.globals.toneCurve.highlights).toBe(10);
  });

  it("defaults every channel when the curve is missing", () => {
    const recipe = parseRecipe({ version: 1, globals: { exposure: 1 } });
    expect(recipe.globals.exposure).toBe(1);
    expect(isIdentityToneCurve(recipe.globals.toneCurve)).toBe(true);
  });
});
