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

  const createMockStream = (chunks: (string | Uint8Array)[]) => {
    let index = 0;
    return {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            const encoder = new TextEncoder();
            const chunk = chunks[index++];
            return {
              done: false,
              value: typeof chunk === "string" ? encoder.encode(chunk) : chunk,
            };
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
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__","arguments":"{\\"a\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"tool","arguments":"\\"b\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
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
          'data: {"choices":[{"delta":{"content":"SSE"}}]}\n\ndata: [DONE]\n\n',
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

  const event = (value: object) => `data: ${JSON.stringify(value)}\n\n`;
  const toolEvent = (args = "{}", name = "server1__tool", id = "call_1") =>
    event({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id, function: { name, arguments: args } }],
          },
        },
      ],
    });
  const runStream = (chunks: (string | Uint8Array)[]) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream(chunks),
    });
    return new OpenAICompatibleDriver().streamChat({
      endpoint,
      messages: [],
      tools,
      onChunk: jest.fn(),
    });
  };

  it("preserves text, tool calls and usage at every byte boundary", async () => {
    const wire =
      event({ choices: [{ delta: { content: "Привет 🌍" } }] }) +
      toolEvent('{"city":"Москва"}') +
      event({
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }) +
      "data: [DONE]\n\n";
    const bytes = new TextEncoder().encode(wire);
    const expected = {
      fullContent: "Привет 🌍",
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "server1__tool", arguments: '{"city":"Москва"}' },
        },
      ],
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    };
    for (let i = 1; i < bytes.length; i++) {
      expect(await runStream([bytes.slice(0, i), bytes.slice(i)])).toEqual(
        expected,
      );
    }
    expect(
      await runStream(Array.from(bytes, (b) => new Uint8Array([b]))),
    ).toEqual(expected);
  });

  it.each(["\n", "\r\n", "\r"])(
    "handles multiline data and byte-split %j delimiters",
    async (newline) => {
      const wire = [
        ": heartbeat",
        "event: message",
        'data:{"choices":',
        'data: [{"delta":{"content":"OK"}}]}',
        "",
        "data:[DONE]",
        "",
        "",
      ].join(newline);
      const bytes = new TextEncoder().encode(wire);
      expect(
        (await runStream(Array.from(bytes, (b) => new Uint8Array([b]))))
          .fullContent,
      ).toBe("OK");
    },
  );

  it("rejects corrupted UTF-8 rather than changing tool arguments", async () => {
    const bytes = new TextEncoder().encode(
      toolEvent('{"city":"Москва"}') + "data: [DONE]\n\n",
    );
    const position = bytes.findIndex((byte) => byte > 127);
    bytes[position] = 0xff;
    await expect(runStream([bytes])).rejects.toThrow();
  });

  it("assembles interleaved tool indices and fragmented identifiers", async () => {
    const delta = (calls: object[]) =>
      event({ choices: [{ delta: { tool_calls: calls } }] });
    const wire =
      delta([
        {
          index: 1,
          id: "call_",
          function: { name: "second", arguments: '{"b":' },
        },
        { index: 0, id: "first", function: { name: "first", arguments: "{}" } },
      ]) +
      delta([{ index: 1, id: "2", function: { arguments: "2}" } }]) +
      event({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    expect((await runStream([wire])).toolCalls).toEqual([
      {
        id: "first",
        type: "function",
        function: { name: "first", arguments: "{}" },
      },
      {
        id: "call_2",
        type: "function",
        function: { name: "second", arguments: '{"b":2}' },
      },
    ]);
  });

  it.each([
    ["missing completion", toolEvent()],
    ["unfinished event", toolEvent().trimEnd()],
    ["unfinished arguments", toolEvent('{"a":') + "data: [DONE]\n\n"],
    ["missing name", toolEvent("{}", "") + "data: [DONE]\n\n"],
    ["missing id", toolEvent("{}", "server1__tool", "") + "data: [DONE]\n\n"],
    ["array arguments", toolEvent("[]") + "data: [DONE]\n\n"],
    ["null arguments", toolEvent("null") + "data: [DONE]\n\n"],
    [
      "length limit",
      toolEvent() +
        event({ choices: [{ delta: {}, finish_reason: "length" }] }),
    ],
    [
      "malformed event",
      "data: {broken}\n\n" + toolEvent() + "data: [DONE]\n\n",
    ],
  ])("rejects %s before returning executable calls", async (_name, wire) => {
    await expect(runStream([wire])).rejects.toThrow();
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
