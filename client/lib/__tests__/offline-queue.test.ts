import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  enqueueChatRequest,
  flushQueuedChatRequests,
  getQueuedChatRequests,
} from "../offline-queue";
import { EndpointConfig, Message } from "../store";

describe("offline-queue", () => {
  const endpoint: EndpointConfig = {
    id: "endpoint",
    name: "Test",
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "key",
    model: "gpt-4",
    systemPrompt: "",
  };

  const messages: Message[] = [
    { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    let storedValue: string | null = null;
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      async () => storedValue,
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (_, value) => {
      storedValue = value as string;
    });
  });

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const payload = (chatId = "chat-1") => ({
    chatId,
    messages,
    endpoint,
    mcpServers: [],
    mcpEnabled: false,
    systemPrompt: "System",
    chatPrompt: "Chat",
    memorySettings: { enabled: false, autoSave: false, autoSummary: false },
  });

  it("retains both concurrently enqueued payloads", async () => {
    await Promise.all([
      enqueueChatRequest(payload("a")),
      enqueueChatRequest(payload("b")),
    ]);
    expect(
      (await getQueuedChatRequests()).map((item) => item.payload.chatId),
    ).toEqual(["a", "b"]);
  });

  it("preserves an enqueue completed while a handler is blocked", async () => {
    await enqueueChatRequest(payload());
    const entered = deferred(),
      release = deferred();
    const flush = flushQueuedChatRequests({
      handler: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    await entered.promise;
    const added = await enqueueChatRequest(payload("new"));
    release.resolve();
    expect(await flush).toEqual({ processed: 1, failed: 0, remaining: 1 });
    expect(await getQueuedChatRequests()).toEqual([added]);
  });

  it("serializes overlapping flushes without executing a successful item twice", async () => {
    await enqueueChatRequest(payload());
    const entered = deferred(),
      release = deferred();
    let executions = 0;
    const first = flushQueuedChatRequests({
      handler: async () => {
        executions++;
        entered.resolve();
        await release.promise;
      },
    });
    await entered.promise;
    const second = flushQueuedChatRequests({
      handler: async () => {
        executions++;
      },
    });
    release.resolve();
    expect(await Promise.all([first, second])).toEqual([
      { processed: 1, failed: 0, remaining: 0 },
      { processed: 0, failed: 0, remaining: 0 },
    ]);
    expect(executions).toBe(1);
  });

  it("keeps each concurrent caller's filter and payload context", async () => {
    await enqueueChatRequest(payload("a"));
    await enqueueChatRequest(payload("b"));
    const handled: object[] = [];
    await Promise.all(
      ["a", "b"].map((chatId) =>
        flushQueuedChatRequests({
          filter: (item) => item.payload.chatId === chatId,
          handler: async (value) => {
            handled.push({ caller: chatId, ...value });
          },
        }),
      ),
    );
    expect(handled).toEqual([
      { caller: "a", ...payload("a") },
      { caller: "b", ...payload("b") },
    ]);
    expect(await getQueuedChatRequests()).toEqual([]);
  });

  it("retains retry state and new enqueues while respecting the success limit", async () => {
    await enqueueChatRequest(payload("retry"));
    await enqueueChatRequest(payload("success"));
    const untouched = await enqueueChatRequest(payload("later"));
    const visited: string[] = [];
    const result = await flushQueuedChatRequests({
      maxItems: 1,
      handler: async (value) => {
        visited.push(value.chatId!);
        if (value.chatId === "retry") {
          await enqueueChatRequest(payload("new"));
          throw new Error("offline");
        }
      },
    });
    expect(result).toEqual({ processed: 1, failed: 1, remaining: 3 });
    expect(visited).toEqual(["retry", "success"]);
    const queued = await getQueuedChatRequests();
    expect(queued[0]).toMatchObject({
      attempts: 1,
      lastError: "offline",
      payload: payload("retry"),
    });
    expect(queued[1]).toEqual(untouched);
    expect(queued[2].payload).toEqual(payload("new"));
  });

  it("does not resurrect successful items if a later filter throws", async () => {
    await enqueueChatRequest(payload("done"));
    await enqueueChatRequest(payload("bad-filter"));
    await expect(
      flushQueuedChatRequests({
        filter: (item) => {
          if (item.payload.chatId === "bad-filter")
            throw new Error("bad filter");
          return true;
        },
        handler: async () => {},
      }),
    ).rejects.toThrow("bad filter");
    expect(
      (await getQueuedChatRequests()).map((item) => item.payload.chatId),
    ).toEqual(["bad-filter"]);
    expect(await flushQueuedChatRequests({ handler: async () => {} })).toEqual({
      processed: 1,
      failed: 0,
      remaining: 0,
    });
  });

  it("recovers storage and flush serialization after a rejected read", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(
      flushQueuedChatRequests({ handler: async () => {} }),
    ).rejects.toThrow("storage unavailable");
    await enqueueChatRequest(payload());
    expect(await flushQueuedChatRequests({ handler: async () => {} })).toEqual({
      processed: 1,
      failed: 0,
      remaining: 0,
    });
  });

  it("enqueues requests and returns them", async () => {
    await enqueueChatRequest({
      chatId: "chat-1",
      messages,
      endpoint,
      mcpServers: [],
      mcpEnabled: false,
    });

    const stored = await getQueuedChatRequests();
    expect(stored).toHaveLength(1);
    expect(stored[0].payload.chatId).toBe("chat-1");
  });

  it("flushes items and retains failures", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([
        {
          id: "q1",
          createdAt: Date.now(),
          attempts: 0,
          payload: {
            chatId: "chat-1",
            messages,
            endpoint,
            mcpServers: [],
            mcpEnabled: false,
          },
        },
        {
          id: "q2",
          createdAt: Date.now(),
          attempts: 0,
          payload: {
            chatId: "chat-2",
            messages,
            endpoint,
            mcpServers: [],
            mcpEnabled: false,
          },
        },
      ]),
    );

    const handler = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Offline"));

    const result = await flushQueuedChatRequests({ handler });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
  });
});
