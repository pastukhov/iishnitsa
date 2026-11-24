import {
  OpenAICompatibleDriver,
  LLMResponseError,
} from "../agent/openai-driver";
import { MCPClient, clearClientCache, executeToolCall } from "../mcp-client";
import type { EndpointConfig, MCPServer } from "../store";

const endpoint: EndpointConfig = {
  id: "private-endpoint",
  name: "private-name",
  providerId: "custom",
  baseUrl: "https://provider.invalid/private-url",
  apiKey: "credential-secret",
  model: "private-model",
};
const server: MCPServer = {
  id: "private-server",
  name: "private-server-name",
  url: "https://mcp.invalid/private-url",
  token: "credential-secret",
  enabled: true,
};
const mockFetch = global.fetch as jest.Mock;
function observer() {
  return { dispatched: jest.fn(), finish: jest.fn() };
}
function response(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    headers: { get: () => "application/json" },
    text: async () => body,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  clearClientCache();
});

describe("LLM transport boundaries", () => {
  const driver = new OpenAICompatibleDriver();
  function send(boundary: ReturnType<typeof observer>, messages: any[] = []) {
    return driver.streamChat({
      endpoint,
      messages,
      tools: [],
      onChunk: jest.fn(),
      boundary,
    });
  }

  it.each(["eof", "text-without-terminal", "stop"])(
    "classifies SSE completion evidence: %s",
    async (kind) => {
      const boundary = observer();
      const content =
        kind === "eof"
          ? []
          : [
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "reply" }, ...(kind === "stop" ? { finish_reason: "stop" } : {}) }] })}\n\n`,
              ),
            ];
      mockFetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: async () =>
              content.length
                ? { done: false, value: content.shift() }
                : { done: true },
          }),
        },
      });
      await expect(send(boundary)).resolves.toMatchObject({
        fullContent: kind === "eof" ? "" : "reply",
      });
      expect(boundary.finish.mock.calls).toEqual([
        [kind === "stop" ? "completed" : "unknown"],
      ]);
    },
  );

  it("marks dispatch only after serialization and before fetch", async () => {
    const boundary = observer();
    mockFetch.mockImplementation(async () => {
      expect(boundary.dispatched).toHaveBeenCalledTimes(1);
      expect(boundary.finish).not.toHaveBeenCalled();
      return response('{"choices":[{"message":{"content":"reply-secret"}}]}');
    });
    await expect(send(boundary)).resolves.toMatchObject({
      fullContent: "reply-secret",
    });
    expect(boundary.finish.mock.calls).toEqual([["completed"]]);

    mockFetch.mockClear();
    const cyclic: any = { role: "user" };
    cyclic.content = cyclic;
    const preflight = observer();
    await expect(send(preflight, [cyclic])).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(preflight.dispatched).not.toHaveBeenCalled();
    expect(preflight.finish.mock.calls).toEqual([["failed"]]);
  });

  it("preserves a known HTTP refusal with typed status", async () => {
    const boundary = observer();
    mockFetch.mockResolvedValue(
      response('{"error":{"message":"payload-secret"}}', 503),
    );
    const failure = await send(boundary).catch((error) => error);
    expect(failure).toBeInstanceOf(LLMResponseError);
    expect(failure).toMatchObject({ status: 503, message: "payload-secret" });
    expect(boundary.finish.mock.calls).toEqual([["failed"]]);
  });

  it.each(["transport", "sse"])(
    "reports unknown outcome for %s failure after dispatch",
    async (kind) => {
      const boundary = observer();
      if (kind === "transport")
        mockFetch.mockRejectedValue(new Error("transport-secret"));
      else mockFetch.mockResolvedValue(response("data: broken-json\n\n"));
      await expect(send(boundary)).rejects.toThrow();
      expect(boundary.dispatched).toHaveBeenCalledTimes(1);
      expect(boundary.finish.mock.calls).toEqual([["unknown"]]);
    },
  );

  it.each(["", "broken-json", "{}"])(
    "does not call an unparseable legacy response completed: %j",
    async (body) => {
      const boundary = observer();
      mockFetch.mockResolvedValue(response(body));
      // Preserve the pre-existing non-streaming return behavior.
      await expect(send(boundary)).resolves.toMatchObject({
        fullContent: "",
        toolCalls: [],
      });
      expect(boundary.finish.mock.calls).toEqual([["unknown"]]);
    },
  );
});

describe("MCP transport boundaries", () => {
  it("does not log notification failure payloads or server identity", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch.mockImplementation(async (_url, request) => {
      const rpc = JSON.parse(request.body);
      if (rpc.method === "notifications/initialized")
        throw new Error("notification-secret");
      return response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: rpc.method === "initialize" ? {} : { content: [] },
        }),
      );
    });
    try {
      await executeToolCall(server, "tool", {}, observer());
      expect(warning).toHaveBeenCalled();
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(
        /secret|private-server|mcp\.invalid/,
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("does not report tools/call dispatch when initialization fails", async () => {
    const boundary = observer();
    mockFetch.mockRejectedValue(new Error("initialize-secret"));
    await expect(
      executeToolCall(server, "private-tool", {}, boundary),
    ).rejects.toThrow("initialize-secret");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).method).toBe(
      "initialize",
    );
    expect(boundary.dispatched).not.toHaveBeenCalled();
    expect(boundary.finish.mock.calls).toEqual([["failed"]]);
  });

  it("serializes tools/call before marking dispatch", async () => {
    const boundary = observer();
    const args: any = {};
    args.cycle = args;
    await expect(
      new MCPClient(server).callTool("private-tool", args, boundary),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(boundary.dispatched).not.toHaveBeenCalled();
    expect(boundary.finish.mock.calls).toEqual([["failed"]]);
  });

  it.each([false, true])(
    "reports confirmed result isError=%s as execution",
    async (isError) => {
      const boundary = observer();
      const result = {
        content: [{ type: "text", text: "result-secret" }],
        isError,
      };
      mockFetch.mockImplementation(async (_url, request) => {
        expect(boundary.dispatched).toHaveBeenCalledTimes(1);
        return response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: JSON.parse(request.body).id,
            result,
          }),
        );
      });
      await expect(
        new MCPClient(server).callTool("private-tool", {}, boundary),
      ).resolves.toEqual(result);
      expect(boundary.finish.mock.calls).toEqual([
        [isError ? "failed" : "completed"],
      ]);
      expect(JSON.stringify(boundary.finish.mock.calls)).not.toContain(
        "secret",
      );
    },
  );

  it.each(["transport", "malformed", "empty", "missing-result"])(
    "keeps %s tools/call result unknown",
    async (kind) => {
      const boundary = observer();
      if (kind === "transport")
        mockFetch.mockRejectedValue(new Error("transport-secret"));
      else
        mockFetch.mockResolvedValue(
          response(
            kind === "malformed" ? "broken-json" : kind === "empty" ? "" : "{}",
          ),
        );
      const call = new MCPClient(server).callTool("private-tool", {}, boundary);
      if (kind === "transport" || kind === "malformed")
        await expect(call).rejects.toThrow();
      else await call;
      expect(boundary.dispatched).toHaveBeenCalledTimes(1);
      expect(boundary.finish.mock.calls).toEqual([["unknown"]]);
    },
  );

  it.each(["http", "jsonrpc"])(
    "reports known %s failure without claiming no dispatch",
    async (kind) => {
      const boundary = observer();
      mockFetch.mockImplementation(async (_url, request) =>
        response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: JSON.parse(request.body).id,
            error: { code: -32602, message: "refusal-secret" },
          }),
          kind === "http" ? 403 : 200,
        ),
      );
      await expect(
        new MCPClient(server).callTool("private-tool", {}, boundary),
      ).rejects.toThrow();
      expect(boundary.dispatched).toHaveBeenCalledTimes(1);
      expect(boundary.finish.mock.calls).toEqual([["failed"]]);
    },
  );

  it("does not certify a result belonging to a different request", async () => {
    const boundary = observer();
    const result = { content: [{ type: "text", text: "unrelated-secret" }] };
    mockFetch.mockResolvedValue(
      response(
        JSON.stringify({ jsonrpc: "2.0", id: "different-request", result }),
      ),
    );
    // Instrumentation does not change the legacy parser's returned result.
    await expect(
      new MCPClient(server).callTool("private-tool", {}, boundary),
    ).resolves.toEqual(result);
    expect(boundary.finish.mock.calls).toEqual([["unknown"]]);
  });

  it.each(["different-request", undefined])(
    "does not certify an error with unrelated id %j",
    async (id) => {
      const boundary = observer();
      mockFetch.mockResolvedValue(
        response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "unrelated-secret" },
          }),
        ),
      );
      await expect(
        new MCPClient(server).callTool("private-tool", {}, boundary),
      ).rejects.toThrow("unrelated-secret");
      expect(boundary.finish.mock.calls).toEqual([["unknown"]]);
    },
  );
});

describe("failing boundary observers", () => {
  function throwingObserver() {
    return {
      dispatched() {
        throw new Error("observer-secret");
      },
      finish() {
        throw new Error("observer-secret");
      },
    };
  }

  it("cannot prevent LLM dispatch or replace its response", async () => {
    mockFetch.mockResolvedValue(
      response('{"choices":[{"message":{"content":"reply"}}]}'),
    );
    await expect(
      new OpenAICompatibleDriver().streamChat({
        endpoint,
        messages: [],
        tools: [],
        onChunk: jest.fn(),
        boundary: throwingObserver(),
      }),
    ).resolves.toMatchObject({ fullContent: "reply" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("cannot prevent MCP dispatch or replace its result", async () => {
    const result = { content: [] };
    mockFetch.mockImplementation(async (_url, request) =>
      response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: JSON.parse(request.body).id,
          result,
        }),
      ),
    );
    await expect(
      new MCPClient(server).callTool("tool", {}, throwingObserver()),
    ).resolves.toEqual(result);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("cannot replace initialization or transport errors", async () => {
    const failure = new Error("original-secret");
    mockFetch.mockRejectedValue(failure);
    await expect(
      executeToolCall(server, "tool", {}, throwingObserver()),
    ).rejects.toBe(failure);
    await expect(
      new OpenAICompatibleDriver().streamChat({
        endpoint,
        messages: [],
        tools: [],
        onChunk: jest.fn(),
        boundary: throwingObserver(),
      }),
    ).rejects.toBe(failure);
    await expect(
      new MCPClient(server).callTool("tool", {}, throwingObserver()),
    ).rejects.toBe(failure);
  });
});
