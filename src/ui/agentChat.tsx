import { useState } from "react";
import type { ToolCategory } from "../agent/router";
import { summarizeTraceValue, toolCount, type AgentStep } from "../agent/trace";

export type ChatMsg = {
  role: "user" | "assistant" | "error";
  text: string;
  categories?: ToolCategory[];
  steps?: AgentStep[];
  status?: "streaming" | "done" | "error";
  previewSent?: boolean;
};

function TraceTimeline({ steps, status }: { steps: AgentStep[]; status?: ChatMsg["status"] }) {
  const tools = toolCount(steps);
  const hasReasoning = steps.some((s) => s.kind === "reasoning" && s.text.trim());
  const [open, setOpen] = useState(status === "streaming");
  const label =
    status === "streaming"
      ? tools
        ? `Working… ${tools} tool${tools === 1 ? "" : "s"}`
        : hasReasoning
          ? "Thinking…"
          : "Working…"
      : tools
        ? `Used ${tools} tool${tools === 1 ? "" : "s"}`
        : hasReasoning
          ? "Thought"
          : null;
  if (!label && !steps.length) return null;
  return (
    <div className="trace">
      <button type="button" className="trace-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} {label ?? "Trace"}
      </button>
      {open ? (
        <ol className="trace-list">
          {steps.map((s) => {
            if (s.kind === "reasoning") {
              if (!s.text.trim()) return null;
              return (
                <li key={s.id} className="trace-item reasoning">
                  <span className="trace-kind">Thought</span>
                  <pre>{s.text}</pre>
                </li>
              );
            }
            if (s.kind === "tool") {
              return (
                <li key={s.id} className={`trace-item tool${s.error ? " err" : ""}`}>
                  <span className="trace-kind">{s.name}</span>
                  {s.args !== undefined ? (
                    <pre className="trace-args">{summarizeTraceValue(s.args)}</pre>
                  ) : null}
                  {s.result !== undefined ? (
                    <pre className="trace-result">{summarizeTraceValue(s.result)}</pre>
                  ) : null}
                  {s.error ? <pre className="trace-error">{s.error}</pre> : null}
                </li>
              );
            }
            return null;
          })}
        </ol>
      ) : null}
    </div>
  );
}

export function AgentChat(props: {
  messages: ChatMsg[];
  busy: boolean;
  hasKey: boolean;
  sendPreview: boolean;
  onSend: (text: string) => void;
  onOpenSettings: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <aside className="agent">
      <header className="agent-h">
        <span>Agent</span>
        <button type="button" className="btn-ghost" onClick={props.onOpenSettings}>
          Settings
        </button>
      </header>
      <div className="agent-log">
        {props.messages.length === 0 ? (
          <p className="stub">
            Edits the same recipe as the sliders. Try “warm this up” or “lift the shadows”.
          </p>
        ) : null}
        {props.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.status === "streaming" ? " streaming" : ""}`}>
            {m.steps?.length ? <TraceTimeline steps={m.steps} status={m.status} /> : null}
            {m.text ? <p>{m.text}</p> : m.status === "streaming" ? <p className="stub">…</p> : null}
            <div className="msg-meta">
              {m.categories?.length ? <small>{m.categories.join(" · ")}</small> : null}
              {m.previewSent ? <small className="preview-sent">Preview sent</small> : null}
            </div>
          </div>
        ))}
      </div>
      {!props.hasKey ? (
        <p className="stub pad">
          Add an API key in Settings. Recipe, histogram, and EXIF are always sent
          {props.sendPreview ? "; a small preview JPEG is sent when Preview vision is on." : "."}
        </p>
      ) : props.sendPreview ? (
        <p className="stub pad">Preview vision on — a small JPEG of the current develop preview is sent with each turn.</p>
      ) : null}
      <form
        className="agent-in"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || props.busy) return;
          setText("");
          props.onSend(t);
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder="Describe an edit…"
          disabled={props.busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="btn" disabled={props.busy || !text.trim()}>
          {props.busy ? "…" : "Send"}
        </button>
      </form>
    </aside>
  );
}

export function SettingsModal(props: {
  apiKey: string;
  baseURL: string;
  model: string;
  sendPreview: boolean;
  visionMaxEdge: number;
  onChange: (
    field: "apiKey" | "baseURL" | "model" | "sendPreview" | "visionMaxEdge",
    value: string | boolean | number,
  ) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-bg" onClick={props.onClose} role="presentation">
      <div className="modal" role="dialog" aria-labelledby="set-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="set-title">Agent settings</h2>
        <label>
          API key
          <input
            type="password"
            value={props.apiKey}
            autoComplete="off"
            onChange={(e) => props.onChange("apiKey", e.target.value)}
          />
        </label>
        <label>
          Base URL
          <input value={props.baseURL} onChange={(e) => props.onChange("baseURL", e.target.value)} />
        </label>
        <label>
          Model
          <input value={props.model} onChange={(e) => props.onChange("model", e.target.value)} />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={props.sendPreview}
            onChange={(e) => props.onChange("sendPreview", e.target.checked)}
          />
          Send preview image
        </label>
        <p className="stub">
          When enabled, a small JPEG of the current develop preview is sent to your model provider. Use a
          vision-capable model (e.g. gpt-4o / gpt-4o-mini).
        </p>
        <label>
          Preview max edge (px)
          <input
            type="number"
            min={256}
            max={1536}
            step={64}
            value={props.visionMaxEdge}
            onChange={(e) => props.onChange("visionMaxEdge", Number(e.target.value) || 768)}
          />
        </label>
        <p className="stub">Settings are stored locally.</p>
        <button type="button" className="btn" onClick={props.onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
