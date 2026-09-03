import { describe, expect, it } from "vitest";
import { traceEventFromStreamPart } from "./run";

describe("traceEventFromStreamPart", () => {
  it("maps reasoning, text, and tool stream parts", () => {
    expect(
      traceEventFromStreamPart({ type: "reasoning-delta", id: "r", text: "hi" }),
    ).toEqual({ type: "reasoning-delta", id: "r", text: "hi" });
    expect(traceEventFromStreamPart({ type: "text-delta", id: "t", text: "ok" })).toEqual({
      type: "text-delta",
      id: "t",
      text: "ok",
    });
    expect(
      traceEventFromStreamPart({
        type: "tool-call",
        toolCallId: "1",
        toolName: "analyze_scene",
        input: {},
      }),
    ).toEqual({ type: "tool-call", id: "1", name: "analyze_scene", args: {} });
    expect(
      traceEventFromStreamPart({
        type: "tool-result",
        toolCallId: "1",
        toolName: "analyze_scene",
        output: { ok: true },
      }),
    ).toEqual({ type: "tool-result", id: "1", name: "analyze_scene", result: { ok: true } });
    expect(traceEventFromStreamPart({ type: "start-step" })).toBeNull();
  });
});
