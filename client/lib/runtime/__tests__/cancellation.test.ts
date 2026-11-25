import { MemoryStore } from "../../agent/memory";
import { AgentCore } from "../../agent/core";
import { executeToolCall, clearClientCache } from "../../mcp-client";
import { sendChatMessage } from "../../api";
import { OpenAICompatibleDriver } from "../../agent/openai-driver";
import { RunCancelledError } from "../cancellation";
import type { EndpointConfig } from "../../store";
const endpoint: EndpointConfig = {
  providerId: "custom",
  baseUrl: "https://fake.invalid",
  apiKey: "fake",
  model: "fake",
};
const fetchMock = global.fetch as jest.Mock;
const memorySettings = { enabled: false, autoSave: false, autoSummary: false };
beforeEach(() => fetchMock.mockReset());
it("cancels before dispatch without queue or fallback", async () => {
  const controller = new AbortController();
  controller.abort("private-reason");
  const queued = jest.fn();
  await expect(
    sendChatMessage([], endpoint, jest.fn(), [], false, {
      signal: controller.signal,
      fallbackEndpoint: endpoint,
      queueOnFailure: true,
      onQueued: queued,
      memorySettings,
    }),
  ).rejects.toBeInstanceOf(RunCancelledError);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(queued).not.toHaveBeenCalled();
});
it("aborts pending fetch with a static error", async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new Error("private-reason")),
        ),
      ),
  );
  const run = new OpenAICompatibleDriver().streamChat({
    endpoint,
    messages: [],
    tools: [],
    onChunk: jest.fn(),
    signal: controller.signal,
  });
  controller.abort("private-reason");
  await expect(run).rejects.toEqual(new RunCancelledError());
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it("cancels pending reader and releases its lock", async () => {
  const controller = new AbortController();
  const cancel = jest.fn().mockResolvedValue(undefined);
  const releaseLock = jest.fn();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  fetchMock.mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: () => {
          started();
          return new Promise(() => {});
        },
        cancel,
        releaseLock,
      }),
    },
  });
  const run = new OpenAICompatibleDriver().streamChat({
    endpoint,
    messages: [],
    tools: [],
    onChunk: jest.fn(),
    signal: controller.signal,
  });
  await reading;
  controller.abort();
  await expect(run).rejects.toBeInstanceOf(RunCancelledError);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(releaseLock).toHaveBeenCalledTimes(1);
});
it("cancellation in chunk callback cannot queue or fallback", async () => {
  const controller = new AbortController();
  const queued = jest.fn();
  fetchMock.mockResolvedValue({
    ok: true,
    body: null,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: "reply" } }] }),
  });
  await expect(
    sendChatMessage([], endpoint, () => controller.abort(), [], false, {
      signal: controller.signal,
      fallbackEndpoint: endpoint,
      queueOnFailure: true,
      onQueued: queued,
      memorySettings,
    }),
  ).rejects.toBeInstanceOf(RunCancelledError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(queued).not.toHaveBeenCalled();
});

