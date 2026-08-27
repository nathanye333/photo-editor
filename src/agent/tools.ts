import { tool } from "ai";
import { z } from "zod";
import type { CatalogPatch, DevelopPatch, EditRecipe, Flag } from "../recipe/types";

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

export type AgentActions = {
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
        "Apply relative deltas to global develop params (already stored as absolute values). Prefer small iterative deltas. Do not send pixels. Masks are not available.",
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
      description: "Reset develop settings to defaults (zeroed globals).",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, globals: actions.resetRecipe().globals }),
    }),
  };
}
