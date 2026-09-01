import type { GlobalsPatch } from "./types";

export type PixelStats = {
  /** Per-channel means, 0–1. */
  mean: [number, number, number];
  meanLuma: number;
  /** Luma at the 1st and 99th percentile. */
  black: number;
  white: number;
  /** Fraction of pixels at the very bottom / top of the range. */
  clipLow: number;
  clipHigh: number;
};

const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * Histogram-based stats over an interleaved pixel buffer. `stride` is 4 for
 * canvas ImageData and 3 for the raw RGB the decoder hands back.
 */
export function analyzePixels(data: ArrayLike<number>, stride = 4): PixelStats {
  const bins = new Uint32Array(256);
  const sums: [number, number, number] = [0, 0, 0];
  let count = 0;
  for (let i = 0; i + stride - 1 < data.length; i += stride) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sums[0] += r;
    sums[1] += g;
    sums[2] += b;
    bins[Math.min(255, Math.max(0, Math.round(LUMA[0] * r + LUMA[1] * g + LUMA[2] * b)))]++;
    count++;
  }
  if (count === 0) {
    return { mean: [0, 0, 0], meanLuma: 0, black: 0, white: 1, clipLow: 0, clipHigh: 0 };
  }
  const mean: [number, number, number] = [
    sums[0] / count / 255,
    sums[1] / count / 255,
    sums[2] / count / 255,
  ];
  return {
    mean,
    meanLuma: LUMA[0] * mean[0] + LUMA[1] * mean[1] + LUMA[2] * mean[2],
    black: percentile(bins, count, 0.01),
    white: percentile(bins, count, 0.99),
    clipLow: bins[0] / count,
    clipHigh: bins[255] / count,
  };
}

function percentile(bins: Uint32Array, count: number, fraction: number): number {
  const target = count * fraction;
  let seen = 0;
  for (let i = 0; i < bins.length; i++) {
    seen += bins[i];
    if (seen >= target) return i / 255;
  }
  return 1;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Channel gains that would neutralise a cast, expressed as temp/tint. Positive
 * temp warms and positive tint pushes green, matching the develop sliders.
 */
export function whiteBalanceFromGains(r: number, g: number, b: number): { temp: number; tint: number } {
  const safe = (v: number) => (Number.isFinite(v) && v > 1e-4 ? v : 1);
  const rg = safe(r);
  const gg = safe(g);
  const bg = safe(b);
  const temp = clamp(Math.log2(rg / bg) * 55, -100, 100);
  const tint = clamp(Math.log2(gg / Math.sqrt(rg * bg)) * 55, -100, 100);
  return { temp: Math.round(temp), tint: Math.round(tint) };
}

/** DNG AsShotNeutral holds the camera response to grey, so the gains invert it. */
export function whiteBalanceFromNeutral(neutral: [number, number, number]): {
  temp: number;
  tint: number;
} {
  const [r, g, b] = neutral;
  return whiteBalanceFromGains(1 / (r || 1), 1 / (g || 1), 1 / (b || 1));
}

/** Grey-world estimate: assume the average of the scene should be neutral. */
export function autoWhiteBalance(stats: PixelStats): { temp: number; tint: number } {
  const [r, g, b] = stats.mean;
  if (r < 1e-4 || g < 1e-4 || b < 1e-4) return { temp: 0, tint: 0 };
  const target = (r + g + b) / 3;
  return whiteBalanceFromGains(target / r, target / g, target / b);
}

const TARGET_LUMA = 0.46;

/**
 * One-click tone: centre the exposure, recover the ends of the histogram, and
 * add contrast only when the image is flat.
 */
export function autoTone(stats: PixelStats): GlobalsPatch {
  const luma = Math.max(stats.meanLuma, 0.01);
  const exposure = clamp(Math.log2(TARGET_LUMA / luma), -1.5, 1.5);
  const spread = Math.max(0, stats.white - stats.black);
  return {
    exposure: Math.round(exposure * 100) / 100,
    contrast: Math.round(clamp((0.78 - spread) * 110, -20, 40)),
    highlights: Math.round(clamp(-stats.clipHigh * 400, -60, 0)),
    shadows: Math.round(clamp(stats.clipLow * 400, 0, 60)),
    whites: Math.round(clamp((0.97 - stats.white) * 160, -40, 40)),
    blacks: Math.round(clamp((0.03 - stats.black) * 160, -40, 40)),
    ...autoWhiteBalance(stats),
  };
}
