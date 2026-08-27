import { defaultGlobals, defaultRecipe } from "./defaults";
import {
  HSL_CHANNELS,
  MAX_MASKS,
  RANGES,
  type CatalogPatch,
  type DevelopPatch,
  type EditRecipe,
  type Flag,
  type Globals,
  type GlobalsPatch,
  type HslAdjust,
  type Mask,
  type MaskComponent,
  type MaskMode,
  type MaskPatch,
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
  if (!patch) {
    return {
      highlights: clamp(current.highlights, RANGES.curve),
      lights: clamp(current.lights, RANGES.curve),
      darks: clamp(current.darks, RANGES.curve),
      shadows: clamp(current.shadows, RANGES.curve),
      points: normalizePoints(current.points),
    };
  }
  return {
    highlights: applyScalar(current.highlights, patch.highlights, mode, RANGES.curve),
    lights: applyScalar(current.lights, patch.lights, mode, RANGES.curve),
    darks: applyScalar(current.darks, patch.darks, mode, RANGES.curve),
    shadows: applyScalar(current.shadows, patch.shadows, mode, RANGES.curve),
    points: normalizePoints(patch.points ?? current.points),
  };
}

function normalizePoints(points: Array<[number, number]>): Array<[number, number]> {
  const pts = points
    .map(([x, y]) => [clamp(x, [0, 1]), clamp(y, [0, 1])] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) {
    return [
      [0, 0],
      [1, 1],
    ];
  }
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 1;
  return pts;
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
    clarity: applyScalar(g.clarity, p.clarity, mode, RANGES.clarity),
    dehaze: applyScalar(g.dehaze, p.dehaze, mode, RANGES.dehaze),
    sharpening: applyScalar(g.sharpening, p.sharpening, mode, RANGES.sharpening),
    noiseReduction: applyScalar(g.noiseReduction, p.noiseReduction, mode, RANGES.noiseReduction),
    lensCorrection: applyScalar(g.lensCorrection, p.lensCorrection, mode, RANGES.lensCorrection),
    cropAngle: applyScalar(g.cropAngle, p.cropAngle, mode, RANGES.cropAngle),
  };
}

function clampMaskParams(params: Partial<Globals> | undefined): Partial<Globals> {
  if (!params || typeof params !== "object") return {};
  const patch = params as GlobalsPatch;
  const full = applyGlobals(defaultGlobals(), patch, "absolute");
  const out: Partial<Globals> = {};
  const scalars: (keyof Omit<Globals, "hsl" | "toneCurve">)[] = [
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
    "clarity",
    "dehaze",
    "sharpening",
    "noiseReduction",
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
  return { type: "brush", strokes: Array.isArray(c.strokes) ? c.strokes : [] };
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
  return {
    version: recipe.version,
    globals: applyGlobals(recipe.globals, patch.globals, mode),
    masks: applyMasks(recipe.masks, patch.masks),
  };
}

export function applyCatalogPatch(
  current: { rating: number; flag: Flag },
  patch: CatalogPatch,
): { rating: number; flag: Flag } {
  return {
    rating: patch.rating === undefined ? current.rating : Math.round(clamp(patch.rating, RANGES.rating)),
    flag: patch.flag ?? current.flag,
  };
}

export function parseRecipe(raw: unknown): EditRecipe {
  const fallback = defaultRecipe();
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Partial<EditRecipe>;
  const g = obj.globals ?? defaultGlobals();
  return applyPatch(
    {
      version: 1,
      globals: { ...defaultGlobals(), ...g, hsl: { ...defaultGlobals().hsl, ...g.hsl } },
      masks: Array.isArray(obj.masks) ? (obj.masks as Mask[]) : [],
    },
    { globals: {} },
    "absolute",
  );
}

export function parseCatalogFields(rating: unknown, flag: unknown): { rating: number; flag: Flag } {
  const f: Flag = flag === "pick" || flag === "reject" ? flag : "unflagged";
  return { rating: Math.round(clamp(num(rating, 0), RANGES.rating)), flag: f };
}
