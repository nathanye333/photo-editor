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

const TITLE_MAX = 40;

/** Sessions with no user/assistant content (blank "New chat"). */
export function isBlankSession(session: AgentChatSession): boolean {
  return !session.messages.some(
    (m) => Boolean(m.text?.trim()) || Boolean(m.steps?.length) || Boolean(m.categories?.length),
  );
}

const LEADING_FILLER =
  /^(please|pls|plz|hey|hi|hello|ok|okay|just|um+|uh+|so+|well)\b[,!.:]?\s*/i;
const REQUEST_FILLER =
  /^(can you|could you|would you|will you|help me( to)?|i want( you)? to|i('d| would) like( you)? to|try to|try|make (the|this|it))\s+/i;
const TRAILING_FILLER = /[.,!?\s]*(please|thanks|thank you|thx)\.?$/i;

/** Strip polite / filler phrasing so titles read like edit intents. */
export function cleanPromptForTitle(text: string): string {
  let t = text.trim().replace(/\s+/g, " ");
  for (let i = 0; i < 6; i++) {
    const next = t.replace(LEADING_FILLER, "").replace(REQUEST_FILLER, "").replace(TRAILING_FILLER, "").trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

const INTENT_RULES: Array<{ re: RegExp; title: string }> = [
  { re: /\b(warm(er|th)?|add warmth)\b/i, title: "Warm tones" },
  { re: /\b(cool(er)?|add cool)\b/i, title: "Cool tones" },
  { re: /\b(lift|raise|brighten|brighter|open)\b.{0,32}\bshadows?\b/i, title: "Lift shadows" },
  { re: /\bshadows?\b.{0,32}\b(lift|raise|brighten|brighter|open)\b/i, title: "Lift shadows" },
  { re: /\b(crush|deepen|darken)\b.{0,32}\bshadows?\b/i, title: "Deepen shadows" },
  { re: /\b(recover|bring back|lift)\b.{0,32}\bhighlights?\b/i, title: "Recover highlights" },
  { re: /\b(darken|pull|tame)\b.{0,32}\b(sky|skies)\b/i, title: "Darken sky" },
  { re: /\b(sky|skies)\b.{0,32}\b(darken|pull|tame|darker)\b/i, title: "Darken sky" },
  { re: /\b(punch|boost|add)\b.{0,16}\b(contrast|punch)\b/i, title: "Add contrast" },
  { re: /\b(desaturat|mute|less saturat)\b/i, title: "Desaturate" },
  { re: /\b(vibran|more color|saturat)\b/i, title: "Boost color" },
  { re: /\b(sharpen|crisper|crisp)\b/i, title: "Sharpen" },
  { re: /\b(soften|smooth)\b.{0,16}\bskin\b/i, title: "Soften skin" },
  { re: /\b(crop|reframe|tighten)\b/i, title: "Crop / reframe" },
  { re: /\b(straighten|level|horizon)\b/i, title: "Straighten" },
  { re: /\b(black (and|&) white|b\s*&\s*w|monochrome|grayscale)\b/i, title: "Black & white" },
  { re: /\b(expos(ure|e)|brighten|darken)\b/i, title: "Exposure" },
  { re: /\b(white balance|wb|neutral)\b/i, title: "White balance" },
  { re: /\b(vignette)\b/i, title: "Vignette" },
  { re: /\b(haze|dehaze|clarity)\b/i, title: "Clarity / dehaze" },
];

function titleFromTools(messages: ChatMsg[]): string | null {
  const names: string[] = [];
  for (const m of messages) {
    for (const s of m.steps ?? []) {
      if (s.kind === "tool" && s.name && !names.includes(s.name)) names.push(s.name);
    }
    for (const c of m.categories ?? []) {
      if (!names.includes(c)) names.push(c);
    }
  }
  if (!names.length) return null;
  const label = names
    .slice(0, 3)
    .map((n) => n.replace(/_/g, " "))
    .join(" · ");
  return label.length > TITLE_MAX ? `${label.slice(0, TITLE_MAX - 1)}…` : label;
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const at = slice.lastIndexOf(" ");
  const base = at > max * 0.45 ? slice.slice(0, at) : slice;
  return `${base.trimEnd()}…`;
}

function capitalizeTitle(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Build a short, human history title from the conversation. */
export function generateChatTitle(messages: ChatMsg[], fallback = "New chat"): string {
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) {
    return titleFromTools(messages) ?? fallback;
  }
  const cleaned = cleanPromptForTitle(firstUser.text);
  if (!cleaned) {
    return titleFromTools(messages) ?? fallback;
  }
  for (const rule of INTENT_RULES) {
    if (rule.re.test(cleaned) || rule.re.test(firstUser.text)) return rule.title;
  }
  // Very generic prompts → prefer tool-based title when available
  if (/^(this|it|the (photo|image|shot)|edit( it)?|fix( it)?|go|do it|yes|ok|okay)\.?$/i.test(cleaned)) {
    return titleFromTools(messages) ?? capitalizeTitle(cleaned);
  }
  return truncateAtWord(capitalizeTitle(cleaned), TITLE_MAX);
}

function titleFromMessages(messages: ChatMsg[], fallback: string): string {
  return generateChatTitle(messages, fallback);
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
  const state = base.byPhoto[photoId];
  const active = state.sessions.find((s) => s.id === state.activeId) ?? state.sessions[0];
  // Already on an empty chat — don't stack blank entries in history.
  if (active && isBlankSession(active)) return base;

  const session = createChatSession(photoId);
  // Drop other blank sessions so History only keeps real conversations.
  const kept = state.sessions.filter((s) => !isBlankSession(s));
  const sessions = trimSessions([...kept, session]);
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
