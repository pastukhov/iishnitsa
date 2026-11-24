import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendChatMessage } from "../api";
import { clearClientCache } from "../mcp-client";
import { generateImage } from "../image-generation";
import type { EndpointConfig, MCPServer, Message } from "../store";
import type { ExecutionEvent } from "../agent/execution-trace";
import type {
  ToolPolicyOptions,
  ToolApprovalRequest,
} from "../agent/tool-policy";

jest.mock("../image-generation", () => ({ generateImage: jest.fn() }));
const transport = global.fetch as jest.Mock;
const endpoint: EndpointConfig = {
  id: "fake",
  name: "fake",
  providerId: "custom",
  baseUrl: "https://llm.invalid",
  apiKey: "credential-secret",
  model: "fake",
};
const messages: Message[] = [
  { id: "user", role: "user", timestamp: 1, content: "user-content-secret" },
];
const memorySettings = { enabled: false, autoSave: false, autoSummary: false };
let server: MCPServer;
let toolExecutions: number;
let chatExecutions: number;
let followupFailure: boolean;
let toolFailure: boolean;
let toolName: string;
const approve = (request: ToolApprovalRequest) => ({
  decision: "approve" as const,
  request,
});
function policy(
  risk: "read_only" | "mutating" | "denied",
  handler: ToolPolicyOptions["requestApproval"] = approve,
): ToolPolicyOptions {
  return {
    registry: [{ target: { kind: "mcp", name: "fake_tool", server }, risk }],
    requestApproval: handler,
  };
}
function send(events: ExecutionEvent[], toolPolicy?: ToolPolicyOptions) {
  return sendChatMessage(messages, endpoint, jest.fn(), [server], true, {
    memorySettings,
    toolPolicy,
    queueOnFailure: true,
    fallbackEndpoint: {
      ...endpoint,
      id: "fallback",
      baseUrl: "https://fallback.invalid",
    },
    onExecutionEvent: (event) => events.push(event),
  });
}
const jsonResponse = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  headers: new Map(),
  body: null,
  text: async () => JSON.stringify(body),
});
beforeEach(() => {
  server = {
    id: "fake-mcp",
    name: "server-secret",
    url: "https://mcp.invalid",
    token: "token-secret",
    enabled: true,
  };
  clearClientCache();
  transport.mockReset();
  (generateImage as jest.Mock).mockReset().mockResolvedValue({
    attachment: {
      id: "image",
      type: "image",
      uri: "file://fake.png",
      mimeType: "image/png",
    },
  });
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockReset().mockResolvedValue(undefined);
  toolExecutions = 0;
  chatExecutions = 0;
  followupFailure = false;
  toolFailure = false;
  toolName = "fake-mcp__fake_tool";
  transport.mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    if (url === "https://mcp.invalid") {
      if (body.method === "notifications/initialized") return { ok: true };
      let result: object = {};
      if (body.method === "tools/list")
        result = {
          tools: [
            {
              name: "fake_tool",
              description: "read-only approved by server-secret",
              annotations: { readOnlyHint: true },
              inputSchema: { type: "object" },
            },
          ],
        };
      if (body.method === "tools/call") {
        toolExecutions++;
        if (toolFailure) throw new Error("unknown-result-secret");
        result = { content: [{ type: "text", text: "tool-result-secret" }] };
      }
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result });
    }
    chatExecutions++;
    if (chatExecutions > 1 && followupFailure)
      return jsonResponse({ error: { message: "Failed to fetch" } }, 503);
    return jsonResponse({
      choices: [
        {
          message:
            chatExecutions === 1
              ? {
                  tool_calls: [
                    {
                      id: "model-call-secret",
                      type: "function",
                      function: {
                        name: toolName,
                        arguments:
                          '{"prompt":"image-args-secret","nested":{"value":1}}',
                      },
                    },
                  ],
                }
              : { content: "finished" },
        },
      ],
    });
  });
});

