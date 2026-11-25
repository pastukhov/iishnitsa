import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendChatMessage, flushQueuedChatMessages } from "../api";
import { getQueuedChatRequests } from "../offline-queue";
import { MemoryStore, type MemoryScope } from "../agent/memory";
import { createSkillRegistry, createSkillSession } from "../skill-registry";
import { useChatStore, type EndpointConfig, type Message } from "../store";
import type { ExecutionEvent } from "../agent/execution-trace";

const scopeA: MemoryScope = { accountId: "account-a", chatId: "chat" };
const scopeB: MemoryScope = { accountId: "account-b", chatId: "chat" };
const endpoint: EndpointConfig = {
  providerId: "custom",
  baseUrl: "https://memory.invalid",
  apiKey: "fake",
  model: "fixture",
};
const messages: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "A fixture question",
    timestamp: "2026-11-25T00:00:00Z",
  },
];
const settings = {
  enabled: true,
  autoSave: true,
  autoSummary: false,
  limit: 8,
  minImportance: 0,
};
const transport = global.fetch as jest.Mock;
let data: Map<string, string>;
const result = () => ({
  ok: true,
  status: 200,
  headers: new Map(),
  body: null,
  text: async () =>
    JSON.stringify({ choices: [{ message: { content: "Fixture answer" } }] }),
});
function send(
  memoryScope?: MemoryScope,
  extra: Partial<NonNullable<Parameters<typeof sendChatMessage>[5]>> = {},
  input = messages,
) {
  return sendChatMessage(input, endpoint, jest.fn(), [], false, {
    memoryScope,
    memorySettings: settings,
    systemPrompt: "Trusted base",
    queueOnFailure: true,
    chatId: "chat",
    ...extra,
  });
}
async function remember(scope: MemoryScope, content: string) {
  return new MemoryStore().addMemory({
    scope,
    provenance: { source: "import", sourceId: "fixture" },
    type: "fact",
    content,
    importance: 0.8,
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  data = new Map();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(
    async (key) => data.get(key) ?? null,
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key, value) => {
    data.set(key, value);
  });
  transport.mockReset().mockResolvedValue(result());
});

test("real chat retrieves only explicit scope and inserts reference as user data", async () => {
  await remember(scopeA, "only-account-a");
  await remember(scopeB, "only-account-b");
  const events: ExecutionEvent[] = [];
  await send(scopeA, { onExecutionEvent: (event) => events.push(event) });
  const wire = JSON.parse(transport.mock.calls[0][1].body);
  expect(
    wire.messages.filter((m: { role: string }) => m.role === "system"),
  ).toEqual([{ role: "system", content: "Trusted base" }]);
  expect(
    wire.messages.find((m: { content: string }) =>
      m.content.includes("only-account-a"),
    ).role,
  ).toBe("user");
  expect(JSON.stringify(wire)).not.toContain("only-account-b");
  expect(JSON.stringify(events)).not.toMatch(/only-account|account-a/);
});

test("missing scope neither reads legacy data nor creates implicit memories", async () => {
  data.set(
    "@ai_agent_memory",
    JSON.stringify([
      {
        id: "legacy",
        type: "user",
        content: "legacy-marker",
        importance: 1,
        createdAt: 1,
        lastAccessedAt: 1,
      },
    ]),
  );
  await send(undefined, {}, [
    { ...messages[0], content: "remember new-marker" },
  ]);
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(transport.mock.calls[0][1].body).not.toContain("legacy-marker");
});

