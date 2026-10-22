import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendChatMessage, flushQueuedChatMessages } from "../api";
import { enqueueChatRequest, getQueuedChatRequests } from "../offline-queue";
import * as mcp from "../mcp-client";
import { generateImage } from "../image-generation";
import { EndpointConfig, Message, MCPServer } from "../store";

jest.mock("../mcp-client", () => ({
  ...jest.requireActual("../mcp-client"),
  getToolsFromServers: jest.fn(),
  executeToolCall: jest.fn(),
}));
jest.mock("../image-generation", () => ({ generateImage: jest.fn() }));

const endpoint: EndpointConfig = {
  id: "endpoint",
  name: "Test",
  providerId: "openai",
  baseUrl: "https://endpoint.invalid/v1",
  apiKey: "test",
  model: "gpt-4",
};
const server: MCPServer = {
  id: "counter",
  name: "Counter",
  url: "https://mcp.invalid",
  enabled: true,
};
const messages: Message[] = [
  { id: "user", role: "user", content: "Increment once", timestamp: 1 },
];
const memorySettings = { enabled: false, autoSave: false, autoSummary: false };
const payload = {
  messages,
  endpoint,
  mcpServers: [server],
  mcpEnabled: true,
  memorySettings,
};
const mockFetch = global.fetch as jest.Mock;

function response(message: object) {
  return {
    ok: true,
    body: null,
    text: async () => JSON.stringify({ choices: [{ message }] }),
  };
}
function requestTool(name = "counter__increment") {
  return response({
    content: null,
    tool_calls: [
      {
        id: "call-1",
        type: "function",
        function: { name, arguments: "{}" },
      },
    ],
  });
}
function send() {
  return sendChatMessage(messages, endpoint, jest.fn(), [server], true, {
    queueOnFailure: true,
    memorySettings,
  });
}

