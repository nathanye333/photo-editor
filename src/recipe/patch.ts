import { DEFAULT_CAMERA_PROFILE } from "../render/cameraProfiles";
import type { CatalogFields, ColorLabel } from "../catalog/types";
import { normalizeCrop } from "./crop";
import { identityPoints } from "./curve";
import { defaultGlobals, defaultRecipe } from "./defaults";
import {
  CURVE_CHANNELS,
  GRADE_ZONES,
  HSL_CHANNELS,
  MAX_CURVE_POINTS,
  MAX_MASKS,
  RANGES,
  RECIPE_VERSION,
  type BrushStroke,
  type Calibration,
  type CatalogPatch,
  type ColorGrading,
  type ColorGradingPatch,
  type Crop,
  type CropPatch,
  type CurveChannels,
  type CurvePoints,
  type DevelopPatch,
  type EditRecipe,
  type Effects,
  type Globals,
  type GlobalsPatch,
  type HslAdjust,
  type Mask,
  type MaskComponent,
  type MaskMode,
  type MaskPatch,
  type Optics,
  type PatchMode,
  type ToneCurve,
} from "./types";

export function clamp(value: number, range: readonly [number, number]): number {
  return Math.min(range[1], Math.max(range[0], value));
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function applyScalar(
  current: number,
  next: number | undefined,
  mode: PatchMode,
  range: readonly [number, number],
): number {
  if (next === undefined) return clamp(current, range);
  const raw = mode === "delta" ? current + next : next;
  return clamp(raw, range);
}

function clampHsl(adj: HslAdjust): HslAdjust {
  return {
    hue: clamp(adj.hue, RANGES.hslHue),
    sat: clamp(adj.sat, RANGES.hslSat),
    lum: clamp(adj.lum, RANGES.hslLum),
  };
}

function applyHsl(
  current: Globals["hsl"],
  patch: GlobalsPatch["hsl"],
  mode: PatchMode,
): Globals["hsl"] {
  const next = { ...current };
  for (const ch of HSL_CHANNELS) {
    const p = patch?.[ch];
    const cur = current[ch];
    next[ch] = clampHsl({
      hue: applyScalar(cur.hue, p?.hue, mode, RANGES.hslHue),
      sat: applyScalar(cur.sat, p?.sat, mode, RANGES.hslSat),
      lum: applyScalar(cur.lum, p?.lum, mode, RANGES.hslLum),
    });
  }
  return next;
}

function applyCurve(
  current: ToneCurve,
  patch: GlobalsPatch["toneCurve"],
  mode: PatchMode,
): ToneCurve {
  return {
    highlights: applyScalar(current.highlights, patch?.highlights, mode, RANGES.curve),
    lights: applyScalar(current.lights, patch?.lights, mode, RANGES.curve),
    darks: applyScalar(current.darks, patch?.darks, mode, RANGES.curve),
    shadows: applyScalar(current.shadows, patch?.shadows, mode, RANGES.curve),
    channels: applyCurveChannels(current.channels, patch?.channels),
  };
}

function applyCurveChannels(
  current: CurveChannels,
  patch: Partial<CurveChannels> | undefined,
): CurveChannels {
  const next = {} as CurveChannels;
  for (const ch of CURVE_CHANNELS) {
    next[ch] = normalizePoints(patch?.[ch] ?? current?.[ch]);
  }
  return next;
}

function applyColorGrading(
  current: ColorGrading,
  patch: ColorGradingPatch | undefined,
  mode: PatchMode,
): ColorGrading {
  const next = {
    blending: applyScalar(current.blending, patch?.blending, mode, RANGES.gradeBlending),
    balance: applyScalar(current.balance, patch?.balance, mode, RANGES.gradeBalance),
  } as ColorGrading;
  for (const zone of GRADE_ZONES) {
    const cur = current[zone];
    const p = patch?.[zone];
    next[zone] = {
      // Hue is circular, so it wraps instead of clamping at the ends.
      hue: wrapHue(p?.hue === undefined ? cur.hue : mode === "delta" ? cur.hue + p.hue : p.hue),
      sat: applyScalar(cur.sat, p?.sat, mode, RANGES.gradeSat),
      lum: applyScalar(cur.lum, p?.lum, mode, RANGES.gradeLum),
    };
  }
  return next;
}

function applyCalibration(
  current: Calibration,
  patch: Partial<Calibration> | undefined,
  mode: PatchMode,
): Calibration {
  const profile = patch?.profile;
  return {
    profile: typeof profile === "string" ? profile : (current.profile ?? DEFAULT_CAMERA_PROFILE),
    shadowTint: applyScalar(current.shadowTint, patch?.shadowTint, mode, RANGES.shadowTint),
    redHue: applyScalar(current.redHue, patch?.redHue, mode, RANGES.primaryHue),
    redSat: applyScalar(current.redSat, patch?.redSat, mode, RANGES.primarySat),
    greenHue: applyScalar(current.greenHue, patch?.greenHue, mode, RANGES.primaryHue),
    greenSat: applyScalar(current.greenSat, patch?.greenSat, mode, RANGES.primarySat),
    blueHue: applyScalar(current.blueHue, patch?.blueHue, mode, RANGES.primaryHue),
    blueSat: applyScalar(current.blueSat, patch?.blueSat, mode, RANGES.primarySat),
  };
}

function applyOptics(current: Optics, patch: Partial<Optics> | undefined, mode: PatchMode): Optics {
  const profileId = patch?.profileId;
  return {
    profileId: typeof profileId === "string" ? profileId : (current.profileId ?? ""),
    distortion: applyScalar(current.distortion, patch?.distortion, mode, RANGES.distortion),
    ca: applyScalar(current.ca, patch?.ca, mode, RANGES.ca),
    defringePurple: applyScalar(current.defringePurple, patch?.defringePurple, mode, RANGES.defringe),
    defringeGreen: applyScalar(current.defringeGreen, patch?.defringeGreen, mode, RANGES.defringe),
  };
}

function applyEffects(current: Effects, patch: Partial<Effects> | undefined, mode: PatchMode): Effects {
  return {
    vignetteAmount: applyScalar(current.vignetteAmount, patch?.vignetteAmount, mode, RANGES.vignetteAmount),
    vignetteMidpoint: applyScalar(
      current.vignetteMidpoint,
      patch?.vignetteMidpoint,
      mode,
      RANGES.vignetteMidpoint,
    ),
    grainAmount: applyScalar(current.grainAmount, patch?.grainAmount, mode, RANGES.grainAmount),
    grainSize: applyScalar(current.grainSize, patch?.grainSize, mode, RANGES.grainSize),
    grainRoughness: applyScalar(current.grainRoughness, patch?.grainRoughness, mode, RANGES.grainRoughness),
  };
}

function wrapHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  return ((hue % 360) + 360) % 360;
}