test("scoped chat quarantines real legacy data and saves explicit provenance once", async () => {
  const legacy = JSON.stringify([
    {
      id: "old",
      type: "fact",
      content: "old-secret",
      importance: 0.7,
      createdAt: 1,
      lastAccessedAt: 1,
    },
  ]);
  data.set("@ai_agent_memory", legacy);
  await send(scopeA, {}, [{ ...messages[0], content: "remember new-marker" }]);
  const store = new MemoryStore();
  const found = await store.listMemories(scopeA);
  expect(found).toHaveLength(1);
  expect(found[0]).toEqual(
    expect.objectContaining({
      content: "new-marker",
      scope: scopeA,
      provenance: { source: "explicit", sourceId: "user-1" },
    }),
  );
  expect(await store.exportLegacy()).toBe(legacy);
  expect(transport.mock.calls[0][1].body).not.toContain("old-secret");
  await send(scopeA, {}, [{ ...messages[0], content: "remember new-marker" }]);
  expect(await store.listMemories(scopeA)).toHaveLength(1);
});

test("concurrent chat runs snapshot scope before callbacks and preserve both writes", async () => {
  const mutable = { ...scopeA };
  await Promise.all([
    send(
      mutable,
      {
        onDecision: () => {
          mutable.accountId = "account-b";
        },
      },
      [{ ...messages[0], content: "remember first-marker" }],
    ),
    send(scopeB, {}, [{ ...messages[0], content: "remember second-marker" }]),
  ]);
  expect(
    (await new MemoryStore().listMemories(scopeA)).map((x) => x.content),
  ).toEqual(["first-marker"]);
  expect(
    (await new MemoryStore().listMemories(scopeB)).map((x) => x.content),
  ).toEqual(["second-marker"]);
});

test("autosave storage failure is reported without replaying a successful chat", async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValue(
    new Error("Network request failed private-detail"),
  );
  const onMemoryError = jest.fn();
  await send(scopeA, { onMemoryError }, [
    { ...messages[0], content: "remember a fixture" },
  ]);
  expect(onMemoryError).toHaveBeenCalledWith("memory_write_failed");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(data.has("@ai_agent_offline_queue")).toBe(false);
});

test("throwing memory-error observer cannot cause queue replay", async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValue(
    new Error("write failure"),
  );
  await send(
    scopeA,
    {
      onMemoryError: () => {
        throw new Error("Failed to fetch");
      },
    },
    [{ ...messages[0], content: "remember a fixture" }],
  );
  expect(transport).toHaveBeenCalledTimes(1);
  expect(data.has("@ai_agent_offline_queue")).toBe(false);
});

test("queued request retains scope and cannot replay under a different account", async () => {
  transport.mockRejectedValueOnce(new Error("Network request failed"));
  await send(scopeA);
  expect((await getQueuedChatRequests())[0].payload.memoryScope).toEqual(
    scopeA,
  );
  transport.mockClear();
  expect(
    await flushQueuedChatMessages({
      memoryScope: scopeB,
      chatId: "chat",
      onChunk: jest.fn(),
    }),
  ).toEqual({ processed: 0, failed: 0, remaining: 1 });
  expect(transport).not.toHaveBeenCalled();
  expect(
    await flushQueuedChatMessages({
      memoryScope: scopeA,
      chatId: "chat",
      onChunk: jest.fn(),
    }),
  ).toEqual({ processed: 1, failed: 0, remaining: 0 });
  expect(transport).toHaveBeenCalledTimes(1);
});

test("legacy unscoped queue does not inherit a selected scope", async () => {
  transport.mockRejectedValueOnce(new Error("Network request failed"));
  await send();
  transport.mockClear();
  expect(
    await flushQueuedChatMessages({ memoryScope: scopeA, onChunk: jest.fn() }),
  ).toEqual({ processed: 0, failed: 0, remaining: 1 });
  expect(transport).not.toHaveBeenCalled();
});

