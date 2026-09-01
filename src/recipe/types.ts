/** Non-destructive edit recipe — shared source of truth for UI, preview, and agent. */

export const RECIPE_VERSION = 2 as const;

export const HSL_CHANNELS = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
] as const;

export type HslChannel = (typeof HSL_CHANNELS)[number];

export type HslAdjust = {
  hue: number;
  sat: number;
  lum: number;
};

/** Control points in 0–1, sorted by x. Always includes both endpoints. */
export type CurvePoints = Array<[number, number]>;

export const CURVE_CHANNELS = ["rgb", "red", "green", "blue"] as const;

export type CurveChannel = (typeof CURVE_CHANNELS)[number];

export type CurveChannels = Record<CurveChannel, CurvePoints>;

export type ToneCurve = {
  highlights: number;
  lights: number;
  darks: number;
  shadows: number;
  /** Point curves. `rgb` is the composite, applied after the per-channel ones. */
  channels: CurveChannels;
};

/** Camera profile plus Lightroom-style primary calibration. */
export type Calibration = {
  profile: string;
  shadowTint: number;
  redHue: number;
  redSat: number;
  greenHue: number;
  greenSat: number;
  blueHue: number;
  blueSat: number;
};

export type Optics = {
  /** Lens profile id, or "" for none. Auto-matched from EXIF on import. */
  profileId: string;
  /** Manual distortion correction on top of the profile. */
  distortion: number;
  /** Lateral chromatic aberration removal. */
  ca: number;
  defringePurple: number;
  defringeGreen: number;
};

export type Effects = {
  /** Negative darkens the corners, positive brightens, as in Lightroom. */
  vignetteAmount: number;
  vignetteMidpoint: number;
  grainAmount: number;
  grainSize: number;
  grainRoughness: number;
};

export const GRADE_ZONES = ["shadows", "midtones", "highlights"] as const;

export type GradeZone = (typeof GRADE_ZONES)[number];

/** One colour-grading wheel: hue in degrees, saturation 0–100, luminance -100–100. */
export type GradeWheel = {
  hue: number;
  sat: number;
  lum: number;
};

export type ColorGrading = Record<GradeZone, GradeWheel> & {
  /** Zone overlap, 0 = hard split, 100 = wide crossfade. */
  blending: number;
  /** Shifts the shadow/highlight split point. */
  balance: number;
};

export type CropAspect = "original" | "1:1" | "4:5" | "16:9" | "custom";

/** Normalized crop on source image (origin top-left). Applied in preview + export. */
export type Crop = {
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Straighten angle in degrees. */
  angle: number;
  aspect: CropAspect;
};

export type Globals = {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temp: number;
  tint: number;
  vibrance: number;
  saturation: number;
  hsl: Record<HslChannel, HslAdjust>;
  toneCurve: ToneCurve;
  colorGrading: ColorGrading;
  texture: number;
  clarity: number;
  dehaze: number;
  sharpening: number;
  sharpenRadius: number;
  sharpenDetail: number;
  sharpenMasking: number;
  noiseReduction: number;
  noiseReductionDetail: number;
  colorNoiseReduction: number;
  moire: number;
  calibration: Calibration;
  optics: Optics;
  effects: Effects;
  /** @deprecated Superseded by the optics group — kept for legacy recipes. */
  lensCorrection: number;
  /** @deprecated Use recipe.crop.angle — kept for legacy recipes. */
  cropAngle: number;
};

export type MaskMode = "add" | "subtract" | "intersect";

/** Brush stroke in normalized image UVs (origin top-left). size = % of shorter edge. */
export type BrushStroke = {
  points: Array<[number, number]>;
  size: number;
  hardness: number;
  opacity: number;
  erase: boolean;
};

/** Local adjustments. Radial, brush, luminance range, and color range are rendered. */
export type MaskComponent =
  | { type: "semantic"; label: string; model: string }
  | {
      type: "linear";
      start: [number, number];
      end: [number, number];
      feather: number;
    }
  | {
      type: "radial";
      cx: number;
      cy: number;
      radiusX: number;
      radiusY: number;
      feather: number;
    }
  | { type: "luminance_range"; min: number; max: number; smooth: number }
  | { type: "color_range"; hue: number; chroma: number; tolerance: number }
  | { type: "brush"; strokes: BrushStroke[] };

export type Mask = {
  id: string;
  name: string;
  mode: MaskMode;
  components: MaskComponent[];
  invert: boolean;
  feather: number;
  density: number;
  params: Partial<Globals>;
};