export function normalizePoints(points: CurvePoints | undefined): CurvePoints {
  if (!Array.isArray(points)) return identityPoints();
  const pts = points
    .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
    .map(([x, y]) => [clamp(num(x, 0), [0, 1]), clamp(num(y, 0), [0, 1])] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_CURVE_POINTS);
  if (pts.length < 2) return identityPoints();
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 1;
  return pts;
}

function applyCrop(current: Crop, patch: CropPatch | undefined, legacyAngle: number): Crop {
  if (!patch) return current;
  const merged = { ...current, ...patch };
  if (patch.angle === undefined && patch.enabled === undefined) {
    merged.angle = legacyAngle;
  }
  return normalizeCrop(merged, legacyAngle);
}

function applyGlobals(current: Globals, patch: GlobalsPatch | undefined, mode: PatchMode): Globals {
  const g = current;
  const p = patch ?? {};
  return {
    exposure: applyScalar(g.exposure, p.exposure, mode, RANGES.exposure),
    contrast: applyScalar(g.contrast, p.contrast, mode, RANGES.contrast),
    highlights: applyScalar(g.highlights, p.highlights, mode, RANGES.highlights),
    shadows: applyScalar(g.shadows, p.shadows, mode, RANGES.shadows),
    whites: applyScalar(g.whites, p.whites, mode, RANGES.whites),
    blacks: applyScalar(g.blacks, p.blacks, mode, RANGES.blacks),
    temp: applyScalar(g.temp, p.temp, mode, RANGES.temp),
    tint: applyScalar(g.tint, p.tint, mode, RANGES.tint),
    vibrance: applyScalar(g.vibrance, p.vibrance, mode, RANGES.vibrance),
    saturation: applyScalar(g.saturation, p.saturation, mode, RANGES.saturation),
    hsl: applyHsl(g.hsl, p.hsl, mode),
    toneCurve: applyCurve(g.toneCurve, p.toneCurve, mode),
    colorGrading: applyColorGrading(
      g.colorGrading ?? defaultGlobals().colorGrading,
      p.colorGrading,
      mode,
    ),
    calibration: applyCalibration(
      g.calibration ?? defaultGlobals().calibration,
      p.calibration,
      mode,
    ),
    optics: applyOptics(g.optics ?? defaultGlobals().optics, p.optics, mode),
    effects: applyEffects(g.effects ?? defaultGlobals().effects, p.effects, mode),
    texture: applyScalar(g.texture, p.texture, mode, RANGES.texture),
    clarity: applyScalar(g.clarity, p.clarity, mode, RANGES.clarity),
    dehaze: applyScalar(g.dehaze, p.dehaze, mode, RANGES.dehaze),
    sharpening: applyScalar(g.sharpening, p.sharpening, mode, RANGES.sharpening),
    sharpenRadius: applyScalar(g.sharpenRadius, p.sharpenRadius, mode, RANGES.sharpenRadius),
    sharpenDetail: applyScalar(g.sharpenDetail, p.sharpenDetail, mode, RANGES.sharpenDetail),
    sharpenMasking: applyScalar(g.sharpenMasking, p.sharpenMasking, mode, RANGES.sharpenMasking),
    noiseReduction: applyScalar(g.noiseReduction, p.noiseReduction, mode, RANGES.noiseReduction),
    noiseReductionDetail: applyScalar(
      g.noiseReductionDetail,
      p.noiseReductionDetail,
      mode,
      RANGES.noiseReductionDetail,
    ),
    colorNoiseReduction: applyScalar(
      g.colorNoiseReduction,
      p.colorNoiseReduction,
      mode,
      RANGES.colorNoiseReduction,
    ),
    moire: applyScalar(g.moire, p.moire, mode, RANGES.moire),
    lensCorrection: applyScalar(g.lensCorrection, p.lensCorrection, mode, RANGES.lensCorrection),
    cropAngle: applyScalar(g.cropAngle, p.cropAngle, mode, RANGES.cropAngle),
  };
}

