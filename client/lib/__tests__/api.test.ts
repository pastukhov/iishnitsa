import { sendChatMessage, testConnection, testMCPServer } from "../api";
import { Message, EndpointConfig, MCPServer } from "../store";
import * as mcpClient from "../mcp-client";
import * as providers from "../providers";

// Mock fetch
const mockFetch = global.fetch as jest.Mock;

// Mock mcp-client
jest.mock("../mcp-client", () => ({
  getToolsFromServers: jest.fn(),
  executeToolCall: jest.fn(),
  mcpToolsToOpenAIFunctions: jest.fn(),
  parseToolCallName: jest.fn(),
}));

// Mock providers
jest.mock("../providers", () => ({
  buildAuthHeaders: jest.fn(),
  fetchProviderModels: jest.fn(),
  resolveBaseUrl: jest.fn(),
}));

describe("api", () => {
  const mockEndpoint: EndpointConfig = {
    id: "test-endpoint",
    name: "Test Endpoint",
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-4",
  };

  const mockMessages: Message[] = [
    { id: "1", role: "user", content: "Hello", timestamp: Date.now() },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (providers.resolveBaseUrl as jest.Mock).mockReturnValue(
      "https://api.openai.com/v1",
    );
    (providers.buildAuthHeaders as jest.Mock).mockReturnValue({
      Authorization: "Bearer test-key",
    });
  });

  describe("sendChatMessage", () => {
    // Helper to create a readable stream from chunks
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

    it("sends messages and streams response", async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockStream(chunks),
      });

      const onChunk = jest.fn();
      await sendChatMessage(mockMessages, mockEndpoint, onChunk);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );

      expect(onChunk).toHaveBeenCalledWith("Hello");
      expect(onChunk).toHaveBeenCalledWith("Hello world");
    });

    it("includes system prompt when provided", async () => {
      const endpointWithSystem = {
        ...mockEndpoint,
        systemPrompt: "You are a helpful assistant",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockStream([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n',
        ]),
      });

      await sendChatMessage(mockMessages, endpointWithSystem, jest.fn());

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant",
      });
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: { message: "Invalid API key" } }),
          ),
      });

      await expect(
        sendChatMessage(mockMessages, mockEndpoint, jest.fn()),
      ).rejects.toThrow("Invalid API key");
    });

    it("throws on plain text error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal server error"),
      });

      await expect(
        sendChatMessage(mockMessages, mockEndpoint, jest.fn()),
      ).rejects.toThrow("Internal server error");
    });

    it("fetches MCP tools when enabled", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValueOnce([
        {
          type: "function",
          function: {
            name: "server1__test_tool",
            description: "[Test Server] A test tool",
            parameters: { type: "object" },
          },
        },
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockStream([
          'data: {"choices":[{"delta":{"content":"Done"}}]}\n',
        ]),
      });

      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        jest.fn(),
        [mockServer],
        true,
      );

      expect(mcpClient.getToolsFromServers).toHaveBeenCalledWith([mockServer]);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.tools).toBeDefined();
      expect(requestBody.tool_choice).toBe("auto");
    });

    it("skips disabled MCP servers", async () => {
      const disabledServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockStream([
          'data: {"choices":[{"delta":{"content":"Done"}}]}\n',
        ]),
      });

      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        jest.fn(),
        [disabledServer],
        true,
      );

      expect(mcpClient.getToolsFromServers).not.toHaveBeenCalled();
    });

    it("handles tool calls in response", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "get_weather",
          description: "Get weather",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__get_weather",
            description: "[Test Server] Get weather",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "get_weather",
      });

      (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
        content: [{ type: "text", text: "Sunny, 25°C" }],
      });

      // First call returns tool call
      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__get_weather","arguments":"{\\"city\\":"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"NYC\\"}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      // Second call returns final response
      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"The weather in NYC is sunny, 25°C"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      const onChunk = jest.fn();
      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        [mockServer],
        true,
      );

      expect(mcpClient.executeToolCall).toHaveBeenCalledWith(
        mockServer,
        "get_weather",
        { city: "NYC" },
      );
      expect(onChunk).toHaveBeenCalledWith(
        expect.stringContaining("Using tool"),
      );
    });

    it("handles non-streaming response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              choices: [{ message: { content: "Hello from non-streaming" } }],
            }),
          ),
      });

      const onChunk = jest.fn();
      await sendChatMessage(mockMessages, mockEndpoint, onChunk);

      expect(onChunk).toHaveBeenCalledWith("Hello from non-streaming");
    });

    it("throws when max tool call depth exceeded", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "loop_tool",
          description: "A tool that causes loops",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__loop_tool",
            description: "[Test Server] A tool",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "loop_tool",
      });

      (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
        content: [{ type: "text", text: "result" }],
      });

      // Always return tool calls to trigger max depth
      // Use mockImplementation to create a new stream for each call
      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__loop_tool","arguments":"{}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          body: createMockStream(toolCallChunks),
        }),
      );

      await expect(
        sendChatMessage(
          mockMessages,
          mockEndpoint,
          jest.fn(),
          [mockServer],
          true,
        ),
      ).rejects.toThrow("Maximum tool call depth exceeded");
    });

    it("handles tool call with unknown tool", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: [],
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "unknown_tool",
      });

      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__unknown_tool","arguments":"{}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"Error handled"}}]}\n',
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      const onChunk = jest.fn();
      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        [mockServer],
        true,
      );

      // Should continue without crashing
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("handles MCP tool fetch errors gracefully", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      (mcpClient.getToolsFromServers as jest.Mock).mockRejectedValueOnce(
        new Error("Connection failed"),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockStream([
          'data: {"choices":[{"delta":{"content":"Fallback"}}]}\n',
        ]),
      });

      const onChunk = jest.fn();
      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        [mockServer],
        true,
      );

      // Should continue without tools
      expect(onChunk).toHaveBeenCalledWith("Fallback");
    });

    it("filters out system messages from input", async () => {
      const messagesWithSystem: Message[] = [
        {
          id: "1",
          role: "system",
          content: "System msg",
          timestamp: Date.now(),
        },
        { id: "2", role: "user", content: "User msg", timestamp: Date.now() },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockStream([
          'data: {"choices":[{"delta":{"content":"Ok"}}]}\n',
        ]),
      });

      await sendChatMessage(messagesWithSystem, mockEndpoint, jest.fn());

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Should only have user message (system from endpoint.systemPrompt is different)
      const userMessages = requestBody.messages.filter(
        (m: any) => m.role === "user",
      );
      expect(userMessages).toHaveLength(1);
    });

    it("logs warning when MCP servers return errors", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
        tools: [],
        errors: [{ serverName: "Test Server", error: "Connection timeout" }],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockStream([
          'data: {"choices":[{"delta":{"content":"Ok"}}]}\n',
        ]),
      });

      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        jest.fn(),
        [mockServer],
        true,
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "MCP server errors:",
        expect.arrayContaining([
          expect.objectContaining({ serverName: "Test Server" }),
        ]),
      );
      consoleWarnSpy.mockRestore();
    });

    it("handles SSE lines without data prefix", async () => {
      const chunks = [
        "event: message\n",
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        ": comment line\n",
        "data: [DONE]\n",
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockStream(chunks),
      });

      const onChunk = jest.fn();
      await sendChatMessage(mockMessages, mockEndpoint, onChunk);

      expect(onChunk).toHaveBeenCalledWith("Hello");
    });

    it("handles tool call name accumulation", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "get_data",
          description: "Get data",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__get_data",
            description: "[Test Server] Get data",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "get_data",
      });

      (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
        content: [{ type: "text", text: "result" }],
      });

      // Tool call with name split across chunks
      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_data"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}  }]}}]}\n',
        "data: [DONE]\n",
      ];

      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"Done"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      const onChunk = jest.fn();
      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        [mockServer],
        true,
      );

      expect(mcpClient.executeToolCall).toHaveBeenCalled();
    });

    it("handles non-streaming response with SSE format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
        text: () =>
          Promise.resolve(
            'data: {"choices":[{"delta":{"content":"SSE in text"}}]}\ndata: [DONE]\n',
          ),
      });

      const onChunk = jest.fn();
      await sendChatMessage(mockMessages, mockEndpoint, onChunk);

      expect(onChunk).toHaveBeenCalledWith("SSE in text");
    });

    it("handles non-streaming response with tool calls", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "calc",
          description: "Calculate",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__calc",
            description: "[Test Server] Calculate",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "calc",
      });

      (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
        content: [{ type: "text", text: "42" }],
      });

      // Non-streaming response with tool calls
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: null,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: "call_1",
                          function: { name: "server1__calc", arguments: "{}" },
                        },
                      ],
                    },
                  },
                ],
              }),
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream([
            'data: {"choices":[{"delta":{"content":"Result: 42"}}]}\n',
          ]),
        });

      const onChunk = jest.fn();
      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        [mockServer],
        true,
      );

      expect(mcpClient.executeToolCall).toHaveBeenCalled();
    });

    it("handles server not found for tool", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "my_tool",
          description: "Tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__my_tool",
            description: "[Test Server] Tool",
            parameters: { type: "object" },
          },
        },
      ]);

      // Return different server ID to trigger "server not found"
      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "unknown_server",
        toolName: "my_tool",
      });

      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__my_tool","arguments":"{}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"Error handled"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      const onChunk = jest.fn();
      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        [mockServer],
        true,
      );

      // Should continue and include error in tool result
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("handles tool execution error", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "failing_tool",
          description: "A tool that fails",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__failing_tool",
            description: "[Test Server] A tool",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "failing_tool",
      });

      (mcpClient.executeToolCall as jest.Mock).mockRejectedValue(
        new Error("Tool execution failed"),
      );

      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__failing_tool","arguments":"{}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"Handled error"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      const onChunk = jest.fn();
      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        [mockServer],
        true,
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("handles tool result with image content", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "get_image",
          description: "Get image",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__get_image",
            description: "[Test Server] Get image",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "get_image",
      });

      // Return image content
      (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
        content: [
          { type: "image", data: "base64data", mimeType: "image/jpeg" },
        ],
      });

      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__get_image","arguments":"{}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"Image received"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        jest.fn(),
        [mockServer],
        true,
      );

      expect(mcpClient.executeToolCall).toHaveBeenCalled();
    });

    it("handles tool result with empty content", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "empty_tool",
          description: "Tool with empty result",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__empty_tool",
            description: "[Test Server] Tool",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "empty_tool",
      });

      // Return empty content
      (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
        content: [],
      });

      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__empty_tool","arguments":"{}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"No result"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        jest.fn(),
        [mockServer],
        true,
      );

      expect(mcpClient.executeToolCall).toHaveBeenCalled();
    });

    it("handles tool result with unknown content type", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "weird_tool",
          description: "Tool with weird result",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__weird_tool",
            description: "[Test Server] Tool",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
        serverId: "server1",
        toolName: "weird_tool",
      });

      // Return unknown content type
      (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
        content: [{ type: "unknown", data: { foo: "bar" } }],
      });

      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__weird_tool","arguments":"{}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"Processed"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        jest.fn(),
        [mockServer],
        true,
      );

      expect(mcpClient.executeToolCall).toHaveBeenCalled();
    });

    it("handles multiple tool calls in single response", async () => {
      const mockServer: MCPServer = {
        id: "server1",
        name: "Test Server",
        url: "http://localhost:3000",
        enabled: true,
      };

      const mockTools = [
        {
          name: "tool_a",
          description: "Tool A",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
        {
          name: "tool_b",
          description: "Tool B",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ];

      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
        tools: mockTools,
        errors: [],
      });

      (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1__tool_a",
            description: "A",
            parameters: { type: "object" },
          },
        },
        {
          type: "function",
          function: {
            name: "server1__tool_b",
            description: "B",
            parameters: { type: "object" },
          },
        },
      ]);

      (mcpClient.parseToolCallName as jest.Mock).mockImplementation(
        (name: string) => {
          if (name.includes("tool_a"))
            return { serverId: "server1", toolName: "tool_a" };
          return { serverId: "server1", toolName: "tool_b" };
        },
      );

      (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
        content: [{ type: "text", text: "result" }],
      });

      const toolCallChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"server1__tool_a","arguments":"{}"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"server1__tool_b","arguments":"{}"}}]}}]}\n',
        "data: [DONE]\n",
      ];

      const finalChunks = [
        'data: {"choices":[{"delta":{"content":"Both done"}}]}\n',
        "data: [DONE]\n",
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(toolCallChunks),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: createMockStream(finalChunks),
        });

      const onChunk = jest.fn();
      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        [mockServer],
        true,
      );

      expect(onChunk).toHaveBeenCalledWith(expect.stringContaining("tool_a"));
      expect(onChunk).toHaveBeenCalledWith(expect.stringContaining("tool_b"));
    });
  });

  describe("testConnection", () => {
    it("returns success with models", async () => {
      (providers.fetchProviderModels as jest.Mock).mockResolvedValueOnce({
        models: ["gpt-4", "gpt-3.5-turbo"],
        message: "Connected!",
      });

      const result = await testConnection(mockEndpoint);

      expect(result.success).toBe(true);
      expect(result.models).toContain("gpt-4");
      expect(result.message).toBe("Connected!");
    });

    it("returns success with empty models", async () => {
      (providers.fetchProviderModels as jest.Mock).mockResolvedValueOnce({
        models: [],
        message: "Connected but no models",
      });

      const result = await testConnection(mockEndpoint);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Connected but no models");
    });

    it("returns error from provider", async () => {
      (providers.fetchProviderModels as jest.Mock).mockResolvedValueOnce({
        error: "Invalid API key",
        models: [],
      });

      const result = await testConnection(mockEndpoint);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Invalid API key");
    });

    it("handles exception", async () => {
      (providers.fetchProviderModels as jest.Mock).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const result = await testConnection(mockEndpoint);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Connection error: Network error");
    });

    it("uses default message when models found", async () => {
      (providers.fetchProviderModels as jest.Mock).mockResolvedValueOnce({
        models: ["model1", "model2", "model3"],
      });

      const result = await testConnection(mockEndpoint);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Connected! Found 3 models.");
    });
  });

  describe("testMCPServer", () => {
    const mockServer: MCPServer = {
      id: "server1",
      name: "Test Server",
      url: "http://localhost:3000",
      enabled: false,
    };

    it("returns success with tools", async () => {
      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
        tools: [{ name: "tool1" }, { name: "tool2" }],
        errors: [],
      });

      const result = await testMCPServer(mockServer);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Connected! Found 2 tools.");
      expect(result.tools).toContain("tool1");
      expect(result.tools).toContain("tool2");
    });

    it("forces server to enabled when testing", async () => {
      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
        tools: [],
        errors: [],
      });

      await testMCPServer(mockServer);

      expect(mcpClient.getToolsFromServers).toHaveBeenCalledWith([
        expect.objectContaining({ enabled: true }),
      ]);
    });

    it("returns error from server", async () => {
      (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
        tools: [],
        errors: [{ serverName: "Test Server", error: "Connection refused" }],
      });

      const result = await testMCPServer(mockServer);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Connection refused");
    });

    it("handles exception", async () => {
      (mcpClient.getToolsFromServers as jest.Mock).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const result = await testMCPServer(mockServer);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Connection error: Network error");
    });
  });
});
