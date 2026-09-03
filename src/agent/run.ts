import { streamText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { HistogramStats } from "../render/preview";
import type { EditRecipe, Flag } from "../recipe/types";
import { primaryComponent } from "../recipe/types";
import type { AppSettings } from "../settings";
import { CATEGORY_DOCS, routeCategories } from "./router";
import {
  finalTextFromSteps,
  reduceTrace,
  type AgentStep,
  type AgentTraceEvent,
} from "./trace";
import { createAgentTools, type AgentActions } from "./tools";

export type { AgentStep, AgentTraceEvent };

export function buildInstructions(opts: {
  instruction: string;
  recipe: EditRecipe;
  histogram: HistogramStats | null;
  exif: Record<string, string>;
  rating: number;
  flag: Flag;
  presets: string[];
  sceneSummary?: string | null;
}): { categories: ReturnType<typeof routeCategories>; system: string } {
  const categories = routeCategories(opts.instruction);
  const docs = categories.map((c) => CATEGORY_DOCS[c]).join("\n");
  const system = [
    "You are the develop assistant for Field, a local photo editor.",
    "Mutate the shared edit recipe via tools. Global deltas are relative. Local adjustments use upsert_mask / remove_mask (structured mask ops only — never invent pixels).",
    "Use analyze_scene / sample_at when you need spatial or color context before placing masks.",
    "When suggestedMasks are present, prefer those UVs unless the user specifies otherwise.",
    "After tools, reply with one short sentence of what you changed.",
    docs,
    opts.sceneSummary ? `Scene analysis: ${opts.sceneSummary}` : null,
    `Current globals: ${JSON.stringify(opts.recipe.globals)}`,
    `Current masks: ${JSON.stringify(
      opts.recipe.masks.map((m) => {
        const component = primaryComponent(m);
        return {
          id: m.id,
          name: m.name,
          invert: m.invert,
          density: m.density,
          params: m.params,
          component:
            component?.type === "semantic"
              ? {
                  type: "semantic",
                  label: component.label,
                  model: component.model,
                  width: component.width,
                  height: component.height,
                  hasCoverage: Boolean(component.alpha?.length),
                }
              : component,
        };
      }),
    )}`,
    `Catalog: rating=${opts.rating} flag=${opts.flag}`,
    opts.histogram
      ? `Developed histogram: meanLuma=${opts.histogram.meanLuma.toFixed(3)} clipLow=${opts.histogram.clipLow.toFixed(3)} clipHigh=${opts.histogram.clipHigh.toFixed(3)}`
      : "Developed histogram: unavailable",
    `EXIF: ${JSON.stringify(opts.exif)}`,
    opts.presets.length ? `Presets: ${opts.presets.join(", ")}` : "No presets saved.",
  ]
    .filter(Boolean)
    .join("\n");
  return { categories, system };
}

/** Map AI SDK fullStream chunks into our compact timeline events. */
export function traceEventFromStreamPart(part: {
  type: string;
  id?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}): AgentTraceEvent | null {
  switch (part.type) {
    case "reasoning-delta":
      if (!part.id || part.text == null) return null;
      return { type: "reasoning-delta", id: part.id, text: part.text };
    case "text-delta":
      if (!part.id || part.text == null) return null;
      return { type: "text-delta", id: part.id, text: part.text };
    case "tool-call":
      if (!part.toolCallId || !part.toolName) return null;
      return {
        type: "tool-call",
        id: part.toolCallId,
        name: part.toolName,
        args: part.input,
      };
    case "tool-result":
      if (!part.toolCallId || !part.toolName) return null;
      return {
        type: "tool-result",
        id: part.toolCallId,
        name: part.toolName,
        result: part.output,
      };
    case "tool-error":
      if (!part.toolCallId || !part.toolName) return null;
      return {
        type: "tool-error",
        id: part.toolCallId,
        name: part.toolName,
        error: part.error instanceof Error ? part.error.message : String(part.error ?? "tool error"),
      };
    default:
      return null;
  }
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
  sceneSummary?: string | null;
  /** Developed preview JPEG bytes when sendPreview is enabled. */
  previewImage?: Uint8Array | null;
  onTrace?: (steps: AgentStep[]) => void;
}): Promise<{
  text: string;
  categories: ReturnType<typeof routeCategories>;
  steps: AgentStep[];
  previewSent: boolean;
}> {
  if (!opts.settings.apiKey.trim()) {
    throw new Error("Add an API key in Settings to use the agent.");
  }
  const { categories, system } = buildInstructions(opts);
  const openai = createOpenAI({
    apiKey: opts.settings.apiKey,
    baseURL: opts.settings.baseURL || undefined,
  });

  const previewSent = Boolean(opts.previewImage && opts.previewImage.length);

  const result = streamText({
    model: openai(opts.settings.model),
    tools: createAgentTools(opts.actions),
    stopWhen: stepCountIs(8),
    system,
    ...(previewSent
      ? {
          messages: [
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: opts.instruction },
                { type: "image" as const, image: opts.previewImage! },
              ],
            },
          ],
        }
      : { prompt: opts.instruction }),
  });

  let steps: AgentStep[] = previewSent
    ? [{ id: "preview-note", kind: "reasoning", text: "Preview thumbnail sent to the model." }]
    : [];
  opts.onTrace?.(steps);

  for await (const part of result.fullStream) {
    const event = traceEventFromStreamPart(part as Parameters<typeof traceEventFromStreamPart>[0]);
    if (!event) continue;
    steps = reduceTrace(steps, event);
    opts.onTrace?.(steps);
  }

  const text = finalTextFromSteps(steps, "Done.");
  return { text, categories, steps, previewSent };
}