describe("automatic replay after tool execution", () => {
  let counter: number;
  beforeEach(() => {
    counter = 0;
    const storage = new Map<string, string>();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      async (key) => storage.get(key) ?? null,
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation(
      async (key, value) => {
        storage.set(key, value);
      },
    );
    mockFetch.mockReset();
    (mcp.getToolsFromServers as jest.Mock).mockResolvedValue({
      tools: [
        {
          name: "increment",
          inputSchema: { type: "object" },
          serverId: "counter",
          serverName: "Counter",
        },
      ],
      errors: [],
    });
    (mcp.executeToolCall as jest.Mock)
      .mockReset()
      .mockImplementation(async () => ({
        content: [{ type: "text", text: `receipt-${++counter}` }],
      }));
    (generateImage as jest.Mock).mockReset();
  });

  function streamedTool(complete: boolean) {
    const data = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                function: { name: "counter__increment", arguments: "{}" },
              },
            ],
          },
        },
      ],
    };
    const bytes = new TextEncoder().encode(
      `data: ${JSON.stringify(data)}\n\n${complete ? "data: [DONE]\n\n" : ""}`,
    );
    let offset = 0;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            offset < bytes.length
              ? { done: false, value: bytes.slice(offset, ++offset) }
              : { done: true },
        }),
      },
    };
  }

  it("executes a byte-split SSE call once and preserves conversation context", async () => {
    mockFetch
      .mockResolvedValueOnce(streamedTool(true))
      .mockResolvedValueOnce(response({ content: "Done" }));
    await send();
    expect(counter).toBe(1);
    const followup = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(followup.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Increment once" }),
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              id: "call-1",
              function: { name: "counter__increment", arguments: "{}" },
            }),
          ],
        }),
        { role: "tool", tool_call_id: "call-1", content: "receipt-1" },
      ]),
    );
  });

  it("does not execute a call when SSE ends without a completion marker", async () => {
    mockFetch.mockResolvedValueOnce(streamedTool(false));
    await expect(send()).rejects.toThrow();
    expect(counter).toBe(0);
    expect(await getQueuedChatRequests()).toEqual([]);
  });

  it("does not replay a streamed action after a follow-up network failure", async () => {
    mockFetch
      .mockResolvedValueOnce(streamedTool(true))
      .mockRejectedValueOnce(new Error("Network request failed"));
    await expect(send()).rejects.toThrow("Automatic replay stopped");
    await flushQueuedChatMessages({ onChunk: jest.fn() });
    expect(counter).toBe(1);
    expect(await getQueuedChatRequests()).toEqual([]);
  });

  function sse(wire: string) {
    return { ok: true, body: null, text: async () => wire };
  }
  function sseCall(args = "{}", index = 0) {
    return `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index,
                id: `call-${index}`,
                function: { name: "counter__increment", arguments: args },
              },
            ],
          },
        },
      ],
    })}\n\n`;
  }

  it("executes a completed call with trailing comment and preserves exact arguments", async () => {
    const args = '{ "city": "Москва", "count": 1e2 }';
    mockFetch
      .mockResolvedValueOnce(sse(sseCall(args) + "data: [DONE]\n\n: heartbeat"))
      .mockResolvedValueOnce(response({ content: "Done" }));
    await send();
    expect(counter).toBe(1);
    expect(mcp.executeToolCall).toHaveBeenCalledWith(server, "increment", {
      city: "Москва",
      count: 100,
    });
    const followup = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(followup.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              function: { name: "counter__increment", arguments: args },
            }),
          ],
        }),
      ]),
    );
  });

  it.each([
    ["malformed event", sseCall() + "data: {broken}\n\n"],
    [
      "invalid second call",
      sseCall() + sseCall('{"incomplete":', 1) + "data: [DONE]\n\n",
    ],
  ])("executes no MCP calls for %s", async (_name, wire) => {
    mockFetch.mockResolvedValueOnce(sse(wire));
    await expect(send()).rejects.toThrow();
    expect(mcp.executeToolCall).not.toHaveBeenCalled();
    expect(await getQueuedChatRequests()).toEqual([]);
  });

  it.each(["data: {broken}\n\n", "data: {unfinished"])(
    "does not replay an executed call after follow-up SSE failure %j",
    async (wire) => {
      mockFetch
        .mockResolvedValueOnce(streamedTool(true))
        .mockResolvedValueOnce(sse(wire));
      await expect(send()).rejects.toThrow("Automatic replay stopped");
      expect(await getQueuedChatRequests()).toEqual([]);
      await flushQueuedChatMessages({ onChunk: jest.fn() });
      expect(counter).toBe(1);
      expect(mcp.executeToolCall).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    },
  );

  it("does not enqueue or repeat an action after the follow-up request fails", async () => {
    mockFetch
      .mockResolvedValueOnce(requestTool())
      .mockRejectedValueOnce(new Error("Network request failed"));
    await expect(send()).rejects.toThrow("Automatic replay stopped");
    expect(counter).toBe(1);
    expect(await getQueuedChatRequests()).toEqual([]);
    const followup = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(followup.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: expect.any(Array),
        }),
        { role: "tool", tool_call_id: "call-1", content: "receipt-1" },
      ]),
    );
    await flushQueuedChatMessages({ onChunk: jest.fn() });
    expect(counter).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("still queues and recovers failures before tool execution", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network request failed"));
    await send();
    expect(await getQueuedChatRequests()).toHaveLength(1);
    mockFetch
      .mockResolvedValueOnce(requestTool())
      .mockResolvedValueOnce(response({ content: "Done" }));
    const onChunk = jest.fn();
    expect(await flushQueuedChatMessages({ onChunk })).toEqual({
      processed: 1,
      failed: 0,
      remaining: 0,
    });
    expect(counter).toBe(1);
    expect(onChunk).toHaveBeenLastCalledWith("Done");
  });

  it("removes a queued request from automatic retries after a post-tool failure", async () => {
    await enqueueChatRequest(payload);
    mockFetch
      .mockResolvedValueOnce(requestTool())
      .mockRejectedValueOnce(new Error("Failed to fetch"));
    const onItemError = jest.fn();
    const onItemFinish = jest.fn();
    expect(
      await flushQueuedChatMessages({
        onChunk: jest.fn(),
        onItemError,
        onItemFinish,
      }),
    ).toEqual({ processed: 0, failed: 1, remaining: 0 });
    expect(onItemError.mock.calls[0][0].message).toContain(
      "Automatic replay stopped",
    );
    expect(onItemFinish).toHaveBeenCalledTimes(1);
    await flushQueuedChatMessages({ onChunk: jest.fn() });
    expect(counter).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retains a queued request when failure occurs before tools", async () => {
    await enqueueChatRequest(payload);
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));
    expect(await flushQueuedChatMessages({ onChunk: jest.fn() })).toEqual({
      processed: 0,
      failed: 1,
      remaining: 1,
    });
    expect(counter).toBe(0);
    expect((await getQueuedChatRequests())[0].attempts).toBe(1);
  });

  it("does not replay when the tool may have executed but its response was lost", async () => {
    (mcp.executeToolCall as jest.Mock).mockImplementation(async () => {
      counter++;
      throw new Error("Tool response lost");
    });
    mockFetch
      .mockResolvedValueOnce(requestTool())
      .mockRejectedValueOnce(new Error("Network request failed"));
    await expect(send()).rejects.toThrow("Automatic replay stopped");
    expect(counter).toBe(1);
    expect(await getQueuedChatRequests()).toEqual([]);
  });

  it("also protects built-in image generation before an unknown outcome", async () => {
    (generateImage as jest.Mock).mockRejectedValueOnce(
      new Error("Image response lost"),
    );
    mockFetch
      .mockResolvedValueOnce(requestTool("generate_image"))
      .mockRejectedValueOnce(new Error("Network request failed"));
    await expect(send()).rejects.toThrow("Automatic replay stopped");
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(await getQueuedChatRequests()).toEqual([]);
  });

  it("keeps successful tool conversations working", async () => {
    mockFetch
      .mockResolvedValueOnce(requestTool())
      .mockResolvedValueOnce(response({ content: "Done" }));
    const onChunk = jest.fn();
    await sendChatMessage(messages, endpoint, onChunk, [server], true, {
      memorySettings,
    });
    expect(counter).toBe(1);
    expect(onChunk).toHaveBeenLastCalledWith("Done");
    expect(await getQueuedChatRequests()).toEqual([]);
  });
});