function clampMaskParams(params: Partial<Globals> | undefined): Partial<Globals> {
  if (!params || typeof params !== "object") return {};
  const patch = params as GlobalsPatch;
  const full = applyGlobals(defaultGlobals(), patch, "absolute");
  const out: Partial<Globals> = {};
  const scalars: (keyof Omit<
    Globals,
    "hsl" | "toneCurve" | "colorGrading" | "calibration" | "optics" | "effects"
  >)[] = [
    "exposure",
    "contrast",
    "highlights",
    "shadows",
    "whites",
    "blacks",
    "temp",
    "tint",
    "vibrance",
    "saturation",
    "texture",
    "clarity",
    "dehaze",
    "sharpening",
    "sharpenRadius",
    "sharpenDetail",
    "sharpenMasking",
    "noiseReduction",
    "noiseReductionDetail",
    "colorNoiseReduction",
    "moire",
    "lensCorrection",
    "cropAngle",
  ];
  for (const key of scalars) {
    if (params[key] !== undefined) out[key] = full[key];
  }
  if (patch.hsl) {
    const hsl = { ...defaultGlobals().hsl };
    for (const ch of HSL_CHANNELS) {
      if (patch.hsl[ch]) hsl[ch] = full.hsl[ch];
    }
    out.hsl = hsl;
  }
  if (patch.toneCurve) out.toneCurve = full.toneCurve;
  return out;
}

