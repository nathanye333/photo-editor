import type { CurvePoints, ToneCurve } from "./types";

export const LUT_SIZE = 256;

export function identityPoints(): CurvePoints {
  return [
    [0, 0],
    [1, 1],
  ];
}

export function isIdentityCurve(points: CurvePoints): boolean {
  return (
    points.length === 2 &&
    points[0][0] === 0 &&
    points[0][1] === 0 &&
    points[1][0] === 1 &&
    points[1][1] === 1
  );
}

export function isIdentityToneCurve(curve: ToneCurve): boolean {
  return (
    isIdentityCurve(curve.channels.rgb) &&
    isIdentityCurve(curve.channels.red) &&
    isIdentityCurve(curve.channels.green) &&
    isIdentityCurve(curve.channels.blue)
  );
}

/**
 * Monotone cubic Hermite (Fritsch–Carlson). Plain cubic splines overshoot on
 * steep control points, which reads as tone reversal in the highlights.
 */
export function evalCurve(points: CurvePoints, x: number): number {
  const n = points.length;
  if (n === 0) return clamp01(x);
  if (n === 1) return clamp01(points[0][1]);
  if (x <= points[0][0]) return clamp01(points[0][1]);
  if (x >= points[n - 1][0]) return clamp01(points[n - 1][1]);

  let i = 0;
  while (i < n - 2 && x > points[i + 1][0]) i++;

  const [x0, y0] = points[i];
  const [x1, y1] = points[i + 1];
  const h = x1 - x0;
  if (h <= 0) return clamp01(y1);

  const slopes = secantSlopes(points);
  const tangents = monotoneTangents(points, slopes);
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return clamp01(h00 * y0 + h10 * h * tangents[i] + h01 * y1 + h11 * h * tangents[i + 1]);
}

function secantSlopes(points: CurvePoints): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    out.push(dx > 0 ? (points[i + 1][1] - points[i][1]) / dx : 0);
  }
  return out;
}

function monotoneTangents(points: CurvePoints, slopes: number[]): number[] {
  const n = points.length;
  const m: number[] = new Array(n);
  m[0] = slopes[0];
  m[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slopes[i];
    const b = m[i + 1] / slopes[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * slopes[i];
      m[i + 1] = tau * b * slopes[i];
    }
  }
  return m;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function curveLut(points: CurvePoints, size = LUT_SIZE): Float32Array {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = evalCurve(points, i / (size - 1));
  return out;
}

/**
 * RGBA lookup table sampled per colour channel in the shader. Each entry folds
 * the channel curve and the composite curve together: rgb(channel(v)).
 */
export function toneCurveTexture(curve: ToneCurve, size = LUT_SIZE): Uint8Array {
  const data = new Uint8Array(size * 4);
  const channels = [curve.channels.red, curve.channels.green, curve.channels.blue];
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    for (let c = 0; c < 3; c++) {
      const v = evalCurve(curve.channels.rgb, evalCurve(channels[c], x));
      data[i * 4 + c] = Math.round(v * 255);
    }
    data[i * 4 + 3] = 255;
  }
  return data;
}
