import { describe, expect, it } from "vitest";
import {
  createChatSession,
  emptyChatStore,
  ensurePhotoChats,
  getActiveSession,
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
    expect(getActiveSession(store, "p1")?.title).toMatch(/make the shadows/);
  });

  it("createChatSession sets defaults", () => {
    const s = createChatSession("p9");
    expect(s.photoId).toBe("p9");
    expect(s.messages).toEqual([]);
    expect(s.lastTurnPastLength).toBeNull();
  });
});
