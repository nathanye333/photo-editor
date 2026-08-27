import { tool } from "ai";
import { z } from "zod";
import { createRadialMask } from "../recipe/defaults";
import type { CatalogPatch, DevelopPatch, EditRecipe, Flag, Mask } from "../recipe/types";

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
  clarity: z.number().optional(),
  dehaze: z.number().optional(),
});

function summarizeMasks(masks: Mask[]) {
  return masks.map((m) => ({
    id: m.id,
    name: m.name,
    invert: m.invert,
    density: m.density,
    feather: m.feather,
    params: m.params,
    radial: m.components.find((c) => c.type === "radial") ?? null,
  }));
}

export type AgentActions = {
  getRecipe: () => EditRecipe;
  patchDevelop: (patch: DevelopPatch) => EditRecipe;
  patchCatalog: (patch: CatalogPatch) => { rating: number; flag: Flag };
  applyPreset: (name: string) => string;
  copySettings: () => void;
  resetRecipe: () => EditRecipe;
};

export function createAgentTools(actions: AgentActions) {
  return {
    apply_develop_patch: tool({
      description:
        "Apply relative deltas to global develop params (already stored as absolute values). Prefer small iterative deltas. Do not send pixels. For local adjustments use upsert_mask / remove_mask.",
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
        clarity: z.number().optional(),
        dehaze: z.number().optional(),
        sharpening: z.number().optional(),
        noiseReduction: z.number().optional(),
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
    upsert_mask: tool({
      description:
        "Create or update a radial local-adjustment mask. Coordinates are normalized 0–1 (origin top-left). Params override globals inside the mask. Pass id to update an existing mask.",
      inputSchema: z.object({
        id: z.string().optional().describe("Existing mask id to update; omit to create"),
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
    remove_mask: tool({
      description: "Remove a local-adjustment mask by id.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const recipe = actions.patchDevelop({ masks: { remove: [id] } });
        return { ok: true, masks: summarizeMasks(recipe.masks) };
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
