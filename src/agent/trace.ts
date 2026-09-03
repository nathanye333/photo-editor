/** Structured agent timeline events for Cursor-style tool / reasoning traces. */

export type AgentStep =
  | { id: string; kind: "reasoning"; text: string }
  | { id: string; kind: "tool"; name: string; args?: unknown; result?: unknown; error?: string }
  | { id: string; kind: "text"; text: string };

export type AgentTraceEvent =
  | { type: "reasoning-delta"; id: string; text: string }
  | { type: "tool-call"; id: string; name: string; args?: unknown }
  | { type: "tool-result"; id: string; name: string; result?: unknown }
  | { type: "tool-error"; id: string; name: string; error: string }
  | { type: "text-delta"; id: string; text: string };

const MAX_JSON = 480;

/** Compact JSON for the timeline UI — avoids dumping huge recipe payloads. */
export function summarizeTraceValue(value: unknown, max = MAX_JSON): string {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value, null, 0);
    if (raw.length <= max) return raw;
    return `${raw.slice(0, max)}…`;
  } catch {
    return String(value);
  }
}

/** Fold a stream event into the step list (immutable). */
export function reduceTrace(steps: AgentStep[], event: AgentTraceEvent): AgentStep[] {
  switch (event.type) {
    case "reasoning-delta": {
      const i = steps.findIndex((s) => s.kind === "reasoning" && s.id === event.id);
      if (i >= 0) {
        const prev = steps[i];
        if (prev.kind !== "reasoning") return steps;
        const next = steps.slice();
        next[i] = { ...prev, text: prev.text + event.text };
        return next;
      }
      return [...steps, { id: event.id, kind: "reasoning", text: event.text }];
    }
    case "text-delta": {
      const i = steps.findIndex((s) => s.kind === "text" && s.id === event.id);
      if (i >= 0) {
        const prev = steps[i];
        if (prev.kind !== "text") return steps;
        const next = steps.slice();
        next[i] = { ...prev, text: prev.text + event.text };
        return next;
      }
      return [...steps, { id: event.id, kind: "text", text: event.text }];
    }
    case "tool-call": {
      const i = steps.findIndex((s) => s.kind === "tool" && s.id === event.id);
      if (i >= 0) {
        const prev = steps[i];
        if (prev.kind !== "tool") return steps;
        const next = steps.slice();
        next[i] = { ...prev, name: event.name, args: event.args };
        return next;
      }
      return [...steps, { id: event.id, kind: "tool", name: event.name, args: event.args }];
    }
    case "tool-result": {
      const i = steps.findIndex((s) => s.kind === "tool" && s.id === event.id);
      if (i >= 0) {
        const prev = steps[i];
        if (prev.kind !== "tool") return steps;
        const next = steps.slice();
        next[i] = { ...prev, name: event.name || prev.name, result: event.result };
        return next;
      }
      return [
        ...steps,
        { id: event.id, kind: "tool", name: event.name, result: event.result },
      ];
    }
    case "tool-error": {
      const i = steps.findIndex((s) => s.kind === "tool" && s.id === event.id);
      if (i >= 0) {
        const prev = steps[i];
        if (prev.kind !== "tool") return steps;
        const next = steps.slice();
        next[i] = { ...prev, name: event.name || prev.name, error: event.error };
        return next;
      }
      return [
        ...steps,
        { id: event.id, kind: "tool", name: event.name, error: event.error },
      ];
    }
    default:
      return steps;
  }
}

export function finalTextFromSteps(steps: AgentStep[], fallback = "Done."): string {
  const texts = steps.filter((s): s is Extract<AgentStep, { kind: "text" }> => s.kind === "text");
  const joined = texts.map((t) => t.text).join("").trim();
  return joined || fallback;
}

export function toolCount(steps: AgentStep[]): number {
  return steps.filter((s) => s.kind === "tool").length;
}
