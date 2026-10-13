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
