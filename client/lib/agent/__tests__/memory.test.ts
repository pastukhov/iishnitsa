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
});
