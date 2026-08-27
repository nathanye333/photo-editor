import { defaultGlobals, defaultRecipe } from "./defaults";
import {
  HSL_CHANNELS,
  RANGES,
  type CatalogPatch,
  type DevelopPatch,
  type EditRecipe,
  type Flag,
  type Globals,
  type GlobalsPatch,
  type HslAdjust,
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

/** Only mutation path for develop params (UI, presets, paste, undo, agent). */
export function applyPatch(
  recipe: EditRecipe,
  patch: DevelopPatch,
  mode: PatchMode = "absolute",
): EditRecipe {
  return {
    version: recipe.version,
    globals: applyGlobals(recipe.globals, patch.globals, mode),
    masks: recipe.masks,
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
      masks: Array.isArray(obj.masks) ? obj.masks : [],
    },
    { globals: {} },
    "absolute",
  );
}

export function parseCatalogFields(rating: unknown, flag: unknown): { rating: number; flag: Flag } {
  const f: Flag = flag === "pick" || flag === "reject" ? flag : "unflagged";
  return { rating: Math.round(clamp(num(rating, 0), RANGES.rating)), flag: f };
}
