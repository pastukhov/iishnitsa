import type { ToolPolicyOptions } from "../agent/tool-policy";
import { LLMResponseError } from "../agent/openai-driver";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendChatMessage } from "../api";
import { clearClientCache } from "../mcp-client";
import type { EndpointConfig, MCPServer, Message } from "../store";
import type { ExecutionEvent } from "../agent/execution-trace";

const primary: EndpointConfig = {
  id: "primary-secret",
  name: "primary-secret",
  providerId: "custom",
  baseUrl: "https://primary.invalid/v1",
  apiKey: "primary-key-secret",
  model: "model-secret",
};
const fallback: EndpointConfig = {
  ...primary,
  id: "fallback-secret",
  baseUrl: "https://fallback.invalid/v1",
  apiKey: "fallback-key-secret",
};
const messages: Message[] = [
  { id: "user", role: "user", timestamp: 1, content: "prompt-secret" },
];
const server: MCPServer = {
  id: "counter",
  name: "server-secret",
  url: "https://mcp.invalid",
  token: "mcp-key-secret",
  enabled: true,
};
const toolPolicy: ToolPolicyOptions = {
  registry: [
    { target: { kind: "mcp", name: "increment", server }, risk: "mutating" },
  ],
  requestApproval: (request) => ({ decision: "approve", request }),
};
const memorySettings = { enabled: false, autoSave: false, autoSummary: false };
const transport = global.fetch as jest.Mock;
const response = (
  status = 200,
  message: object = { content: "answer-secret" },
) => ({
  ok: status < 400,
  status,
  headers: new Map(),
  body: null,
  text: async () =>
    JSON.stringify(
      status < 400
        ? { choices: [{ message }] }
        : { error: { message: "error-secret" } },
    ),
});
const terminals = (events: ExecutionEvent[]) =>
  events.filter((e) => e.type === "run_finished");
const send = (
  events: ExecutionEvent[],
  options: object = {},
  servers: MCPServer[] = [],
) =>
  sendChatMessage(messages, primary, jest.fn(), servers, servers.length > 0, {
    memorySettings,
    fallbackEndpoint: fallback,
    onExecutionEvent: (event: ExecutionEvent) => events.push(event),
    ...options,
  });

beforeEach(() => {
  transport.mockReset();
  clearClientCache();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

test("correlates transient failure and fallback success without sharing credentials", async () => {
  const events: ExecutionEvent[] = [];
  transport
    .mockResolvedValueOnce(response(503))
    .mockResolvedValueOnce(response());
  await send(events);
  expect(terminals(events)).toEqual([
    expect.objectContaining({ outcome: "completed" }),
  ]);
  expect(events.filter((e) => e.type === "attempt_started")).toHaveLength(2);
  expect(new Set(events.map((e) => e.runId)).size).toBe(1);
  const attempts = events.filter((e) => e.type === "attempt_finished");
  expect(attempts.map((e) => e.outcome)).toEqual(["failed", "completed"]);
  expect(new Set(attempts.map((e) => e.attemptId)).size).toBe(2);
  expect(
    transport.mock.calls.map(([url, init]) => [
      url,
      init.headers.Authorization,
    ]),
  ).toEqual([
    [
      "https://primary.invalid/v1/chat/completions",
      "Bearer primary-key-secret",
    ],
    [
      "https://fallback.invalid/v1/chat/completions",
      "Bearer fallback-key-secret",
    ],
  ]);
  expect(JSON.stringify(events)).not.toMatch(/secret|https:|\.invalid/);
  expect(events.filter((e) => e.type === "operation_finished")).toEqual([
    expect.objectContaining({
      operation: "llm",
      dispatch: "attempted",
      outcome: "failed",
    }),
    expect.objectContaining({
      operation: "llm",
      dispatch: "attempted",
      outcome: "completed",
    }),
  ]);
});

test.each([429, 502, 503, 504])(
  "permits only explicit transient HTTP %i fallback",
  async (status) => {
    const events: ExecutionEvent[] = [];
    transport
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response());
    await send(events);
    expect(events.filter((e) => e.type === "attempt_finished")).toHaveLength(2);
    expect(terminals(events)[0]).toMatchObject({ outcome: "completed" });
  },
);

test("finishes once when both endpoints fail", async () => {
  const events: ExecutionEvent[] = [];
  transport.mockResolvedValue(response(503));
  await expect(send(events)).rejects.toThrow("error-secret");
  expect(events.filter((e) => e.type === "attempt_finished")).toHaveLength(2);
  expect(terminals(events)).toEqual([
    expect.objectContaining({ outcome: "failed" }),
  ]);
});

test.each([400, 401, 403, 422, 500])(
  "does not fallback for HTTP %i",
  async (status) => {
    const events: ExecutionEvent[] = [];
    transport.mockResolvedValue(response(status));
    await expect(send(events)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(terminals(events)).toEqual([
      expect.objectContaining({ outcome: "failed" }),
    ]);
  },
);

test.each([
  new Error("Failed to fetch"),
  Object.assign(new Error("cancelled"), { name: "AbortError" }),
])(
  "does not fallback on uncertain transport or cancellation",
  async (error) => {
    const events: ExecutionEvent[] = [];
    transport.mockRejectedValue(error);
    await expect(send(events)).rejects.toBe(error);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(terminals(events)).toEqual([
      expect.objectContaining({ outcome: "failed" }),
    ]);
  },
);

test("does not fallback after partial output followed by a broken stream", async () => {
  const events: ExecutionEvent[] = [];
  let read = 0;
  const onChunk = jest.fn();
  transport.mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (read++ === 0)
            return {
              done: false,
              value: new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"partial-secret"}}]}\n\n',
              ),
            };
          throw new Error("Failed to fetch");
        },
      }),
    },
  });
  await expect(
    sendChatMessage(messages, primary, onChunk, [], false, {
      memorySettings,
      fallbackEndpoint: fallback,
      onExecutionEvent: (e) => events.push(e),
    }),
  ).rejects.toThrow("Failed to fetch");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(terminals(events)).toHaveLength(1);
  expect(onChunk).toHaveBeenCalledWith("partial-secret");
});