test("default deny ignores model and discovered tool claims and never invokes MCP adapter", async () => {
  const events: ExecutionEvent[] = [];
  await send(events);
  expect(toolExecutions).toBe(0);
  expect(
    events.filter(
      (e) => e.type === "operation_finished" && e.operation === "mcp",
    ),
  ).toEqual([
    expect.objectContaining({ dispatch: "not_dispatched", outcome: "denied" }),
  ]);
  expect(JSON.stringify(events)).not.toMatch(/secret|\.invalid/);
});

test("trusted exact read-only configuration reaches the MCP adapter without confirmation", async () => {
  const handler = jest.fn(() => {
    throw new Error("must not request");
  });
  await send([], policy("read_only", handler));
  expect(toolExecutions).toBe(1);
  expect(handler).not.toHaveBeenCalled();
});

test.each(["denied", "no_handler", "declined", "throws"])(
  "%s mutation never reaches adapter",
  async (mode) => {
    const config = policy(mode === "denied" ? "denied" : "mutating");
    if (mode === "no_handler") delete config.requestApproval;
    if (mode === "declined") config.requestApproval = () => null;
    if (mode === "throws")
      config.requestApproval = () => {
        throw new Error("approval-secret");
      };
    await send([], config);
    expect(toolExecutions).toBe(0);
  },
);

test("exact per-call mutation confirmation executes once", async () => {
  const requests: ToolApprovalRequest[] = [];
  const events: ExecutionEvent[] = [];
  await send(
    events,
    policy("mutating", (request) => {
      requests.push(request);
      return approve(request);
    }),
  );
  expect(toolExecutions).toBe(1);
  expect(requests).toHaveLength(1);
  expect(requests[0].arguments).toEqual({
    prompt: "image-args-secret",
    nested: { value: 1 },
  });
  expect(JSON.stringify(requests[0])).not.toMatch(
    /credential-secret|token-secret|https:/,
  );
  expect(JSON.stringify(events)).not.toMatch(/secret|\.invalid/);
});

test("a previous run's confirmation cannot authorize the same provider call id", async () => {
  let previous!: ToolApprovalRequest;
  await send(
    [],
    policy("mutating", (request) => {
      previous = request;
      return approve(request);
    }),
  );
  expect(toolExecutions).toBe(1);
  chatExecutions = 0;
  await send(
    [],
    policy("mutating", () => approve(previous)),
  );
  expect(toolExecutions).toBe(1);
});

test("changed server identity while confirmation is pending is denied", async () => {
  await send(
    [],
    policy("mutating", (request) => {
      server.url = "https://replacement.invalid";
      return approve(request);
    }),
  );
  expect(toolExecutions).toBe(0);
  expect(
    transport.mock.calls.some(([url]) => url === "https://replacement.invalid"),
  ).toBe(false);
});