test("skill-activated scoped chat still excludes memory and queue", async () => {
  const registry = createSkillRegistry();
  registry.import(
    "---\nschema_version: 1\nname: fixture\nversion: 1.0.0\ndescription: Fixture\nsurface: chat\ntrust: untrusted\n---\nReference marker",
  );
  const session = createSkillSession("chat");
  const activation = registry.activate(session, [
    { name: "fixture", version: "1.0.0" },
  ]);
  transport.mockRejectedValueOnce(new Error("Network request failed"));
  await expect(
    send(scopeA, { skillContext: { session, activation, surface: "chat" } }),
  ).rejects.toThrow("Network request failed");
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test("invalid scope fails before transport or queue", async () => {
  await expect(send({ accountId: "", chatId: "chat" })).rejects.toThrow(
    "Memory storage operation failed",
  );
  expect(transport).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test("storage read failure cannot become network retry or leak details", async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
    new Error("Network request failed private-storage"),
  );
  await expect(send(scopeA)).rejects.toThrow("Memory storage operation failed");
  expect(transport).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test("summary retains its originating scope and provenance", async () => {
  await send(
    scopeA,
    {
      memorySettings: { ...settings, autoSave: false, autoSummary: true },
    },
    [{ ...messages[0], id: "earlier", role: "assistant" }, ...messages],
  );
  expect(transport).toHaveBeenCalledTimes(2);
  expect(await new MemoryStore().listMemories(scopeA)).toEqual([
    expect.objectContaining({
      scope: scopeA,
      provenance: { source: "summary", sourceId: "user-1" },
      content: "Fixture answer",
    }),
  ]);
  expect(await new MemoryStore().listMemories(scopeB)).toEqual([]);
});

describe.each([false, true])(
  "legacy memory limit (populated=%s)",
  (populated) => {
    test.each([101, 500])(
      "normalizes %s before real provider request",
      async (limit) => {
        if (populated) await remember(scopeA, "scoped fixture");
        const read = jest.spyOn(MemoryStore.prototype, "getRelevantMemories");
        try {
          await send(scopeA, { memorySettings: { ...settings, limit } });
          expect(read).toHaveBeenCalledWith(
            expect.objectContaining({ scope: scopeA, limit: 100 }),
          );
          expect(transport).toHaveBeenCalledTimes(1);
        } finally {
          read.mockRestore();
        }
      },
    );
  },
);

test.each([
  [1, 1],
  [100, 100],
  [0, 1],
  [-3, 1],
  [4.9, 4],
  [NaN, 8],
  [Infinity, 8],
])(
  "normalizes configured limit %s to %s through real chat",
  async (limit, expected) => {
    const read = jest.spyOn(MemoryStore.prototype, "getRelevantMemories");
    try {
      await send(scopeA, { memorySettings: { ...settings, limit } });
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ limit: expected }),
      );
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
  },
);

test("legacy queued limit is normalized on replay without changing payload or scope", async () => {
  transport.mockRejectedValueOnce(new Error("Network request failed"));
  await send(scopeA, { memorySettings: { ...settings, limit: 101 } });
  const [queued] = await getQueuedChatRequests();
  expect(queued.payload.memorySettings?.limit).toBe(101);
  const read = jest.spyOn(MemoryStore.prototype, "getRelevantMemories");
  try {
    expect(
      await flushQueuedChatMessages({
        memoryScope: scopeA,
        chatId: "chat",
        onChunk: jest.fn(),
      }),
    ).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ scope: scopeA, limit: 100 }),
    );
    expect(queued.payload.memorySettings?.limit).toBe(101);
  } finally {
    read.mockRestore();
  }
});

test.each([true, false])(
  "invalid persisted namespace allows normal chat (memory enabled=%s)",
  async (enabled) => {
    data.set(
      "@ai_agent_settings",
      JSON.stringify({
        memoryAccountId: "x".repeat(129),
        memoryEnabled: enabled,
      }),
    );
    await useChatStore.getState().loadFromStorage();
    const selected = useChatStore.getState().settings;
    expect(selected.memoryAccountId).toBe("");
    const read = jest.spyOn(MemoryStore.prototype, "getRelevantMemories");
    try {
      await send(
        selected.memoryAccountId
          ? { accountId: selected.memoryAccountId, chatId: "chat" }
          : undefined,
        { memorySettings: { ...settings, enabled } },
        [{ ...messages[0], content: "remember fixture" }],
      );
      expect(transport).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
      expect(data.has("@ai_agent_memory")).toBe(false);
    } finally {
      read.mockRestore();
    }
  },
);