function normalizeComponent(c: MaskComponent): MaskComponent {
  if (c.type === "radial") {
    return {
      type: "radial",
      cx: clamp(num(c.cx, 0.5), RANGES.maskCoord),
      cy: clamp(num(c.cy, 0.5), RANGES.maskCoord),
      radiusX: clamp(num(c.radiusX, 0.35), RANGES.maskRadius),
      radiusY: clamp(num(c.radiusY, 0.35), RANGES.maskRadius),
      feather: clamp(num(c.feather, 50), RANGES.maskFeather),
    };
  }
  if (c.type === "linear") {
    return {
      type: "linear",
      start: [clamp(num(c.start?.[0], 0.5), RANGES.maskCoord), clamp(num(c.start?.[1], 0), RANGES.maskCoord)],
      end: [clamp(num(c.end?.[0], 0.5), RANGES.maskCoord), clamp(num(c.end?.[1], 1), RANGES.maskCoord)],
      feather: clamp(num(c.feather, 50), RANGES.maskFeather),
    };
  }
  if (c.type === "luminance_range") {
    return {
      type: "luminance_range",
      min: clamp(num(c.min, 0), [0, 1]),
      max: clamp(num(c.max, 1), [0, 1]),
      smooth: clamp(num(c.smooth, 0.1), [0, 1]),
    };
  }
  if (c.type === "color_range") {
    return {
      type: "color_range",
      hue: clamp(num(c.hue, 0), [0, 1]),
      chroma: clamp(num(c.chroma, 0.5), [0, 1]),
      tolerance: clamp(num(c.tolerance, 0.2), [0, 1]),
    };
  }
  if (c.type === "semantic") {
    return {
      type: "semantic",
      label: typeof c.label === "string" ? c.label : "subject",
      model: typeof c.model === "string" ? c.model : "default",
    };
  }
  const strokes = Array.isArray(c.strokes)
    ? c.strokes
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const stroke = s as Partial<BrushStroke>;
          const points = Array.isArray(stroke.points)
            ? stroke.points
                .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
                .map(([x, y]) => [clamp(num(x, 0), RANGES.maskCoord), clamp(num(y, 0), RANGES.maskCoord)] as [number, number])
            : [];
          if (!points.length) return null;
          return {
            points,
            size: clamp(num(stroke.size, 20), RANGES.brushSize),
            hardness: clamp(num(stroke.hardness, 50), RANGES.brushHardness),
            opacity: clamp(num(stroke.opacity, 100), RANGES.brushOpacity),
            erase: Boolean(stroke.erase),
          };
        })
        .filter((s): s is BrushStroke => s !== null)
    : [];
  return { type: "brush", strokes };
}

function normalizeMode(mode: unknown): MaskMode {
  return mode === "subtract" || mode === "intersect" ? mode : "add";
}

export function normalizeMask(raw: Mask): Mask {
  const components = Array.isArray(raw.components)
    ? raw.components.map(normalizeComponent)
    : [{ type: "radial" as const, cx: 0.5, cy: 0.5, radiusX: 0.35, radiusY: 0.35, feather: 50 }];
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `mask-${Math.random().toString(36).slice(2, 9)}`,
    name: typeof raw.name === "string" && raw.name ? raw.name : "Mask",
    mode: normalizeMode(raw.mode),
    components,
    invert: Boolean(raw.invert),
    feather: clamp(num(raw.feather, 50), RANGES.maskFeather),
    density: clamp(num(raw.density, 100), RANGES.maskDensity),
    params: clampMaskParams(raw.params),
  };
}

/** Merge mask.params overrides onto globals for a local develop pass. */
export function mergeMaskGlobals(globals: Globals, params: Partial<Globals>): Globals {
  return applyGlobals(globals, params as GlobalsPatch, "absolute");
}

function applyMasks(current: Mask[], patch: MaskPatch | undefined): Mask[] {
  if (!patch) return current.map(normalizeMask);

  let next = current.map(normalizeMask);

  if (patch.remove?.length) {
    const drop = new Set(patch.remove);
    next = next.filter((m) => !drop.has(m.id));
  }

  if (patch.upsert?.length) {
    for (const raw of patch.upsert) {
      const mask = normalizeMask(raw);
      const idx = next.findIndex((m) => m.id === mask.id);
      if (idx >= 0) next[idx] = mask;
      else next.push(mask);
    }
  }

  if (patch.reorder?.length) {
    const byId = new Map(next.map((m) => [m.id, m]));
    const ordered: Mask[] = [];
    for (const id of patch.reorder) {
      const m = byId.get(id);
      if (m) {
        ordered.push(m);
        byId.delete(id);
      }
    }
    for (const m of byId.values()) ordered.push(m);
    next = ordered;
  }

  return next.slice(0, MAX_MASKS);
}

/** Only mutation path for develop params (UI, presets, paste, undo, agent). */
export function applyPatch(
  recipe: EditRecipe,
  patch: DevelopPatch,
  mode: PatchMode = "absolute",
): EditRecipe {
  const globals = applyGlobals(recipe.globals, patch.globals, mode);
  const crop = applyCrop(recipe.crop, patch.crop, globals.cropAngle);
  if (patch.crop?.angle !== undefined) {
    globals.cropAngle = crop.angle;
  } else if (patch.globals?.cropAngle !== undefined) {
    return {
      version: recipe.version,
      globals,
      crop: applyCrop(crop, { angle: globals.cropAngle }, globals.cropAngle),
      masks: applyMasks(recipe.masks, patch.masks),
    };
  }
  return {
    version: recipe.version,
    globals,
    crop,
    masks: applyMasks(recipe.masks, patch.masks),
  };
}

