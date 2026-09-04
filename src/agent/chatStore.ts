import type { ChatMsg } from "../ui/agentChat";

const STORAGE_KEY = "field.agentChats";
const MAX_SESSIONS_PER_PHOTO = 30;
const MAX_MESSAGES_PER_SESSION = 200;

export type AgentChatSession = {
  id: string;
  photoId: string;
  title: string;
  messages: ChatMsg[];
  createdAt: number;
  updatedAt: number;
  /**
   * `history.past.length` captured at the start of the latest agent turn.
   * Used to undo all recipe commits from that turn in one action.
   */
  lastTurnPastLength: number | null;
};

export type PhotoChatState = {
  sessions: AgentChatSession[];
  activeId: string;
};

export type AgentChatStore = {
  byPhoto: Record<string, PhotoChatState>;
};

export function emptyChatStore(): AgentChatStore {
  return { byPhoto: {} };
}

export function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createChatSession(photoId: string, title = "New chat"): AgentChatSession {
  const now = Date.now();
  return {
    id: newSessionId(),
    photoId,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
    lastTurnPastLength: null,
  };
}

export function ensurePhotoChats(store: AgentChatStore, photoId: string): AgentChatStore {
  if (store.byPhoto[photoId]) return store;
  const session = createChatSession(photoId);
  return {
    byPhoto: {
      ...store.byPhoto,
      [photoId]: { sessions: [session], activeId: session.id },
    },
  };
}

export function getActiveSession(store: AgentChatStore, photoId: string | null): AgentChatSession | null {
  if (!photoId) return null;
  const next = ensurePhotoChats(store, photoId);
  const state = next.byPhoto[photoId];
  return state.sessions.find((s) => s.id === state.activeId) ?? state.sessions[0] ?? null;
}

function trimSessions(sessions: AgentChatSession[]): AgentChatSession[] {
  if (sessions.length <= MAX_SESSIONS_PER_PHOTO) return sessions;
  return [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS_PER_PHOTO)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function titleFromMessages(messages: ChatMsg[], fallback: string): string {
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) return fallback;
  const t = firstUser.text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

export function updateActiveMessages(
  store: AgentChatStore,
  photoId: string,
  updater: (messages: ChatMsg[]) => ChatMsg[],
  extras?: Partial<Pick<AgentChatSession, "lastTurnPastLength">>,
): AgentChatStore {
  const base = ensurePhotoChats(store, photoId);
  const state = base.byPhoto[photoId];
  const sessions = state.sessions.map((s) => {
    if (s.id !== state.activeId) return s;
    const messages = updater(s.messages).slice(-MAX_MESSAGES_PER_SESSION);
    return {
      ...s,
      messages,
      title: titleFromMessages(messages, s.title),
      updatedAt: Date.now(),
      lastTurnPastLength:
        extras && "lastTurnPastLength" in extras ? extras.lastTurnPastLength ?? null : s.lastTurnPastLength,
    };
  });
  return {
    byPhoto: {
      ...base.byPhoto,
      [photoId]: { ...state, sessions },
    },
  };
}

export function startNewChat(store: AgentChatStore, photoId: string): AgentChatStore {
  const base = ensurePhotoChats(store, photoId);
  const session = createChatSession(photoId);
  const sessions = trimSessions([...base.byPhoto[photoId].sessions, session]);
  return {
    byPhoto: {
      ...base.byPhoto,
      [photoId]: { sessions, activeId: session.id },
    },
  };
}

export function selectChat(store: AgentChatStore, photoId: string, chatId: string): AgentChatStore {
  const base = ensurePhotoChats(store, photoId);
  const state = base.byPhoto[photoId];
  if (!state.sessions.some((s) => s.id === chatId)) return base;
  return {
    byPhoto: {
      ...base.byPhoto,
      [photoId]: { ...state, activeId: chatId },
    },
  };
}

export function clearLastTurnMarker(store: AgentChatStore, photoId: string): AgentChatStore {
  return updateActiveMessages(store, photoId, (m) => m, { lastTurnPastLength: null });
}

/** Persistable subset — drop bulky tool step payloads. */
function serializeMsg(m: ChatMsg): ChatMsg {
  return {
    role: m.role,
    text: m.text,
    categories: m.categories,
    status: m.status === "streaming" ? "done" : m.status,
    previewSent: m.previewSent,
    // Keep a light tool summary only (drop bulky args/results)
    steps: m.steps
      ?.filter((s) => s.kind === "tool" || s.kind === "reasoning")
      .map((s) =>
        s.kind === "tool"
          ? { id: s.id, kind: "tool" as const, name: s.name, error: s.error }
          : { id: s.id, kind: "reasoning" as const, text: s.text.slice(0, 400) },
      ),
  };
}

export function loadChatStore(): AgentChatStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyChatStore();
    const parsed = JSON.parse(raw) as AgentChatStore;
    if (!parsed?.byPhoto || typeof parsed.byPhoto !== "object") return emptyChatStore();
    return parsed;
  } catch {
    return emptyChatStore();
  }
}

export function saveChatStore(store: AgentChatStore) {
  try {
    const slim: AgentChatStore = { byPhoto: {} };
    for (const [photoId, state] of Object.entries(store.byPhoto)) {
      slim.byPhoto[photoId] = {
        activeId: state.activeId,
        sessions: trimSessions(state.sessions).map((s) => ({
          ...s,
          messages: s.messages.map(serializeMsg),
        })),
      };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    // Quota / private mode — ignore
  }
}
