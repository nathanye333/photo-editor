import { analyzePixels, type PixelStats } from "../recipe/auto";

const LUMA = [0.2126, 0.7152, 0.0722] as const;

export type RegionStats = {
  meanLuma: number;
  mean: [number, number, number];
  clipHigh: number;
  clipLow: number;
};

export type DominantHue = {
  hue: number;
  pct: number;
  label: string;
};

export type SuggestedMask =
  | {
      kind: "linear";
      reason: string;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      params?: { exposure?: number; highlights?: number; shadows?: number };
    }
  | {
      kind: "radial";
      reason: string;
      cx: number;
      cy: number;
      radiusX: number;
      radiusY: number;
      params?: { exposure?: number; highlights?: number; shadows?: number };
    }
  | {
      kind: "luminance_range";
      reason: string;
      min: number;
      max: number;
      smooth: number;
      params?: { exposure?: number; highlights?: number; shadows?: number };
    };

export type SceneAnalysis = {
  width: number;
  height: number;
  global: PixelStats;
  regions: {
    top: RegionStats;
    mid: RegionStats;
    bottom: RegionStats;
    center: RegionStats;
    edges: RegionStats;
  };
  grid: Array<{ x: number; y: number; meanLuma: number; hue: number; chroma: number }>;
  dominantHues: DominantHue[];
  suggestedMasks: SuggestedMask[];
};

function hueLabel(hue01: number): string {
  const deg = ((hue01 % 1) + 1) % 1 * 360;
  if (deg < 20 || deg >= 340) return "red";
  if (deg < 50) return "orange";
  if (deg < 75) return "yellow";
  if (deg < 160) return "green";
  if (deg < 200) return "aqua";
  if (deg < 260) return "blue";
  if (deg < 300) return "purple";
  return "magenta";
}

function rgbToHueChroma(r: number, g: number, b: number): { hue: number; chroma: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 1e-6) return { hue: 0, chroma: 0 };
  let hue = 0;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue /= 6;
  if (hue < 0) hue += 1;
  return { hue, chroma };
}

function regionStats(
  data: ArrayLike<number>,
  width: number,
  height: number,
  pred: (x: number, y: number) => boolean,
): RegionStats {
  const bins = new Uint32Array(256);
  const sums: [number, number, number] = [0, 0, 0];
  let count = 0;
  let clipHigh = 0;
  let clipLow = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pred(x, y)) continue;
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sums[0] += r;
      sums[1] += g;
      sums[2] += b;
      const luma = Math.min(255, Math.max(0, Math.round(LUMA[0] * r + LUMA[1] * g + LUMA[2] * b)));
      bins[luma]++;
      if (luma <= 2) clipLow++;
      if (luma >= 253) clipHigh++;
      count++;
    }
  }
  if (count === 0) {
    return { meanLuma: 0, mean: [0, 0, 0], clipHigh: 0, clipLow: 0 };
  }
  const mean: [number, number, number] = [
    sums[0] / count / 255,
    sums[1] / count / 255,
    sums[2] / count / 255,
  ];
  return {
    mean,
    meanLuma: LUMA[0] * mean[0] + LUMA[1] * mean[1] + LUMA[2] * mean[2],
    clipHigh: clipHigh / count,
    clipLow: clipLow / count,
  };
}

function downsampleGrid(
  data: ArrayLike<number>,
  width: number,
  height: number,
  cells = 5,
): SceneAnalysis["grid"] {
  const grid: SceneAnalysis["grid"] = [];
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const x0 = Math.floor((gx * width) / cells);
      const x1 = Math.floor(((gx + 1) * width) / cells);
      const y0 = Math.floor((gy * height) / cells);
      const y1 = Math.floor(((gy + 1) * height) / cells);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
          n++;
        }
      }
      if (!n) continue;
      const r = sr / n / 255;
      const g = sg / n / 255;
      const b = sb / n / 255;
      const { hue, chroma } = rgbToHueChroma(r, g, b);
      grid.push({
        x: (gx + 0.5) / cells,
        y: (gy + 0.5) / cells,
        meanLuma: LUMA[0] * r + LUMA[1] * g + LUMA[2] * b,
        hue,
        chroma,
      });
    }
  }
  return grid;
}

function dominantHues(
  data: ArrayLike<number>,
  width: number,
  height: number,
  stride = 4,
): DominantHue[] {
  const bins = new Float64Array(12);
  let total = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * stride;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const { hue, chroma } = rgbToHueChroma(r, g, b);
      if (chroma < 0.08) continue;
      bins[Math.min(11, Math.floor(hue * 12))]++;
      total++;
    }
  }
  if (total === 0) return [];
  return [...bins.entries()]
    .map(([i, count]) => ({
      hue: (i + 0.5) / 12,
      pct: count / total,
      label: hueLabel((i + 0.5) / 12),
    }))
    .filter((h) => h.pct >= 0.08)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);
}

