import { OpenAICompatibleDriver } from "../openai-driver";
import { EndpointConfig } from "@/lib/store";
import { OpenAIFunction } from "@/lib/agent/types";

const mockFetch = global.fetch as jest.Mock;

describe("OpenAICompatibleDriver", () => {
  const endpoint: EndpointConfig = {
    id: "endpoint",
    name: "Test",
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "key",
    model: "gpt-4",
    systemPrompt: "",
  };

  const tools: OpenAIFunction[] = [
    {
      type: "function",
      function: {
        name: "server1__tool",
        description: "Tool",
        parameters: { type: "object" },
      },
    },
  ];

  const createMockStream = (chunks: string[]) => {
    let index = 0;
    return {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            const encoder = new TextEncoder();
            return { done: false, value: encoder.encode(chunks[index++]) };
          }
          return { done: true, value: undefined };
        },
      }),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("streams content and tool calls", async () => {
    const chunks = [
      "event: message\n",
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__","arguments":"{\\"a\\":"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"tool","arguments":"\\"b\\"}"}}]}}]}\n',
      "data: [DONE]\n",
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream(chunks),
    });

    const driver = new OpenAICompatibleDriver();
    const onChunk = jest.fn();

    const result = await driver.streamChat({
      endpoint,
      messages: [{ role: "user", content: "Hi" }],
      tools,
      onChunk,
    });

    expect(onChunk).toHaveBeenCalledWith("Hello");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe("server1__tool");
    expect(result.toolCalls[0].function.arguments).toBe('{"a":"b"}');

    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(requestBody.tools).toBeDefined();
    expect(requestBody.tool_choice).toBe("auto");
  });

  it("handles non-streaming SSE response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null,
      text: () =>
        Promise.resolve(
          'data: {"choices":[{"delta":{"content":"SSE"}}]}\ndata: [DONE]\n',
        ),
    });

    const driver = new OpenAICompatibleDriver();
    const onChunk = jest.fn();

    const result = await driver.streamChat({
      endpoint,
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      onChunk,
    });

    expect(onChunk).toHaveBeenCalledWith("SSE");
    expect(result.fullContent).toBe("SSE");
  });

  it("handles non-streaming JSON response with tool calls", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Hello there",
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "server1__tool",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
    });

    const driver = new OpenAICompatibleDriver();

    const result = await driver.streamChat({
      endpoint,
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      onChunk: jest.fn(),
    });

    expect(result.fullContent).toBe("Hello there");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe("server1__tool");
  });

  it("throws API error with message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(JSON.stringify({ error: { message: "Bad key" } })),
    });

    const driver = new OpenAICompatibleDriver();

    await expect(
      driver.streamChat({
        endpoint,
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
        onChunk: jest.fn(),
      }),
    ).rejects.toThrow("Bad key");
  });

  it("throws API error with plain text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server error"),
    });

    const driver = new OpenAICompatibleDriver();

    await expect(
      driver.streamChat({
        endpoint,
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
        onChunk: jest.fn(),
      }),
    ).rejects.toThrow("Server error");
  });
});
