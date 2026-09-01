import { tool } from "ai";
import { z } from "zod";
import {
  createBrushMask,
  createColorRangeMask,
  createLuminanceMask,
  createRadialMask,
} from "../recipe/defaults";
import {
  primaryComponent,
  type CatalogPatch,
  type CurvePoints,
  type DevelopPatch,
  type EditRecipe,
  type Flag,
  type Mask,
  type PatchMode,
} from "../recipe/types";

const hslChannel = z.object({
  hue: z.number().optional(),
  sat: z.number().optional(),
  lum: z.number().optional(),
});

const hslPatch = z.object({
  red: hslChannel.optional(),
  orange: hslChannel.optional(),
  yellow: hslChannel.optional(),
  green: hslChannel.optional(),
  aqua: hslChannel.optional(),
  blue: hslChannel.optional(),
  purple: hslChannel.optional(),
  magenta: hslChannel.optional(),
});

const gradeWheel = z.object({
  hue: z.number().min(0).max(360).optional(),
  sat: z.number().min(0).max(100).optional(),
  lum: z.number().min(-100).max(100).optional(),
});

const maskParamsSchema = z.object({
  exposure: z.number().optional(),
  contrast: z.number().optional(),
  highlights: z.number().optional(),
  shadows: z.number().optional(),
  whites: z.number().optional(),
  blacks: z.number().optional(),
  temp: z.number().optional(),
  tint: z.number().optional(),
  vibrance: z.number().optional(),
  saturation: z.number().optional(),
  texture: z.number().optional(),
  clarity: z.number().optional(),
  dehaze: z.number().optional(),
});

function summarizeMasks(masks: Mask[]) {
  return masks.map((m) => ({
    id: m.id,
    name: m.name,
    kind: primaryComponent(m)?.type ?? "unknown",
    invert: m.invert,
    density: m.density,
    params: m.params,
    component: primaryComponent(m),
  }));
}

export type AgentActions = {
  getRecipe: () => EditRecipe;
  /** Defaults to delta so tone tools stay iterative; absolute for set-value tools. */
  patchDevelop: (patch: DevelopPatch, mode?: PatchMode) => EditRecipe;
  patchCatalog: (patch: CatalogPatch) => { rating: number; flag: Flag };
  applyPreset: (name: string) => string;
  copySettings: () => void;
  resetRecipe: () => EditRecipe;
};

