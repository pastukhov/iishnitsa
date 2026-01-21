import AsyncStorage from "@react-native-async-storage/async-storage";
import { MemoryStore } from "../memory";

describe("MemoryStore", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  it("adds memory entries and persists them", async () => {
    const store = new MemoryStore();

    const memory = await store.addMemory({
      type: "fact",
      content: "User likes espresso",
      importance: 0.8,
    });

    expect(memory.id).toMatch(/^mem_/);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "@ai_agent_memory",
      expect.stringContaining("User likes espresso"),
    );
  });

  it("filters out expired memories", async () => {
    const now = Date.now();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([
        {
          id: "expired",
          type: "fact",
          content: "Old",
          importance: 0.9,
          createdAt: now - 10000,
          lastAccessedAt: now - 10000,
          ttlMs: 1000,
        },
        {
          id: "fresh",
          type: "fact",
          content: "Fresh",
          importance: 0.9,
          createdAt: now,
          lastAccessedAt: now,
          ttlMs: 100000,
        },
      ]),
    );

    const store = new MemoryStore();
    const memories = await store.getRelevantMemories({ limit: 10 });

    expect(memories).toHaveLength(1);
    expect(memories[0].id).toBe("fresh");
  });

  it("lists memories sorted and excludes expired entries", async () => {
    const now = Date.now();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([
        {
          id: "old",
          type: "fact",
          content: "Old",
          importance: 0.4,
          createdAt: now - 5000,
          lastAccessedAt: now - 5000,
          ttlMs: 1000,
        },
        {
          id: "newer",
          type: "task",
          content: "Newer",
          importance: 0.9,
          createdAt: now - 1000,
          lastAccessedAt: now - 1000,
        },
        {
          id: "newest",
          type: "user",
          content: "Newest",
          importance: 0.7,
          createdAt: now,
          lastAccessedAt: now,
        },
      ]),
    );

    const store = new MemoryStore();
    const memories = await store.listMemories();

    expect(memories.map((entry) => entry.id)).toEqual(["newest", "newer"]);
  });

  it("filters memories by type and importance", async () => {
    const now = Date.now();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([
        {
          id: "pref",
          type: "user",
          content: "Pref",
          importance: 0.7,
          createdAt: now,
          lastAccessedAt: now,
        },
        {
          id: "fact",
          type: "fact",
          content: "Fact",
          importance: 0.4,
          createdAt: now,
          lastAccessedAt: now,
        },
      ]),
    );

    const store = new MemoryStore();
    const memories = await store.getRelevantMemories({
      limit: 10,
      minImportance: 0.6,
      types: ["user"],
    });

    expect(memories).toHaveLength(1);
    expect(memories[0].id).toBe("pref");
  });
});
