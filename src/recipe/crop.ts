import { RANGES, type Crop, type CropAspect } from "./types";

export function defaultCrop(): Crop {
  return {
    enabled: false,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    angle: 0,
    aspect: "original",
  };
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function aspectRatio(aspect: CropAspect, imgW: number, imgH: number): number | null {
  if (aspect === "original") return imgW / imgH;
  if (aspect === "1:1") return 1;
  if (aspect === "4:5") return 4 / 5;
  if (aspect === "16:9") return 16 / 9;
  return null;
}

/** Fit a crop rect to an aspect ratio, keeping center. */
export function applyAspectPreset(crop: Crop, aspect: CropAspect, imgW: number, imgH: number): Crop {
  const pixelRatio = aspectRatio(aspect, imgW, imgH);
  if (!pixelRatio) return { ...crop, aspect };
  const normRatio = pixelRatio * (imgH / imgW);
  let w = crop.width;
  let h = crop.height;
  w = Math.min(1, w);
  h = w / normRatio;
  if (h > 1) {
    h = 1;
    w = h * normRatio;
  }
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;
  let x = cx - w / 2;
  let y = cy - h / 2;
  x = clamp01(Math.min(x, 1 - w));
  y = clamp01(Math.min(y, 1 - h));
  return normalizeCrop({ ...crop, enabled: true, aspect, x, y, width: w, height: h });
}

export function normalizeCrop(raw: Partial<Crop> | undefined, legacyAngle = 0): Crop {
  const base = defaultCrop();
  const c = { ...base, ...raw };
  const angle = typeof c.angle === "number" && Number.isFinite(c.angle) ? c.angle : legacyAngle;
  let x = clamp01(typeof c.x === "number" ? c.x : base.x);
  let y = clamp01(typeof c.y === "number" ? c.y : base.y);
  let width = clamp01(typeof c.width === "number" ? c.width : base.width);
  let height = clamp01(typeof c.height === "number" ? c.height : base.height);
  width = Math.max(0.02, Math.min(width, 1 - x));
  height = Math.max(0.02, Math.min(height, 1 - y));
  const aspect: CropAspect =
    c.aspect === "1:1" || c.aspect === "4:5" || c.aspect === "16:9" || c.aspect === "custom"
      ? c.aspect
      : "original";
  return {
    enabled: Boolean(c.enabled),
    x,
    y,
    width,
    height,
    angle: Math.min(RANGES.cropAngle[1], Math.max(RANGES.cropAngle[0], angle)),
    aspect,
  };
}

/** Straighten alone still needs the crop pass, so it can rotate about the frame center. */
export function cropAffectsPixels(crop: Crop): boolean {
  return crop.enabled || crop.angle !== 0;
}

/**
 * Zoom/pan that makes `crop` fill the viewport, as Lightroom does after a crop edit.
 * Returns scale 1 and no offset when the crop already fills the frame.
 */
export function cropZoom(
  crop: Crop,
  previewW: number,
  previewH: number,
  hostW: number,
  hostH: number,
  pad = 32,
): { scale: number; dx: number; dy: number } {
  const none = { scale: 1, dx: 0, dy: 0 };
  const frameW = crop.width * previewW;
  const frameH = crop.height * previewH;
  if (frameW < 1 || frameH < 1 || hostW < 1 || hostH < 1) return none;
  const scale = Math.min(8, Math.max(1, Math.min((hostW - pad) / frameW, (hostH - pad) / frameH)));
  return {
    scale,
    dx: previewW / 2 - (crop.x + crop.width / 2) * previewW,
    dy: previewH / 2 - (crop.y + crop.height / 2) * previewH,
  };
}

export function cropPixelSize(crop: Crop, imgW: number, imgH: number): { w: number; h: number } {
  if (!crop.enabled) return { w: imgW, h: imgH };
  return {
    w: Math.max(1, Math.round(crop.width * imgW)),
    h: Math.max(1, Math.round(crop.height * imgH)),
  };
}

export function cropDisplayRatio(crop: Crop, imgW: number, imgH: number): number {
  const { w, h } = cropPixelSize(crop.enabled ? crop : { ...crop, width: 1, height: 1 }, imgW, imgH);
  return w / h;
}