export function applyCatalogPatch(current: CatalogFields, patch: CatalogPatch): CatalogFields {
  const labels: ColorLabel[] = ["red", "yellow", "green", "blue", "purple"];
  const colorLabel =
    patch.colorLabel === undefined
      ? current.colorLabel
      : patch.colorLabel === null
        ? null
        : labels.includes(patch.colorLabel as ColorLabel)
          ? (patch.colorLabel as ColorLabel)
          : current.colorLabel;
  return {
    rating: patch.rating === undefined ? current.rating : Math.round(clamp(patch.rating, RANGES.rating)),
    flag: patch.flag ?? current.flag,
    keywords: patch.keywords ?? current.keywords,
    colorLabel,
    title: patch.title ?? current.title,
    caption: patch.caption ?? current.caption,
    copyright: patch.copyright ?? current.copyright,
    creator: patch.creator ?? current.creator,
    quickCollection: patch.quickCollection ?? current.quickCollection,
  };
}

export function defaultCatalogFields(): CatalogFields {
  return {
    rating: 0,
    flag: "unflagged",
    keywords: [],
    colorLabel: null,
    title: "",
    caption: "",
    copyright: "",
    creator: "",
    quickCollection: false,
  };
}

export function parseCatalogFields(
  rating: unknown,
  flag: unknown,
  keywords?: unknown,
  colorLabel?: unknown,
  title?: unknown,
  caption?: unknown,
  copyright?: unknown,
  creator?: unknown,
  quickCollection?: unknown,
): CatalogFields {
  const labels: ColorLabel[] = ["red", "yellow", "green", "blue", "purple"];
  let parsedKeywords: string[] = [];
  if (typeof keywords === "string") {
    try {
      const raw = JSON.parse(keywords);
      if (Array.isArray(raw)) parsedKeywords = raw.filter((k): k is string => typeof k === "string");
    } catch {
      parsedKeywords = [];
    }
  } else if (Array.isArray(keywords)) {
    parsedKeywords = keywords.filter((k): k is string => typeof k === "string");
  }
  const label =
    typeof colorLabel === "string" && labels.includes(colorLabel as ColorLabel)
      ? (colorLabel as ColorLabel)
      : null;
  return applyCatalogPatch(defaultCatalogFields(), {
    rating: typeof rating === "number" ? rating : Number(rating),
    flag: flag === "pick" || flag === "reject" ? flag : "unflagged",
    keywords: parsedKeywords,
    colorLabel: label,
    title: typeof title === "string" ? title : "",
    caption: typeof caption === "string" ? caption : "",
    copyright: typeof copyright === "string" ? copyright : "",
    creator: typeof creator === "string" ? creator : "",
    quickCollection: quickCollection === 1 || quickCollection === true,
  });
}

/** v1 recipes stored a single `points` array; it becomes the composite curve. */
function migrateToneCurve(raw: unknown): ToneCurve {
  const base = defaultGlobals().toneCurve;
  if (!raw || typeof raw !== "object") return base;
  const curve = raw as Partial<ToneCurve> & { points?: CurvePoints };
  const channels = curve.channels ?? (curve.points ? { rgb: curve.points } : undefined);
  return {
    highlights: num(curve.highlights, base.highlights),
    lights: num(curve.lights, base.lights),
    darks: num(curve.darks, base.darks),
    shadows: num(curve.shadows, base.shadows),
    channels: applyCurveChannels(base.channels, channels),
  };
}

export function parseRecipe(raw: unknown): EditRecipe {
  const fallback = defaultRecipe();
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Partial<EditRecipe> & { crop?: Partial<Crop> };
  const g = obj.globals ?? defaultGlobals();
  const legacyAngle = typeof g.cropAngle === "number" ? g.cropAngle : 0;
  const base: EditRecipe = {
    version: RECIPE_VERSION,
    globals: {
      ...defaultGlobals(),
      ...g,
      hsl: { ...defaultGlobals().hsl, ...g.hsl },
      toneCurve: migrateToneCurve(g.toneCurve),
    },
    crop: normalizeCrop(obj.crop, legacyAngle),
    masks: Array.isArray(obj.masks) ? (obj.masks as Mask[]) : [],
  };
  if (base.crop.angle !== legacyAngle && !obj.crop?.angle) {
    base.crop = { ...base.crop, angle: legacyAngle };
  }
  return applyPatch(base, { globals: {} }, "absolute");
}
