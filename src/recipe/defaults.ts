import {
  HSL_CHANNELS,
  type EditRecipe,
  type Globals,
  type HslAdjust,
  RECIPE_VERSION,
} from "./types";

const zeroHsl = (): HslAdjust => ({ hue: 0, sat: 0, lum: 0 });

export function defaultGlobals(): Globals {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temp: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    hsl: Object.fromEntries(HSL_CHANNELS.map((c) => [c, zeroHsl()])) as Globals["hsl"],
    toneCurve: {
      highlights: 0,
      lights: 0,
      darks: 0,
      shadows: 0,
      points: [
        [0, 0],
        [1, 1],
      ],
    },
    clarity: 0,
    dehaze: 0,
    sharpening: 0,
    noiseReduction: 0,
    lensCorrection: 0,
    cropAngle: 0,
  };
}

export function defaultRecipe(): EditRecipe {
  return {
    version: RECIPE_VERSION,
    globals: defaultGlobals(),
    masks: [],
  };
}

export function cloneRecipe(recipe: EditRecipe): EditRecipe {
  return structuredClone(recipe);
}