test("single-endpoint calls retain queue behavior and report queued instead of success", async () => {
  const events: ExecutionEvent[] = [];
  transport.mockRejectedValue(new Error("Failed to fetch"));
  await send(events, { fallbackEndpoint: undefined, queueOnFailure: true });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(terminals(events)).toEqual([
    expect.objectContaining({ outcome: "queued" }),
  ]);
  const stored = (AsyncStorage.setItem as jest.Mock).mock.calls
    .map(([, value]) => value)
    .join();
  expect(stored).not.toMatch(/fallback-key-secret|runId|attemptId/);
});

test("keeps concurrent logical runs independent even when they finish in reverse order", async () => {
  const first: ExecutionEvent[] = [],
    second: ExecutionEvent[] = [];
  let release!: (value: ReturnType<typeof response>) => void;
  transport
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValueOnce(response());
  const one = send(first);
  await send(second);
  expect(terminals(first)).toHaveLength(0);
  expect(terminals(second)).toHaveLength(1);
  release(response());
  await one;
  expect(terminals(first)).toHaveLength(1);
  expect(first[0].runId).not.toBe(second[0].runId);
  expect(first.every((e) => e.runId === first[0].runId)).toBe(true);
});

test("observer exceptions cannot prevent fallback or change its response", async () => {
  transport
    .mockResolvedValueOnce(response(503))
    .mockResolvedValueOnce(response());
  await expect(
    send([], {
      onExecutionEvent: () => {
        throw new Error("observer-secret");
      },
    }),
  ).resolves.toBeUndefined();
  expect(transport).toHaveBeenCalledTimes(2);
});

test.each(["unknown", "completed"])(
  "keeps replay blocked after %s MCP outcome",
  async (outcome) => {
    const events: ExecutionEvent[] = [];
    let llmCalls = 0,
      toolCalls = 0;
    transport.mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      if (url === server.url) {
        if (body.method === "notifications/initialized") return { ok: true };
        let result: object = {};
        if (body.method === "tools/list")
          result = {
            tools: [
              {
                name: "increment",
                description: "tool-secret",
                inputSchema: { type: "object" },
              },
            ],
          };
        if (body.method === "tools/call") {
          toolCalls++;
          if (outcome === "unknown") throw new Error("Failed to fetch: secret");
          result = { content: [{ type: "text", text: "tool-result-secret" }] };
        }
        return {
          ok: true,
          headers: new Map(),
          text: async () =>
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
        };
      }
      llmCalls++;
      return llmCalls === 1
        ? response(200, {
            tool_calls: [
              {
                id: "call-secret",
                type: "function",
                function: {
                  name: "counter__increment",
                  arguments: '{"secret":"tool-args-secret"}',
                },
              },
            ],
          })
        : response(503);
    });
    await expect(send(events, { toolPolicy }, [server])).rejects.toThrow(
      "Automatic replay stopped",
    );
    expect(toolCalls).toBe(1);
    expect(events.filter((e) => e.type === "attempt_started")).toHaveLength(1);
    expect(
      events.filter(
        (e) => e.type === "operation_finished" && e.operation === "mcp",
      ),
    ).toEqual([expect.objectContaining({ dispatch: "attempted", outcome })]);
    expect(terminals(events)).toEqual([
      expect.objectContaining({ outcome: "failed" }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret|\.invalid/);
  },
);