export type CropPatch = Partial<Crop>;

export type EditRecipe = {
  version: typeof RECIPE_VERSION;
  globals: Globals;
  crop: Crop;
  masks: Mask[];
};

export type PatchMode = "delta" | "absolute";

export type HslPatch = Partial<Record<HslChannel, Partial<HslAdjust>>>;

export type ToneCurvePatch = Partial<
  Omit<ToneCurve, "channels"> & { channels: Partial<CurveChannels> }
>;

export type ColorGradingPatch = Partial<
  Record<GradeZone, Partial<GradeWheel>> & { blending: number; balance: number }
>;

export type GlobalsPatch = Partial<
  Omit<Globals, "hsl" | "toneCurve" | "colorGrading" | "calibration" | "optics" | "effects"> & {
    hsl?: HslPatch;
    toneCurve?: ToneCurvePatch;
    colorGrading?: ColorGradingPatch;
    calibration?: Partial<Calibration>;
    optics?: Partial<Optics>;
    effects?: Partial<Effects>;
  }
>;

export type MaskPatch = {
  /** Replace-or-insert by id. */
  upsert?: Mask[];
  /** Ids to delete. */
  remove?: string[];
  /** Full id order when present. */
  reorder?: string[];
};

export type DevelopPatch = {
  globals?: GlobalsPatch;
  crop?: CropPatch;
  masks?: MaskPatch;
};

export type Flag = "pick" | "reject" | "unflagged";

export type CatalogPatch = {
  rating?: number;
  flag?: Flag;
};

/** Max masks applied in the v1.5 renderer. */
export const MAX_MASKS = 8;

/** Max control points per point curve. */
export const MAX_CURVE_POINTS = 16;

export const RANGES = {
  exposure: [-5, 5],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  temp: [-100, 100],
  tint: [-100, 100],
  vibrance: [-100, 100],
  saturation: [-100, 100],
  hslHue: [-100, 100],
  hslSat: [-100, 100],
  hslLum: [-100, 100],
  curve: [-100, 100],
  gradeHue: [0, 360],
  gradeSat: [0, 100],
  gradeLum: [-100, 100],
  gradeBlending: [0, 100],
  gradeBalance: [-100, 100],
  texture: [-100, 100],
  clarity: [-100, 100],
  dehaze: [-100, 100],
  sharpening: [0, 100],
  sharpenRadius: [0, 100],
  sharpenDetail: [0, 100],
  sharpenMasking: [0, 100],
  noiseReduction: [0, 100],
  noiseReductionDetail: [0, 100],
  colorNoiseReduction: [0, 100],
  moire: [0, 100],
  shadowTint: [-100, 100],
  primaryHue: [-100, 100],
  primarySat: [-100, 100],
  distortion: [-100, 100],
  ca: [0, 100],
  defringe: [0, 100],
  vignetteAmount: [-100, 100],
  vignetteMidpoint: [0, 100],
  grainAmount: [0, 100],
  grainSize: [0, 100],
  grainRoughness: [0, 100],
  lensCorrection: [0, 100],
  cropAngle: [-45, 45],
  rating: [0, 5],
  maskFeather: [0, 100],
  maskDensity: [0, 100],
  maskCoord: [0, 1],
  maskRadius: [0.01, 1],
  brushSize: [1, 100],
  brushHardness: [0, 100],
  brushOpacity: [1, 100],
  rangeUnit: [0, 1],
} as const;

/** True when only the camera profile is in play, so the shader can skip the stage. */
export function isNeutralCalibration(cal: Calibration): boolean {
  return (
    cal.shadowTint === 0 &&
    cal.redHue === 0 &&
    cal.redSat === 0 &&
    cal.greenHue === 0 &&
    cal.greenSat === 0 &&
    cal.blueHue === 0 &&
    cal.blueSat === 0
  );
}

/** Blending and balance alone do nothing while every wheel is neutral. */
export function isNeutralGrading(grading: ColorGrading): boolean {
  return GRADE_ZONES.every((zone) => grading[zone].sat === 0 && grading[zone].lum === 0);
}

export function primaryComponent(mask: Mask): MaskComponent | null {
  return mask.components[0] ?? null;
}

export function maskKindLabel(mask: Mask): string {
  const c = primaryComponent(mask);
  if (!c) return "Mask";
  if (c.type === "brush") return "Brush";
  if (c.type === "luminance_range") return "Luminance";
  if (c.type === "color_range") return "Color";
  if (c.type === "radial") return "Radial";
  if (c.type === "linear") return "Linear";
  return "Mask";
}
