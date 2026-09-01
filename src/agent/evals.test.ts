import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routeCategories } from "./router";
import { defaultRecipe } from "../recipe/defaults";
import { applyCatalogPatch, applyPatch } from "../recipe/patch";
import type { CatalogPatch, CurveChannel, DevelopPatch, PatchMode } from "../recipe/types";

type Case = {
  id: string;
  instruction: string;
  expectedCategories?: string[];
  expectedPatch?: DevelopPatch;
  expectedCatalog?: CatalogPatch;
  expectedTool?: string;
  mode?: PatchMode;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const lines = readFileSync(join(root, "evals/develop-v1.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Case);

describe("develop-v1 evals", () => {
  for (const c of lines) {
    it(c.id, () => {
      if (c.expectedCategories) {
        expect(routeCategories(c.instruction)).toEqual(c.expectedCategories);
      }
      if (c.expectedPatch) {
        const next = applyPatch(defaultRecipe(), c.expectedPatch, c.mode ?? "delta");
        const again = applyPatch(defaultRecipe(), c.expectedPatch, c.mode ?? "delta");
        expect(next).toEqual(again);
        if (c.expectedPatch.globals?.temp !== undefined) {
          expect(next.globals.temp).toBe(c.expectedPatch.globals.temp);
        }
        if (c.expectedPatch.globals?.shadows !== undefined) {
          expect(next.globals.shadows).toBe(c.expectedPatch.globals.shadows);
        }
        if (c.expectedPatch.globals?.exposure !== undefined) {
          expect(next.globals.exposure).toBe(c.expectedPatch.globals.exposure);
        }
        if (c.expectedPatch.globals?.hsl?.orange?.sat !== undefined) {
          expect(next.globals.hsl.orange.sat).toBe(c.expectedPatch.globals.hsl.orange.sat);
        }
        for (const [ch, points] of Object.entries(c.expectedPatch.globals?.toneCurve?.channels ?? {})) {
          expect(next.globals.toneCurve.channels[ch as CurveChannel]).toEqual(points);
        }
        if (c.expectedPatch.masks?.upsert?.length) {
          expect(next.masks).toHaveLength(c.expectedPatch.masks.upsert.length);
          expect(next.masks[0].params.exposure).toBe(c.expectedPatch.masks.upsert[0].params?.exposure);
        }
      }
      if (c.expectedCatalog) {
        const next = applyCatalogPatch({ rating: 0, flag: "unflagged" }, c.expectedCatalog);
        expect(next).toMatchObject(c.expectedCatalog);
      }
    });
  }
});
