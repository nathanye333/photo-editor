export type ToolCategory =
  | "tone"
  | "color"
  | "detail"
  | "optics"
  | "catalog"
  | "presets"
  | "masks"
  | "geometry";

const KEYWORDS: Record<ToolCategory, string[]> = {
  tone: [
    "exposure",
    "bright",
    "dark",
    "shadow",
    "highlight",
    "contrast",
    "white",
    "black",
    "stop",
    "lift",
    "crush",
    "auto",
    "fix this",
    "curve",
    "fade",
    "matte",
  ],
  color: [
    "warm",
    "cool",
    "temp",
    "tint",
    "white balance",
    "vibrance",
    "saturation",
    "hsl",
    "hue",
    "orange",
    "skin",
    "color",
    "calibration",
    "profile",
    "monochrome",
    "black and white",
    "split tone",
    "grade",
    "grading",
    "teal",
    "cinematic",
  ],
  detail: [
    "sharp",
    "noise",
    "clarity",
    "texture",
    "dehaze",
    "haze",
    "midtone contrast",
    "smooth",
    "smooth skin",
    "moire",
    "moiré",
  ],
  optics: [
    "lens",
    "profile",
    "distortion",
    "barrel",
    "chromatic",
    "fringe",
    "fringing",
    "corner",
    "vignette",
    "grain",
    "film look",
  ],
  catalog: ["star", "rate", "flag", "pick", "reject", "cull", "rating"],
  presets: ["preset", "reset", "copy settings", "paste", "undo look"],
  masks: [
    "mask",
    "radial",
    "brush",
    "paint",
    "local",
    "dodge",
    "burn",
    "subject",
    "center",
    "vignette",
    "region",
    "area",
    "linear",
    "gradient",
    "luminance",
    "luma",
    "color range",
    "select",
  ],
  geometry: ["crop", "straighten", "rotate", "aspect", "4:5", "16:9", "square", "frame", "composition"],
};

export const CATEGORY_DOCS: Record<ToolCategory, string> = {
  tone:
    "Tone: exposure (EV), contrast, highlights, shadows, whites, blacks, and parametric toneCurve via apply_develop_patch deltas. auto_tone sets a whole tone starting point from the image itself. For an S-curve, a matte fade, or a per-channel cast use set_tone_curve_points (channel rgb|red|green|blue).",
  color:
    "Color: temp/tint (-100..100), vibrance, saturation, hsl.{red,orange,yellow,green,aqua,blue,purple,magenta}.{hue,sat,lum}. For split toning or a cinematic look use apply_color_grading (shadows/midtones/highlights wheels with hue 0-360, sat 0-100, lum -100..100, plus blending and balance). set_camera_profile switches the base rendering (color/portrait/landscape/neutral/mono) and calibration.{shadowTint,red|green|blueHue,red|green|blueSat} tweaks the primaries.",
  detail:
    "Detail/presence: texture (fine), clarity (mid), dehaze; sharpening with sharpenRadius/sharpenDetail/sharpenMasking; noiseReduction (luminance) with noiseReductionDetail, plus colorNoiseReduction and moire. Raise sharpenMasking to keep sharpening off skin; negative texture smooths it.",
  optics:
    "Optics/effects: set_lens_profile picks a built-in lens profile; apply_develop_patch carries optics.{distortion,ca,defringePurple,defringeGreen} and effects.{vignetteAmount,vignetteMidpoint,grainAmount,grainSize,grainRoughness}. Negative vignetteAmount darkens the corners.",
  catalog: "Catalog: apply_catalog_patch with rating 0-5 and flag pick|reject|unflagged.",
  presets: "Presets: apply_preset by name, reset_recipe, copy_settings.",
  masks:
    "Masks: upsert_brush_mask (paint stamps), upsert_color_mask (hue/chroma), upsert_luminance_mask (brightness range), upsert_mask (radial), upsert_linear_mask (gradient line), remove_mask. Prefer brush/color/luma for selecting areas.",
  geometry:
    "Geometry: apply_crop_patch with enabled, normalized x/y/width/height, angle (-45..45), aspect original|1:1|4:5|16:9|custom.",
};

export function routeCategories(instruction: string): ToolCategory[] {
  const text = instruction.toLowerCase();
  const scores = (Object.keys(KEYWORDS) as ToolCategory[]).map((cat) => {
    const hits = KEYWORDS[cat].filter((k) => text.includes(k)).length;
    return { cat, hits };
  });
  scores.sort((a, b) => b.hits - a.hits);
  const picked = scores.filter((s) => s.hits > 0).slice(0, 2);
  if (picked.length === 0) return ["tone", "color"];
  return picked.map((s) => s.cat);
}
