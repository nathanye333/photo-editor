/**
 * Built-in lens profiles. Adobe's LCP files cannot be redistributed, so these
 * are generic corrections keyed by lens name and focal length: enough to take
 * the edge off barrel/pincushion distortion, corner falloff and lateral CA.
 */

export type LensProfile = {
  id: string;
  name: string;
  /** Lowercase substrings matched against Make/Model/LensModel. */
  match: string[];
  /** Focal length window (mm) used when no name matches. */
  focal?: [number, number];
  /** Radial distortion correction, -100..100 in slider units. */
  distortion: number;
  /** Corner brightening applied to cancel profile vignetting, 0..100. */
  vignette: number;
  /** Lateral chromatic aberration correction, 0..100. */
  ca: number;
};

export const LENS_PROFILES: LensProfile[] = [
  {
    id: "ultrawide",
    name: "Generic ultra-wide (≤20mm)",
    match: ["10-20", "11-24", "12-24", "14mm", "16-35", "rokinon 14"],
    focal: [0, 20],
    distortion: 34,
    vignette: 46,
    ca: 30,
  },
  {
    id: "wide-zoom",
    name: "Generic wide zoom (20–35mm)",
    match: ["17-40", "18-55", "24-70", "24-105", "28-70"],
    focal: [20, 35],
    distortion: 18,
    vignette: 32,
    ca: 20,
  },
  {
    id: "standard-prime",
    name: "Generic standard prime (35–60mm)",
    match: ["35mm", "40mm", "50mm", "nifty"],
    focal: [35, 60],
    distortion: 6,
    vignette: 24,
    ca: 12,
  },
  {
    id: "portrait-prime",
    name: "Generic portrait prime (60–135mm)",
    match: ["85mm", "90mm", "105mm", "135mm"],
    focal: [60, 135],
    distortion: -6,
    vignette: 20,
    ca: 10,
  },
  {
    id: "telephoto",
    name: "Generic telephoto (>135mm)",
    match: ["70-200", "100-400", "150-600", "200mm", "300mm"],
    focal: [135, 10000],
    distortion: -12,
    vignette: 16,
    ca: 16,
  },
  {
    id: "phone",
    name: "Phone camera",
    match: ["iphone", "pixel", "galaxy", "xperia"],
    distortion: 12,
    vignette: 18,
    ca: 8,
  },
];

export const NO_PROFILE = "";

export function lensProfile(id: string): LensProfile | null {
  return LENS_PROFILES.find((p) => p.id === id) ?? null;
}

function focalMm(exif: Record<string, string>): number | null {
  const raw = exif.FocalLength;
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/** Name match wins over focal length, so a known lens beats the generic bucket. */
export function matchLensProfile(exif: Record<string, string>): LensProfile | null {
  const haystack = [exif.Make, exif.Model, exif.LensModel]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack) {
    const named = LENS_PROFILES.find((p) => p.match.some((m) => haystack.includes(m)));
    if (named) return named;
  }
  const focal = focalMm(exif);
  if (focal === null) return null;
  return LENS_PROFILES.find((p) => p.focal && focal >= p.focal[0] && focal < p.focal[1]) ?? null;
}