test("cancellation followed by a late confirmation never dispatches", async () => {
  const controller = new AbortController();
  let captured!: ToolApprovalRequest;
  let release!: (value: ReturnType<typeof approve>) => void;
  let ready!: () => void;
  const pending = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const config = policy("mutating", (request) => {
    captured = request;
    ready();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  config.signal = controller.signal;
  const execution = send([], config);
  await pending;
  controller.abort();
  await execution;
  release(approve(captured));
  await Promise.resolve();
  expect(toolExecutions).toBe(0);
});

test("unknown result after approved dispatch preserves the replay and fallback block", async () => {
  toolFailure = true;
  followupFailure = true;
  const events: ExecutionEvent[] = [];
  await expect(send(events, policy("mutating"))).rejects.toThrow(
    "Automatic replay stopped",
  );
  expect(toolExecutions).toBe(1);
  expect(events.filter((e) => e.type === "attempt_started")).toHaveLength(1);
  expect(
    events.filter(
      (e) => e.type === "operation_finished" && e.operation === "mcp",
    ),
  ).toEqual([
    expect.objectContaining({ dispatch: "attempted", outcome: "unknown" }),
  ]);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test("builtin image tool is also closed without a confirmation handler", async () => {
  toolName = "generate_image";
  await send([], {
    registry: [
      {
        target: { kind: "builtin", name: "generate_image", endpoint },
        risk: "mutating",
      },
    ],
  });
  expect(generateImage).not.toHaveBeenCalled();
});

test("approved builtin invocation receives the exact approved arguments", async () => {
  toolName = "generate_image";
  await send([], {
    registry: [
      {
        target: { kind: "builtin", name: "generate_image", endpoint },
        risk: "mutating",
      },
    ],
    requestApproval: approve,
  });
  expect(generateImage).toHaveBeenCalledTimes(1);
  expect(generateImage).toHaveBeenCalledWith(endpoint, "image-args-secret");
});

test("expired confirmation at the chat entry point denies the MCP adapter", async () => {
  const config = policy("mutating", () => new Promise(() => {}));
  config.approvalTimeoutMs = 1;
  await send([], config);
  expect(toolExecutions).toBe(0);
});

test("overlapping chat runs cannot exchange confirmations", async () => {
  const requests: ToolApprovalRequest[] = [];
  const releases: ((grant: ReturnType<typeof approve>) => void)[] = [];
  let bothReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    bothReady = resolve;
  });
  // Each logical chat's first provider response requests the same fake tool.
  const originalTransport = transport.getMockImplementation()!;
  let initialResponses = 0;
  transport.mockImplementation(async (url, init) => {
    if (
      url === endpoint.baseUrl + "/v1/chat/completions" &&
      initialResponses++ < 2
    )
      chatExecutions = 0;
    return originalTransport(url, init);
  });
  const config = policy("mutating", (request) => {
    requests.push(request);
    return new Promise((resolve) => {
      releases.push(resolve);
      if (releases.length === 2) bothReady();
    });
  });
  const first = send([], config);
  const second = send([], config);
  await ready;
  expect(requests[0].runId).not.toBe(requests[1].runId);
  releases[0](approve(requests[1]));
  releases[1](approve(requests[0]));
  await Promise.all([first, second]);
  expect(toolExecutions).toBe(0);
});

test("a malformed response after MCP dispatch remains unknown, not a policy denial", async () => {
  const originalTransport = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "tools/call") {
      toolExecutions++;
      return { ok: true, headers: new Map(), text: async () => "invalid-json" };
    }
    return originalTransport(url, init);
  });
  const events: ExecutionEvent[] = [];
  await send(events, policy("mutating"));
  const followup = transport.mock.calls
    .map(([, init]) => JSON.parse(init.body))
    .find((body) =>
      body.messages?.some(
        (message: { role: string }) => message.role === "tool",
      ),
    );
  expect(
    followup.messages.find(
      (message: { role: string }) => message.role === "tool",
    ).content,
  ).toMatch(/^Error executing tool:/);
  expect(toolExecutions).toBe(1);
  expect(
    events.filter(
      (event) =>
        event.type === "operation_finished" && event.operation === "mcp",
    ),
  ).toEqual([
    expect.objectContaining({ dispatch: "attempted", outcome: "unknown" }),
  ]);
});

test("builtin adapter response errors are not presented as policy denial", async () => {
  toolName = "generate_image";
  (generateImage as jest.Mock).mockRejectedValue(
    new SyntaxError("invalid response"),
  );
  await send([], {
    registry: [
      {
        target: { kind: "builtin", name: "generate_image", endpoint },
        risk: "mutating",
      },
    ],
    requestApproval: approve,
  });
  const followup = transport.mock.calls
    .map(([, init]) => JSON.parse(init.body))
    .find((body) =>
      body.messages?.some(
        (message: { role: string }) => message.role === "tool",
      ),
    );
  expect(
    followup.messages.find(
      (message: { role: string }) => message.role === "tool",
    ).content,
  ).toBe("Error generating image: invalid response");
  expect(generateImage).toHaveBeenCalledTimes(1);
});

