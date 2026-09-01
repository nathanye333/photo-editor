/**
 * Camera colour profiles. Adobe's DCP profiles are per-sensor and cannot be
 * shipped here, so these are look-alike renderings: the same starting points a
 * photographer expects (Color, Portrait, Landscape, Neutral, Monochrome)
 * expressed as contrast, saturation and warmth offsets.
 */

export type CameraProfile = {
  id: string;
  name: string;
  contrast: number;
  saturation: number;
  /** Positive shifts the render warm. */
  warmth: number;
  mono: boolean;
};

export const CAMERA_PROFILES: CameraProfile[] = [
  { id: "color", name: "Adobe Color", contrast: 0, saturation: 0, warmth: 0, mono: false },
  { id: "portrait", name: "Adobe Portrait", contrast: -8, saturation: -7, warmth: 4, mono: false },
  { id: "landscape", name: "Adobe Landscape", contrast: 12, saturation: 15, warmth: -3, mono: false },
  { id: "neutral", name: "Adobe Neutral", contrast: -15, saturation: -12, warmth: 0, mono: false },
  { id: "mono", name: "Adobe Monochrome", contrast: 6, saturation: 0, warmth: 0, mono: true },
];

export const DEFAULT_CAMERA_PROFILE = "color";

export function cameraProfile(id: string): CameraProfile {
  return CAMERA_PROFILES.find((p) => p.id === id) ?? CAMERA_PROFILES[0];
}