/** Sky: bright, cool/desaturated band in the top third. */
export function suggestSkyMask(
  regions: SceneAnalysis["regions"],
  global: PixelStats,
): SuggestedMask | null {
  const top = regions.top;
  const bottom = regions.bottom;
  const skyish =
    top.meanLuma > 0.45 &&
    top.meanLuma > bottom.meanLuma + 0.08 &&
    top.mean[2] >= top.mean[0] - 0.05;
  if (!skyish && !(top.clipHigh > 0.04 && top.meanLuma > global.meanLuma)) return null;
  return {
    kind: "linear",
    reason: "Likely sky / bright upper band",
    startX: 0.5,
    startY: 0,
    endX: 0.5,
    endY: 0.45,
    params: {
      exposure: top.clipHigh > 0.08 ? -0.35 : -0.2,
      highlights: top.clipHigh > 0.05 ? -25 : -10,
    },
  };
}

/** Subject: center-weighted darker/higher-contrast blob → radial. */
export function suggestSubjectMask(
  grid: SceneAnalysis["grid"],
  regions: SceneAnalysis["regions"],
): SuggestedMask | null {
  if (!grid.length) return null;
  const mean =
    grid.reduce((s, c) => s + c.meanLuma, 0) / grid.length;
  // Prefer cells that differ from mean and are nearer the center.
  let best = grid[0];
  let bestScore = -Infinity;
  for (const cell of grid) {
    const dx = cell.x - 0.5;
    const dy = cell.y - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const contrast = Math.abs(cell.meanLuma - mean);
    const centerBias = 1 - Math.min(1, dist * 1.6);
    const score = contrast * 1.4 + centerBias * 0.6 + (0.5 - Math.abs(cell.meanLuma - 0.4)) * 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  if (bestScore < 0.25) {
    // Fallback to geometric center radial when scene is flat.
    if (Math.abs(regions.center.meanLuma - regions.edges.meanLuma) < 0.05) return null;
  }
  const darker = best.meanLuma < mean;
  return {
    kind: "radial",
    reason: darker ? "Likely subject / center of interest" : "Bright center region",
    cx: best.x,
    cy: best.y,
    radiusX: 0.28,
    radiusY: 0.32,
    params: darker
      ? { exposure: 0.35, shadows: 20 }
      : { exposure: -0.15, highlights: -15 },
  };
}

export function suggestHighlightMask(global: PixelStats): SuggestedMask | null {
  if (global.clipHigh < 0.02 && global.white < 0.92) return null;
  return {
    kind: "luminance_range",
    reason: "Highlight recovery range",
    min: Math.max(0.55, global.white - 0.25),
    max: 1,
    smooth: 0.08,
    params: { highlights: -30, exposure: -0.15 },
  };
}

export function analyzeScene(image: ImageData): SceneAnalysis {
  const { width, height, data } = image;
  const global = analyzePixels(data, 4);
  const yTop = height / 3;
  const yBot = (2 * height) / 3;
  const cx0 = width * 0.25;
  const cx1 = width * 0.75;
  const cy0 = height * 0.25;
  const cy1 = height * 0.75;
  const regions = {
    top: regionStats(data, width, height, (_x, y) => y < yTop),
    mid: regionStats(data, width, height, (_x, y) => y >= yTop && y < yBot),
    bottom: regionStats(data, width, height, (_x, y) => y >= yBot),
    center: regionStats(data, width, height, (x, y) => x >= cx0 && x < cx1 && y >= cy0 && y < cy1),
    edges: regionStats(
      data,
      width,
      height,
      (x, y) => !(x >= cx0 && x < cx1 && y >= cy0 && y < cy1),
    ),
  };
  const grid = downsampleGrid(data, width, height, 5);
  const suggestedMasks: SuggestedMask[] = [];
  const sky = suggestSkyMask(regions, global);
  if (sky) suggestedMasks.push(sky);
  const subject = suggestSubjectMask(grid, regions);
  if (subject) suggestedMasks.push(subject);
  const highlights = suggestHighlightMask(global);
  if (highlights) suggestedMasks.push(highlights);

  return {
    width,
    height,
    global,
    regions,
    grid,
    dominantHues: dominantHues(data, width, height),
    suggestedMasks,
  };
}

/** Compact JSON-friendly summary for the system prompt. */
export function summarizeScene(scene: SceneAnalysis): string {
  return JSON.stringify({
    size: [scene.width, scene.height],
    global: {
      meanLuma: Number(scene.global.meanLuma.toFixed(3)),
      clipLow: Number(scene.global.clipLow.toFixed(3)),
      clipHigh: Number(scene.global.clipHigh.toFixed(3)),
      black: Number(scene.global.black.toFixed(3)),
      white: Number(scene.global.white.toFixed(3)),
    },
    regions: Object.fromEntries(
      Object.entries(scene.regions).map(([k, v]) => [
        k,
        {
          meanLuma: Number(v.meanLuma.toFixed(3)),
          clipHigh: Number(v.clipHigh.toFixed(3)),
        },
      ]),
    ),
    dominantHues: scene.dominantHues.map((h) => ({
      label: h.label,
      pct: Number(h.pct.toFixed(2)),
    })),
    suggestedMasks: scene.suggestedMasks,
  });
}
