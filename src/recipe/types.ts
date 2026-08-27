/** Non-destructive edit recipe — shared source of truth for UI, preview, and agent. */

export const RECIPE_VERSION = 1 as const;

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

export type ToneCurve = {
  highlights: number;
  lights: number;
  darks: number;
  shadows: number;
  /** Control points in 0–1, sorted by x. Always includes endpoints. */
  points: Array<[number, number]>;
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
  clarity: number;
  dehaze: number;
  sharpening: number;
  noiseReduction: number;
  /** Placeholder 0–100; unused in v1 renderer. */
  lensCorrection: number;
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

export type EditRecipe = {
  version: typeof RECIPE_VERSION;
  globals: Globals;
  masks: Mask[];
};

export type PatchMode = "delta" | "absolute";

export type HslPatch = Partial<Record<HslChannel, Partial<HslAdjust>>>;

export type ToneCurvePatch = Partial<
  Omit<ToneCurve, "points"> & { points: Array<[number, number]> }
>;

export type GlobalsPatch = Partial<
  Omit<Globals, "hsl" | "toneCurve"> & {
    hsl?: HslPatch;
    toneCurve?: ToneCurvePatch;
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
  masks?: MaskPatch;
};

export type Flag = "pick" | "reject" | "unflagged";

export type CatalogPatch = {
  rating?: number;
  flag?: Flag;
};

/** Max masks applied in the v1.5 renderer. */
export const MAX_MASKS = 8;

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
  clarity: [-100, 100],
  dehaze: [-100, 100],
  sharpening: [0, 100],
  noiseReduction: [0, 100],
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