test("does not retry a typed transient failure thrown after delivering a chunk", async () => {
  const events: ExecutionEvent[] = [];
  transport.mockResolvedValue({
    ok: true,
    body: null,
    text: async () =>
      'data: {"choices":[{"delta":{"content":"partial-secret"}}]}\n\ndata: [DONE]\n\n',
  });
  await expect(
    sendChatMessage(
      messages,
      primary,
      () => {
        throw new LLMResponseError("callback-secret", 503);
      },
      [],
      false,
      {
        memorySettings,
        fallbackEndpoint: fallback,
        onExecutionEvent: (e) => events.push(e),
      },
    ),
  ).rejects.toThrow("callback-secret");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(terminals(events)).toEqual([
    expect.objectContaining({ outcome: "failed" }),
  ]);
});

test("no fallback is selected unless the caller explicitly configures it", async () => {
  const events: ExecutionEvent[] = [];
  transport.mockResolvedValue(response(503));
  await expect(send(events, { fallbackEndpoint: undefined })).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(terminals(events)).toHaveLength(1);
});

test("includes the optional memory-summary LLM call in the same attempt", async () => {
  const events: ExecutionEvent[] = [];
  transport
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response(200, { content: "summary-secret" }));
  await sendChatMessage(
    [
      ...messages,
      { id: "other", role: "user", timestamp: 2, content: "more-secret" },
    ],
    primary,
    jest.fn(),
    [],
    false,
    {
      memorySettings: { enabled: true, autoSave: false, autoSummary: true },
      onExecutionEvent: (e) => events.push(e),
    },
  );
  const operations = events.filter((e) => e.type === "operation_finished");
  expect(operations).toHaveLength(2);
  expect(new Set(operations.map((e) => e.attemptId)).size).toBe(1);
  expect(terminals(events)).toEqual([
    expect.objectContaining({ outcome: "completed" }),
  ]);
  expect(JSON.stringify(events)).not.toContain("secret");
});

test("unknown tool is denied without dispatch and its status output prevents fallback", async () => {
  const events: ExecutionEvent[] = [];
  transport
    .mockResolvedValueOnce(
      response(200, {
        tool_calls: [
          {
            id: "call-secret",
            type: "function",
            function: { name: "missing__tool", arguments: "{}" },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(response(503));
  await expect(send(events)).rejects.toThrow("error-secret");
  expect(events.filter((e) => e.type === "attempt_started")).toHaveLength(1);
  expect(
    events.filter(
      (e) => e.type === "operation_finished" && e.operation === "mcp",
    ),
  ).toEqual([
    expect.objectContaining({ dispatch: "not_dispatched", outcome: "denied" }),
  ]);
  expect(terminals(events)).toHaveLength(1);
  expect(transport).toHaveBeenCalledTimes(2);
});

test.each(["discovery", "summary"])(
  "does not expose %s errors through console diagnostics",
  async (phase) => {
    const warn = jest.spyOn(console, "warn").mockImplementation();
    const error = jest.spyOn(console, "error").mockImplementation();
    try {
      const events: ExecutionEvent[] = [];
      if (phase === "discovery") {
        transport.mockImplementation(async (url) => {
          if (url === server.url)
            throw new Error("https://private.invalid/credential-secret");
          return response();
        });
        await send(events, {}, [server]);
      } else {
        transport
          .mockResolvedValueOnce(response())
          .mockRejectedValueOnce(new Error("summary-payload-secret"));
        await sendChatMessage(
          [
            ...messages,
            { id: "second", role: "user", timestamp: 2, content: "other" },
          ],
          primary,
          jest.fn(),
          [],
          false,
          {
            memorySettings: {
              enabled: true,
              autoSave: false,
              autoSummary: true,
            },
            onExecutionEvent: (e) => events.push(e),
          },
        );
      }
      expect(terminals(events)).toHaveLength(1);
      expect(
        JSON.stringify(
          [...warn.mock.calls, ...error.mock.calls],
          (_key, value) => (value instanceof Error ? value.message : value),
        ),
      ).not.toMatch(/secret|\.invalid/);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  },
);