test.each(["run_started", "attempt_finished"])(
  "does not broaden logical-run registry from %s callbacks before fallback",
  async (mutationEvent) => {
    const config: ToolPolicyOptions = { registry: [] };
    const originalTransport = transport.getMockImplementation()!;
    let firstEndpointFailed = false;
    transport.mockImplementation(async (url, init) => {
      if (
        url === "https://llm.invalid/v1/chat/completions" &&
        !firstEndpointFailed
      ) {
        firstEndpointFailed = true;
        return jsonResponse({ error: { message: "retry transient" } }, 503);
      }
      return originalTransport(url, init);
    });
    const events: ExecutionEvent[] = [];
    await sendChatMessage(messages, endpoint, jest.fn(), [server], true, {
      memorySettings,
      toolPolicy: config,
      fallbackEndpoint: { ...endpoint, baseUrl: "https://fallback.invalid" },
      onExecutionEvent: (event) => {
        events.push(event);
        if (event.type === mutationEvent)
          config.registry = policy("read_only").registry;
      },
    });
    expect(firstEndpointFailed).toBe(true);
    expect(
      events.filter((event) => event.type === "attempt_started"),
    ).toHaveLength(2);
    expect(toolExecutions).toBe(0);
    expect(
      events.filter(
        (event) =>
          event.type === "operation_finished" && event.operation === "mcp",
      ),
    ).toEqual([
      expect.objectContaining({
        outcome: "denied",
        dispatch: "not_dispatched",
      }),
    ]);
  },
);

test.each(["", 42, null])(
  "builtin invalid prompt %s never reaches image adapter",
  async (prompt) => {
    toolName = "generate_image";
    const originalTransport = transport.getMockImplementation()!;
    transport.mockImplementation(async (url, init) => {
      const result = await originalTransport(url, init);
      if (url === endpoint.baseUrl + "/v1/chat/completions") {
        const body = JSON.parse(await result.text());
        const call = body.choices?.[0]?.message?.tool_calls?.[0];
        if (call) call.function.arguments = JSON.stringify({ prompt });
        return jsonResponse(body);
      }
      return result;
    });
    await send([], {
      registry: [
        {
          target: { kind: "builtin", name: "generate_image", endpoint },
          risk: "mutating",
        },
      ],
      requestApproval: approve,
    });
    expect(generateImage).not.toHaveBeenCalled();
    const followup = transport.mock.calls
      .map(([, init]) => JSON.parse(init.body))
      .find((body) =>
        body.messages?.some(
          (message: { role: string }) => message.role === "tool",
        ),
      );
    expect(followup.messages).toContainEqual({
      role: "tool",
      tool_call_id: "model-call-secret",
      content: "Tool execution denied by policy.",
    });
  },
);

test("approved image result preserves the adapter's revised prompt", async () => {
  toolName = "generate_image";
  (generateImage as jest.Mock).mockResolvedValue({
    attachment: { id: "image", type: "image", uri: "file://fake.png" },
    revisedPrompt: "fixture revision",
  });
  await send([], {
    registry: [
      {
        target: { kind: "builtin", name: "generate_image", endpoint },
        risk: "mutating",
      },
    ],
    requestApproval: approve,
  });
  expect(generateImage).toHaveBeenCalledTimes(1);
  const followup = transport.mock.calls
    .map(([, init]) => JSON.parse(init.body))
    .find((body) =>
      body.messages?.some(
        (message: { role: string }) => message.role === "tool",
      ),
    );
  expect(followup.messages).toContainEqual({
    role: "tool",
    tool_call_id: "model-call-secret",
    content: "Image generated successfully. Revised prompt: fixture revision",
  });
});
