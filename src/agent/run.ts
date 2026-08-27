import { generateText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { HistogramStats } from "../render/preview";
import type { EditRecipe, Flag } from "../recipe/types";
import type { AppSettings } from "../settings";
import { CATEGORY_DOCS, routeCategories } from "./router";
import { createAgentTools, type AgentActions } from "./tools";

export function buildInstructions(opts: {
  instruction: string;
  recipe: EditRecipe;
  histogram: HistogramStats | null;
  exif: Record<string, string>;
  rating: number;
  flag: Flag;
  presets: string[];
}): { categories: ReturnType<typeof routeCategories>; system: string } {
  const categories = routeCategories(opts.instruction);
  const docs = categories.map((c) => CATEGORY_DOCS[c]).join("\n");
  const system = [
    "You are the develop assistant for Field, a local photo editor.",
    "Mutate the shared edit recipe via tools. Deltas are relative. Never invent pixels or masks.",
    "After tools, reply with one short sentence of what you changed.",
    docs,
    `Current globals: ${JSON.stringify(opts.recipe.globals)}`,
    `Catalog: rating=${opts.rating} flag=${opts.flag}`,
    opts.histogram
      ? `Histogram: meanLuma=${opts.histogram.meanLuma.toFixed(3)} clipLow=${opts.histogram.clipLow.toFixed(3)} clipHigh=${opts.histogram.clipHigh.toFixed(3)}`
      : "Histogram: unavailable",
    `EXIF: ${JSON.stringify(opts.exif)}`,
    opts.presets.length ? `Presets: ${opts.presets.join(", ")}` : "No presets saved.",
  ].join("\n");
  return { categories, system };
}

export async function runAgentTurn(opts: {
  instruction: string;
  recipe: EditRecipe;
  histogram: HistogramStats | null;
  exif: Record<string, string>;
  rating: number;
  flag: Flag;
  presets: string[];
  settings: AppSettings;
  actions: AgentActions;
}): Promise<{ text: string; categories: ReturnType<typeof routeCategories> }> {
  if (!opts.settings.apiKey.trim()) {
    throw new Error("Add an API key in Settings to use the agent.");
  }
  const { categories, system } = buildInstructions(opts);
  const openai = createOpenAI({
    apiKey: opts.settings.apiKey,
    baseURL: opts.settings.baseURL || undefined,
  });
  const result = await generateText({
    model: openai(opts.settings.model),
    tools: createAgentTools(opts.actions),
    stopWhen: stepCountIs(6),
    system,
    prompt: opts.instruction,
  });
  return { text: result.text || "Done.", categories };
}
