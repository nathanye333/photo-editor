import { useState } from "react";
import type { ToolCategory } from "../agent/router";

export type ChatMsg = {
  role: "user" | "assistant" | "error";
  text: string;
  categories?: ToolCategory[];
};

export function AgentChat(props: {
  messages: ChatMsg[];
  busy: boolean;
  hasKey: boolean;
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
          <div key={i} className={`msg ${m.role}`}>
            <p>{m.text}</p>
            {m.categories?.length ? <small>{m.categories.join(" · ")}</small> : null}
          </div>
        ))}
      </div>
      {!props.hasKey ? (
        <p className="stub pad">
          Add an API key in Settings. Photos stay on disk; only recipe + histogram + EXIF are sent.
        </p>
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
  onChange: (field: "apiKey" | "baseURL" | "model", value: string) => void;
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
        <p className="stub">Stored locally. Never uploaded with photos.</p>
        <button type="button" className="btn" onClick={props.onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