export function createAgentTools(actions: AgentActions) {
  return {
    apply_develop_patch: tool({
      description:
        "Apply relative deltas to global develop params (already stored as absolute values). Prefer small iterative deltas. Do not send pixels. For local adjustments use upsert_mask / upsert_luminance_mask / upsert_color_mask / upsert_brush_mask / remove_mask.",
      inputSchema: z.object({
        exposure: z.number().optional().describe("EV delta, typically ±0.1 to ±1"),
        contrast: z.number().optional(),
        highlights: z.number().optional(),
        shadows: z.number().optional(),
        whites: z.number().optional(),
        blacks: z.number().optional(),
        temp: z.number().optional().describe("Positive warms, negative cools"),
        tint: z.number().optional(),
        vibrance: z.number().optional(),
        saturation: z.number().optional(),
        texture: z.number().optional().describe("Fine detail; positive crisps skin/foliage, negative smooths"),
        clarity: z.number().optional().describe("Mid-frequency local contrast"),
        dehaze: z.number().optional(),
        sharpening: z.number().optional().describe("Sharpening amount 0-100"),
        sharpenRadius: z.number().optional(),
        sharpenDetail: z.number().optional(),
        sharpenMasking: z.number().optional().describe("Restricts sharpening to edges; raise for skin"),
        noiseReduction: z.number().optional().describe("Luminance noise reduction 0-100"),
        noiseReductionDetail: z.number().optional().describe("Restores fine structure lost to luminance NR"),
        colorNoiseReduction: z.number().optional(),
        moire: z.number().optional(),
        hsl: hslPatch.optional(),
        toneCurve: z
          .object({
            highlights: z.number().optional(),
            lights: z.number().optional(),
            darks: z.number().optional(),
            shadows: z.number().optional(),
          })
          .optional(),
      }),
      execute: async (input) => {
        const recipe = actions.patchDevelop({ globals: input });
        return { ok: true, globals: recipe.globals };
      },
    }),
    apply_color_grading: tool({
      description:
        "Tint the shadows, midtones and highlights independently (split toning). hue is 0-360 degrees, sat 0-100, lum -100..100. blending widens the overlap between zones, balance shifts the shadow/highlight split. Values are absolute, not deltas. Classic teal-and-orange is shadows hue ~200 and highlights hue ~35.",
      inputSchema: z.object({
        shadows: gradeWheel.optional(),
        midtones: gradeWheel.optional(),
        highlights: gradeWheel.optional(),
        blending: z.number().min(0).max(100).optional(),
        balance: z.number().min(-100).max(100).optional(),
      }),
      execute: async (input) => {
        const recipe = actions.patchDevelop({ globals: { colorGrading: input } }, "absolute");
        return { ok: true, colorGrading: recipe.globals.colorGrading };
      },
    }),
    set_tone_curve_points: tool({
      description:
        "Replace the point curve for one channel. Points are [input, output] pairs in 0–1 (origin bottom-left); include both endpoints. Use rgb for a composite S-curve or fade, red/green/blue for colour casts.",
      inputSchema: z.object({
        channel: z.enum(["rgb", "red", "green", "blue"]),
        points: z
          .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
          .min(2)
          .max(16),
      }),
      execute: async ({ channel, points }) => {
        const recipe = actions.patchDevelop(
          { globals: { toneCurve: { channels: { [channel]: points as CurvePoints } } } },
          "absolute",
        );
        return { ok: true, channels: recipe.globals.toneCurve.channels };
      },
    }),
    upsert_mask: tool({
      description:
        "Create or update a radial (oval falloff) local-adjustment mask. Prefer upsert_brush_mask / upsert_color_mask / upsert_luminance_mask for paint or select-by-color/brightness.",
      inputSchema: z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        cx: z.number().min(0).max(1).optional(),
        cy: z.number().min(0).max(1).optional(),
        radiusX: z.number().min(0.01).max(1).optional(),
        radiusY: z.number().min(0.01).max(1).optional(),
        feather: z.number().min(0).max(100).optional(),
        density: z.number().min(0).max(100).optional(),
        invert: z.boolean().optional(),
        params: maskParamsSchema.optional(),
      }),
      execute: async (input) => {
        const current = input.id
          ? actions.getRecipe().masks.find((m) => m.id === input.id)
          : undefined;
        const prevRadial = current?.components.find((c) => c.type === "radial");
        const mask = createRadialMask({
          id: input.id ?? current?.id,
          name: input.name ?? current?.name,
          cx: input.cx ?? (prevRadial?.type === "radial" ? prevRadial.cx : undefined),
          cy: input.cy ?? (prevRadial?.type === "radial" ? prevRadial.cy : undefined),
          radiusX: input.radiusX ?? (prevRadial?.type === "radial" ? prevRadial.radiusX : undefined),
          radiusY: input.radiusY ?? (prevRadial?.type === "radial" ? prevRadial.radiusY : undefined),
          feather: input.feather ?? current?.feather,
          density: input.density ?? current?.density,
          invert: input.invert ?? current?.invert,
          params: { ...(current?.params ?? {}), ...(input.params ?? {}) },
        });
        const recipe = actions.patchDevelop({ masks: { upsert: [mask] } });
        return { ok: true, maskId: mask.id, masks: summarizeMasks(recipe.masks) };
      },
    }),
    upsert_brush_mask: tool({
      description:
        "Create or update a brush mask. Optional stamp points (normalized 0–1 UV, origin top-left) paint coverage; users can refine by painting in the UI.",
      inputSchema: z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        density: z.number().min(0).max(100).optional(),
        invert: z.boolean().optional(),
        params: maskParamsSchema.optional(),
        stamps: z
          .array(
            z.object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              size: z.number().min(1).max(100).optional(),
            }),
          )
          .optional(),
      }),
      execute: async (input) => {
        const current = input.id
          ? actions.getRecipe().masks.find((m) => m.id === input.id)
          : undefined;
        const prev = current?.components.find((c) => c.type === "brush");
        const stamps = (input.stamps ?? []).map((s) => ({
          points: [[s.x, s.y] as [number, number]],
          size: s.size ?? 25,
          hardness: 60,
          opacity: 100,
          erase: false,
        }));
        const mask = createBrushMask({
          id: input.id ?? current?.id,
          name: input.name ?? current?.name,
          density: input.density ?? current?.density,
          invert: input.invert ?? current?.invert,
          params: { ...(current?.params ?? {}), ...(input.params ?? {}) },
          strokes: stamps.length ? stamps : prev?.type === "brush" ? prev.strokes : [],
        });
        const recipe = actions.patchDevelop({ masks: { upsert: [mask] } });
        return { ok: true, maskId: mask.id, masks: summarizeMasks(recipe.masks) };
      },
    }),
    upsert_luminance_mask: tool({
      description:
        "Create or update a luminance-range mask (select by brightness). min/max/smooth are 0–1.",
      inputSchema: z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        min: z.number().min(0).max(1).optional(),
        max: z.number().min(0).max(1).optional(),
        smooth: z.number().min(0).max(1).optional(),
        density: z.number().min(0).max(100).optional(),
        invert: z.boolean().optional(),
        params: maskParamsSchema.optional(),
      }),
      execute: async (input) => {
        const current = input.id
          ? actions.getRecipe().masks.find((m) => m.id === input.id)
          : undefined;
        const prev = current?.components.find((c) => c.type === "luminance_range");
        const mask = createLuminanceMask({
          id: input.id ?? current?.id,
          name: input.name ?? current?.name,
          min: input.min ?? (prev?.type === "luminance_range" ? prev.min : undefined),
          max: input.max ?? (prev?.type === "luminance_range" ? prev.max : undefined),
          smooth: input.smooth ?? (prev?.type === "luminance_range" ? prev.smooth : undefined),
          density: input.density ?? current?.density,
          invert: input.invert ?? current?.invert,
          params: { ...(current?.params ?? {}), ...(input.params ?? {}) },
        });
        const recipe = actions.patchDevelop({ masks: { upsert: [mask] } });
        return { ok: true, maskId: mask.id, masks: summarizeMasks(recipe.masks) };
      },
    }),
    upsert_color_mask: tool({
      description:
        "Create or update a color-range mask (select by hue/chroma). hue/chroma/tolerance are 0–1.",
      inputSchema: z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        hue: z.number().min(0).max(1).optional(),
        chroma: z.number().min(0).max(1).optional(),
        tolerance: z.number().min(0).max(1).optional(),
        density: z.number().min(0).max(100).optional(),
        invert: z.boolean().optional(),
        params: maskParamsSchema.optional(),
      }),
      execute: async (input) => {
        const current = input.id
          ? actions.getRecipe().masks.find((m) => m.id === input.id)
          : undefined;
        const prev = current?.components.find((c) => c.type === "color_range");
        const mask = createColorRangeMask({
          id: input.id ?? current?.id,
          name: input.name ?? current?.name,
          hue: input.hue ?? (prev?.type === "color_range" ? prev.hue : undefined),
          chroma: input.chroma ?? (prev?.type === "color_range" ? prev.chroma : undefined),
          tolerance: input.tolerance ?? (prev?.type === "color_range" ? prev.tolerance : undefined),
          density: input.density ?? current?.density,
          invert: input.invert ?? current?.invert,
          params: { ...(current?.params ?? {}), ...(input.params ?? {}) },
        });
        const recipe = actions.patchDevelop({ masks: { upsert: [mask] } });
        return { ok: true, maskId: mask.id, masks: summarizeMasks(recipe.masks) };
      },
    }),
    remove_mask: tool({
      description: "Remove a local-adjustment mask by id.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const recipe = actions.patchDevelop({ masks: { remove: [id] } });
        return { ok: true, masks: summarizeMasks(recipe.masks) };
      },
    }),
    apply_crop_patch: tool({
      description:
        "Adjust crop and straighten. Coordinates are normalized 0–1 on the source image (top-left origin). Enable crop to apply on export.",
      inputSchema: z.object({
        enabled: z.boolean().optional(),
        x: z.number().min(0).max(1).optional(),
        y: z.number().min(0).max(1).optional(),
        width: z.number().min(0.02).max(1).optional(),
        height: z.number().min(0.02).max(1).optional(),
        angle: z.number().min(-45).max(45).optional().describe("Straighten degrees"),
        aspect: z.enum(["original", "1:1", "4:5", "16:9", "custom"]).optional(),
      }),
      execute: async (input) => {
        const recipe = actions.patchDevelop({ crop: input });
        return { ok: true, crop: recipe.crop };
      },
    }),
    apply_catalog_patch: tool({
      description: "Set star rating (0-5) and/or pick/reject flag.",
      inputSchema: z.object({
        rating: z.number().min(0).max(5).optional(),
        flag: z.enum(["pick", "reject", "unflagged"]).optional(),
      }),
      execute: async (input) => ({ ok: true, ...actions.patchCatalog(input) }),
    }),
    apply_preset: tool({
      description: "Apply a named develop preset to the current photo.",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => ({ ok: true, result: actions.applyPreset(name) }),
    }),
    copy_settings: tool({
      description: "Copy current develop settings for later paste.",
      inputSchema: z.object({}),
      execute: async () => {
        actions.copySettings();
        return { ok: true };
      },
    }),
    reset_recipe: tool({
      description: "Reset develop settings to defaults (zeroed globals, no masks).",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, globals: actions.resetRecipe().globals }),
    }),
  };
}