it("cancels during approval and does not execute the builtin or persist memory", async () => {
  const controller = new AbortController();
  let requested!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const driver = {
    streamChat: jest.fn().mockResolvedValue({
      fullContent: "",
      toolCalls: [
        {
          id: "one",
          type: "function",
          function: {
            name: "generate_image",
            arguments: '{"prompt":"circle"}',
          },
        },
      ],
    }),
  };
  const attempted = jest.fn();
  const run = new AgentCore({
    driver: driver as any,
    memoryEnabled: false,
  }).runChat({
    messages: [],
    endpoint,
    onChunk: jest.fn(),
    mcpServers: [],
    mcpEnabled: false,
    signal: controller.signal,
    onToolExecutionAttempt: attempted,
    toolPolicy: {
      registry: [
        {
          target: { kind: "builtin", name: "generate_image", endpoint },
          risk: "mutating",
        },
      ],
      requestApproval: () => {
        requested();
        return new Promise(() => {});
      },
    },
  });
  await requestStarted;
  controller.abort();
  await expect(run).rejects.toBeInstanceOf(RunCancelledError);
  expect(attempted).not.toHaveBeenCalled();
  expect(driver.streamChat).toHaveBeenCalledTimes(1);
});
it("retains the caller policy cancellation signal", async () => {
  const controller = new AbortController();
  const policyController = new AbortController();
  policyController.abort();
  const driver = {
    streamChat: jest
      .fn()
      .mockResolvedValueOnce({
        fullContent: "",
        toolCalls: [
          {
            id: "one",
            type: "function",
            function: {
              name: "generate_image",
              arguments: '{"prompt":"circle"}',
            },
          },
        ],
      })
      .mockResolvedValueOnce({ fullContent: "denied", toolCalls: [] }),
  };
  const approval = jest.fn();
  const attempted = jest.fn();
  await new AgentCore({ driver: driver as any, memoryEnabled: false }).runChat({
    messages: [],
    endpoint,
    onChunk: jest.fn(),
    mcpServers: [],
    mcpEnabled: false,
    signal: controller.signal,
    onToolExecutionAttempt: attempted,
    toolPolicy: {
      registry: [
        {
          target: { kind: "builtin", name: "generate_image", endpoint },
          risk: "mutating",
        },
      ],
      signal: policyController.signal,
      requestApproval: approval,
    },
  });
  expect(approval).not.toHaveBeenCalled();
  expect(attempted).not.toHaveBeenCalled();
});
it.each(["initialization", "tool"])(
  "cancels MCP during %s without a later dispatch",
  async (phase) => {
    clearClientCache();
    const controller = new AbortController();
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const methods: string[] = [];
    const boundary = { dispatched: jest.fn(), finish: jest.fn() };
    fetchMock.mockImplementation(async (_url, options) => {
      const rpc = JSON.parse(options.body);
      methods.push(rpc.method);
      if (
        (phase === "initialization" && rpc.method === "initialize") ||
        (phase === "tool" && rpc.method === "tools/call")
      ) {
        started();
        return new Promise(() => {});
      }
      return {
        ok: true,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ id: rpc.id, result: {} }),
      };
    });
    const run = executeToolCall(
      { id: "fake", name: "fake", url: "https://mcp.invalid", enabled: true },
      "fake",
      {},
      boundary,
      undefined,
      controller.signal,
    );
    await pending;
    controller.abort("private");
    await expect(run).rejects.toBeInstanceOf(RunCancelledError);
    expect(boundary.dispatched).toHaveBeenCalledTimes(phase === "tool" ? 1 : 0);
    expect(boundary.finish.mock.calls).toEqual([
      [phase === "tool" ? "unknown" : "failed"],
    ]);
    expect(methods.filter((method) => method === "tools/call")).toHaveLength(
      phase === "tool" ? 1 : 0,
    );
  },
);
it("cancels slow context retrieval and never dispatches after it resolves", async () => {
  const controller = new AbortController();
  let resolveContext!: (entries: never[]) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const getRelevantMemories = jest.fn(() => {
    started();
    return new Promise<never[]>((resolve) => {
      resolveContext = resolve;
    });
  });
  const driver = { streamChat: jest.fn() };
  const run = new AgentCore({
    driver: driver as any,
    memoryStore: { getRelevantMemories } as any,
  }).runChat({
    messages: [
      { id: "user", role: "user", content: "hello", timestamp: "fake" },
    ],
    endpoint,
    onChunk: jest.fn(),
    mcpEnabled: false,
    mcpServers: [],
    signal: controller.signal,
    memoryScope: { accountId: "fake-account", chatId: "fake-chat" },
  });
  await entered;
  controller.abort();
  await expect(run).rejects.toBeInstanceOf(RunCancelledError);
  resolveContext([]);
  await Promise.resolve();
  await Promise.resolve();
  expect(driver.streamChat).not.toHaveBeenCalled();
});
it("cancellation after a reply prevents explicit and summary writes", async () => {
  const controller = new AbortController();
  const addMemory = jest.fn();
  const getRelevantMemories = jest.fn().mockResolvedValue([]);
  fetchMock.mockResolvedValue({
    ok: true,
    body: null,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: "reply" } }] }),
  });
  await expect(
    sendChatMessage(
      [
        {
          id: "user",
          role: "user",
          content: "remember circle",
          timestamp: "fake",
        },
      ],
      endpoint,
      () => controller.abort(),
      [],
      false,
      {
        signal: controller.signal,
        memoryScope: { accountId: "account", chatId: "chat" },
        memoryStore: { addMemory, getRelevantMemories } as any,
        memorySettings: { enabled: true, autoSave: true, autoSummary: true },
      },
    ),
  ).rejects.toBeInstanceOf(RunCancelledError);
  expect(addMemory).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each(["temporary", "network"])(
  "does not fallback or enqueue after cancelled %s error",
  async (kind) => {
    const controller = new AbortController();
    const queued = jest.fn();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      if (kind === "network") throw new Error("Network request failed");
      return { ok: false, status: 503, text: async () => "temporary" };
    });
    await expect(
      sendChatMessage([], endpoint, jest.fn(), [], false, {
        signal: controller.signal,
        fallbackEndpoint: endpoint,
        queueOnFailure: true,
        onQueued: queued,
        memorySettings,
      }),
    ).rejects.toBeInstanceOf(RunCancelledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queued).not.toHaveBeenCalled();
  },
);
it.each(["primary-read", "legacy-backup-read", "serial-queue"])(
  "does not commit memory cancelled during %s",
  async (phase) => {
    const controller = new AbortController();
    let release!: (value: string | null) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    const storage = {
      getItem: jest.fn(async (key: string): Promise<string | null> => {
        if (phase === "legacy-backup-read" && key === "@ai_agent_memory")
          return "[]";
        entered();
        return paused;
      }),
      setItem: jest.fn().mockResolvedValue(undefined),
    };
    const store = new MemoryStore(storage);
    let blocker: Promise<unknown> | undefined;
    const scope = { accountId: "account", chatId: "chat" };
    if (phase === "serial-queue") blocker = store.listMemories(scope);
    const write = store.addMemory(
      {
        scope,
        provenance: { source: "explicit", sourceId: "source" },
        type: "fact",
        content: "circle",
        importance: 1,
      },
      controller.signal,
    );
    await waiting;
    controller.abort();
    release(null);
    await blocker;
    await expect(write).rejects.toBeInstanceOf(RunCancelledError);
    expect(storage.setItem).not.toHaveBeenCalled();
  },
);
it.each(["explicit", "summary"])(
  "does not write a late %s memory after the core run is cancelled",
  async (source) => {
    const controller = new AbortController();
    let release!: (value: null) => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let reads = 0;
    const storage = {
      getItem: jest.fn(async () => {
        if (++reads === 2) {
          entered();
          return new Promise<null>((resolve) => {
            release = resolve;
          });
        }
        return null;
      }),
      setItem: jest.fn().mockResolvedValue(undefined),
    };
    const memoryStore = new MemoryStore(storage);
    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValue({ fullContent: "reply", toolCalls: [] }),
    };
    const scope = { accountId: "account", chatId: "chat" };
    const run = new AgentCore({
      driver: driver as any,
      memoryStore,
      memoryAutoSave: source === "explicit",
      memoryAutoSummary: source === "summary",
    }).runChat({
      messages: [
        { id: "prior", role: "assistant", content: "hello", timestamp: "fake" },
        {
          id: "user",
          role: "user",
          content: "remember circle",
          timestamp: "fake",
        },
      ],
      endpoint,
      onChunk: jest.fn(),
      mcpEnabled: false,
      mcpServers: [],
      memoryScope: scope,
      signal: controller.signal,
    });
    await pending;
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(RunCancelledError);
    release(null);
    await memoryStore.listMemories(scope);
    expect(storage.setItem).not.toHaveBeenCalled();
  },
);
