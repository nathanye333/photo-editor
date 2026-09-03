import { describe, expect, it } from "vitest";
import {
  finalTextFromSteps,
  reduceTrace,
  summarizeTraceValue,
  toolCount,
  type AgentStep,
} from "./trace";

describe("reduceTrace", () => {
  it("accumulates reasoning and text deltas by id", () => {
    let steps: AgentStep[] = [];
    steps = reduceTrace(steps, { type: "reasoning-delta", id: "r1", text: "Think" });
    steps = reduceTrace(steps, { type: "reasoning-delta", id: "r1", text: "ing…" });
    steps = reduceTrace(steps, { type: "text-delta", id: "t1", text: "Done" });
    steps = reduceTrace(steps, { type: "text-delta", id: "t1", text: "." });
    expect(steps).toEqual([
      { id: "r1", kind: "reasoning", text: "Thinking…" },
      { id: "t1", kind: "text", text: "Done." },
    ]);
    expect(finalTextFromSteps(steps)).toBe("Done.");
  });

  it("pairs tool calls with results and errors", () => {
    let steps: AgentStep[] = [];
    steps = reduceTrace(steps, {
      type: "tool-call",
      id: "c1",
      name: "apply_develop_patch",
      args: { exposure: 0.3 },
    });
    steps = reduceTrace(steps, {
      type: "tool-result",
      id: "c1",
      name: "apply_develop_patch",
      result: { ok: true },
    });
    steps = reduceTrace(steps, {
      type: "tool-call",
      id: "c2",
      name: "analyze_scene",
      args: {},
    });
    steps = reduceTrace(steps, {
      type: "tool-error",
      id: "c2",
      name: "analyze_scene",
      error: "no pixels",
    });
    expect(toolCount(steps)).toBe(2);
    expect(steps[0]).toMatchObject({
      kind: "tool",
      name: "apply_develop_patch",
      args: { exposure: 0.3 },
      result: { ok: true },
    });
    expect(steps[1]).toMatchObject({
      kind: "tool",
      name: "analyze_scene",
      error: "no pixels",
    });
  });

  it("truncates long JSON summaries", () => {
    const long = { data: "x".repeat(600) };
    const s = summarizeTraceValue(long, 40);
    expect(s.length).toBeLessThanOrEqual(41);
    expect(s.endsWith("…")).toBe(true);
  });
});
