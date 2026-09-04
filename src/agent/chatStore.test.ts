import { describe, expect, it } from "vitest";
import {
  cleanPromptForTitle,
  createChatSession,
  emptyChatStore,
  ensurePhotoChats,
  generateChatTitle,
  getActiveSession,
  isBlankSession,
  selectChat,
  startNewChat,
  updateActiveMessages,
} from "./chatStore";

describe("chatStore", () => {
  it("isolates sessions per photo", () => {
    let store = emptyChatStore();
    store = updateActiveMessages(store, "p1", (m) => [...m, { role: "user", text: "warm this up" }]);
    store = updateActiveMessages(store, "p2", (m) => [...m, { role: "user", text: "darken sky" }]);
    expect(getActiveSession(store, "p1")?.messages[0]?.text).toBe("warm this up");
    expect(getActiveSession(store, "p2")?.messages[0]?.text).toBe("darken sky");
  });

  it("starts a new chat without losing history", () => {
    let store = emptyChatStore();
    store = updateActiveMessages(store, "p1", (m) => [...m, { role: "user", text: "first" }]);
    const firstId = getActiveSession(store, "p1")!.id;
    store = startNewChat(store, "p1");
    const second = getActiveSession(store, "p1")!;
    expect(second.id).not.toBe(firstId);
    expect(second.messages).toEqual([]);
    store = selectChat(store, "p1", firstId);
    expect(getActiveSession(store, "p1")?.messages[0]?.text).toBe("first");
  });

  it("does not add a blank chat when New is clicked on an empty session", () => {
    let store = ensurePhotoChats(emptyChatStore(), "p1");
    const before = store.byPhoto.p1.sessions.length;
    const activeId = store.byPhoto.p1.activeId;
    store = startNewChat(store, "p1");
    expect(store.byPhoto.p1.sessions.length).toBe(before);
    expect(store.byPhoto.p1.activeId).toBe(activeId);
  });

  it("prunes other blank sessions when starting a new chat", () => {
    let store = emptyChatStore();
    store = updateActiveMessages(store, "p1", (m) => [...m, { role: "user", text: "warm this up" }]);
    const filledId = getActiveSession(store, "p1")!.id;
    store = startNewChat(store, "p1");
    const blankId = getActiveSession(store, "p1")!.id;
    // Simulate leftover blank by selecting filled then New again after ensuring blank stays
    store = selectChat(store, "p1", filledId);
    store = {
      byPhoto: {
        p1: {
          activeId: filledId,
          sessions: [
            ...store.byPhoto.p1.sessions,
            createChatSession("p1"), // orphan blank
          ],
        },
      },
    };
    store = startNewChat(store, "p1");
    const sessions = store.byPhoto.p1.sessions;
    expect(sessions.filter(isBlankSession)).toHaveLength(1);
    expect(sessions.some((s) => s.id === filledId)).toBe(true);
    expect(sessions.some((s) => s.id === blankId)).toBe(false);
    expect(isBlankSession(getActiveSession(store, "p1")!)).toBe(true);
  });

  it("ensurePhotoChats is idempotent", () => {
    let store = ensurePhotoChats(emptyChatStore(), "p1");
    const a = getActiveSession(store, "p1")!;
    store = ensurePhotoChats(store, "p1");
    expect(getActiveSession(store, "p1")?.id).toBe(a.id);
  });

  it("titles from the first user message", () => {
    let store = emptyChatStore();
    store = updateActiveMessages(store, "p1", (m) => [
      ...m,
      { role: "user", text: "make the shadows a bit brighter please" },
    ]);
    expect(getActiveSession(store, "p1")?.title).toBe("Lift shadows");
  });

  it("createChatSession sets defaults", () => {
    const s = createChatSession("p9");
    expect(s.photoId).toBe("p9");
    expect(s.messages).toEqual([]);
    expect(s.lastTurnPastLength).toBeNull();
  });
});

describe("generateChatTitle", () => {
  it("strips filler and maps common edit intents", () => {
    expect(cleanPromptForTitle("please can you warm this up")).toMatch(/warm this up/i);
    expect(generateChatTitle([{ role: "user", text: "can you warm this up please" }])).toBe("Warm tones");
    expect(generateChatTitle([{ role: "user", text: "lift the shadows a bit" }])).toBe("Lift shadows");
    expect(generateChatTitle([{ role: "user", text: "darken the sky" }])).toBe("Darken sky");
    expect(generateChatTitle([{ role: "user", text: "convert to black and white" }])).toBe("Black & white");
  });

  it("falls back to cleaned prompt and truncates long titles", () => {
    const long =
      "please nudge the midtones toward a slightly greener cast without crushing the blacks too hard";
    const title = generateChatTitle([{ role: "user", text: long }]);
    expect(title.length).toBeLessThanOrEqual(41);
    expect(title).not.toMatch(/^please/i);
    expect(title.endsWith("…")).toBe(true);
  });

  it("uses tool names when the prompt is generic", () => {
    const title = generateChatTitle([
      { role: "user", text: "fix it" },
      {
        role: "assistant",
        text: "Done",
        steps: [
          { id: "1", kind: "tool", name: "set_exposure" },
          { id: "2", kind: "tool", name: "set_contrast" },
        ],
      },
    ]);
    expect(title).toMatch(/set exposure/i);
  });
});
