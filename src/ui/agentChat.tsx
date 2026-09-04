import { useEffect, useRef, useState } from "react";
import type { AgentChatSession as ChatSession } from "../agent/chatStore";
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

function formatChatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function AgentChat(props: {
  messages: ChatMsg[];
  busy: boolean;
  hasKey: boolean;
  sendPreview: boolean;
  photoLabel: string | null;
  sessions: ChatSession[];
  activeChatId: string | null;
  canUndoAgent: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onUndoAgent: () => void;
  onOpenSettings: () => void;
}) {
  const [text, setText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [props.messages, props.busy]);

  useEffect(() => {
    if (!historyOpen) return;
    function onDoc(e: MouseEvent) {
      if (!historyRef.current?.contains(e.target as Node)) setHistoryOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [historyOpen]);

  const sessions = [...props.sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="agent">
      <header className="agent-h">
        <div className="agent-h-main">
          <span>Agent</span>
          {props.photoLabel ? <small className="agent-photo">{props.photoLabel}</small> : null}
        </div>
        <div className="agent-h-actions">
          <div className="agent-history" ref={historyRef}>
            <button
              type="button"
              className="btn-ghost"
              disabled={!props.photoLabel}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((o) => !o)}
              title="Chat history"
            >
              History
            </button>
            {historyOpen ? (
              <div className="agent-history-menu" role="menu">
                {sessions.length === 0 ? (
                  <p className="stub pad">No chats yet</p>
                ) : (
                  sessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitem"
                      className={s.id === props.activeChatId ? "on" : ""}
                      onClick={() => {
                        props.onSelectChat(s.id);
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="agent-history-title">{s.title || "New chat"}</span>
                      <small>{formatChatTime(s.updatedAt)}</small>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-ghost"
            disabled={!props.photoLabel || props.busy}
            onClick={props.onNewChat}
            title="Start a new chat for this photo"
          >
            New
          </button>
          <button type="button" className="btn-ghost" onClick={props.onOpenSettings}>
            Settings
          </button>
        </div>
      </header>
      <div className="agent-log" ref={logRef}>
        {!props.photoLabel ? (
          <p className="stub">Select a photo to chat with the develop agent.</p>
        ) : props.messages.length === 0 ? (
          <p className="stub">
            Edits the same recipe as the sliders for this photo. Try “warm this up” or “lift the shadows”.
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
      <div className="agent-toolbar">
        <button
          type="button"
          className="btn-ghost"
          disabled={!props.canUndoAgent || props.busy}
          onClick={props.onUndoAgent}
          title="Undo recipe changes from the last agent turn"
        >
          Undo agent
        </button>
        {props.busy ? (
          <button type="button" className="btn-stop" onClick={props.onStop} title="Stop the agent">
            Stop
          </button>
        ) : null}
      </div>
      <form
        className="agent-in"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || props.busy || !props.photoLabel) return;
          setText("");
          props.onSend(t);
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder={props.photoLabel ? "Describe an edit…" : "Select a photo first…"}
          disabled={props.busy || !props.photoLabel}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="btn" disabled={props.busy || !text.trim() || !props.photoLabel}>
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
        <p className="stub">Settings are stored locally. Chat history is stored per photo in this browser.</p>
        <button type="button" className="btn" onClick={props.onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
