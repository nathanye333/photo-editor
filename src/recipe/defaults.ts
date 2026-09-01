import { defaultCrop } from "./crop";
import { identityPoints } from "./curve";
import {
  HSL_CHANNELS,
  type BrushStroke,
  type EditRecipe,
  type Globals,
  type GradeWheel,
  type HslAdjust,
  type Mask,
  RECIPE_VERSION,
} from "./types";

const zeroHsl = (): HslAdjust => ({ hue: 0, sat: 0, lum: 0 });

const neutralWheel = (): GradeWheel => ({ hue: 0, sat: 0, lum: 0 });

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
      channels: {
        rgb: identityPoints(),
        red: identityPoints(),
        green: identityPoints(),
        blue: identityPoints(),
      },
    },
    colorGrading: {
      shadows: neutralWheel(),
      midtones: neutralWheel(),
      highlights: neutralWheel(),
      blending: 50,
      balance: 0,
    },
    texture: 0,
    clarity: 0,
    dehaze: 0,
    sharpening: 0,
    sharpenRadius: 0,
    sharpenDetail: 0,
    sharpenMasking: 0,
    noiseReduction: 0,
    noiseReductionDetail: 0,
    colorNoiseReduction: 0,
    moire: 0,
    optics: {
      profileId: "",
      distortion: 0,
      ca: 0,
      defringePurple: 0,
      defringeGreen: 0,
    },
    effects: {
      vignetteAmount: 0,
      vignetteMidpoint: 50,
      grainAmount: 0,
      grainSize: 50,
      grainRoughness: 50,
    },
    lensCorrection: 0,
    cropAngle: 0,
  };
}

export function defaultRecipe(): EditRecipe {
  return {
    version: RECIPE_VERSION,
    globals: defaultGlobals(),
    crop: defaultCrop(),
    masks: [],
  };
}

export function cloneRecipe(recipe: EditRecipe): EditRecipe {
  return structuredClone(recipe);
}

let maskSeq = 0;

function allocName(kind: string) {
  maskSeq += 1;
  return { seq: maskSeq, name: `${kind} ${maskSeq}`, id: `mask-${Date.now().toString(36)}-${maskSeq}` };
}

type MaskMeta = Partial<Omit<Mask, "components">>;

function baseMask(fallbackName: string, fallbackId: string, components: Mask["components"], partial?: MaskMeta): Mask {
  return {
    id: partial?.id ?? fallbackId,
    name: partial?.name ?? fallbackName,
    mode: partial?.mode ?? "add",
    components,
    invert: partial?.invert ?? false,
    feather: partial?.feather ?? 50,
    density: partial?.density ?? 100,
    params: partial?.params ?? {},
  };
}

/** Create a radial local-adjustment mask with sensible defaults. */
export function createRadialMask(
  partial?: MaskMeta & {
    cx?: number;
    cy?: number;
    radiusX?: number;
    radiusY?: number;
    componentFeather?: number;
  },
): Mask {
  const { name, id } = allocName("Radial");
  return baseMask(name, id, [
    {
      type: "radial",
      cx: partial?.cx ?? 0.5,
      cy: partial?.cy ?? 0.5,
      radiusX: partial?.radiusX ?? 0.35,
      radiusY: partial?.radiusY ?? 0.35,
      feather: partial?.componentFeather ?? 50,
    },
  ], partial);
}

/** Empty brush mask — paint strokes on the preview. */
export function createBrushMask(partial?: MaskMeta & { strokes?: BrushStroke[] }): Mask {
  const { name, id } = allocName("Brush");
  return baseMask(name, id, [{ type: "brush", strokes: partial?.strokes ?? [] }], partial);
}

/** Luminance-range mask (select by brightness). */
export function createLuminanceMask(
  partial?: MaskMeta & { min?: number; max?: number; smooth?: number },
): Mask {
  const { name, id } = allocName("Luminance");
  return baseMask(
    name,
    id,
    [
      {
        type: "luminance_range",
        min: partial?.min ?? 0.25,
        max: partial?.max ?? 0.75,
        smooth: partial?.smooth ?? 0.1,
      },
    ],
    partial,
  );
}

/** Color-range mask (select by hue/chroma). Click preview to sample. */
export function createColorRangeMask(
  partial?: MaskMeta & { hue?: number; chroma?: number; tolerance?: number },
): Mask {
  const { name, id } = allocName("Color");
  return baseMask(
    name,
    id,
    [
      {
        type: "color_range",
        hue: partial?.hue ?? 0.33,
        chroma: partial?.chroma ?? 0.45,
        tolerance: partial?.tolerance ?? 0.2,
      },
    ],
    partial,
  );
}
