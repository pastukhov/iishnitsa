import { AgentCore } from "../core";
import { EndpointConfig, MCPServer, Message } from "@/lib/store";
import * as mcpClient from "@/lib/mcp-client";
import * as imageUtils from "@/lib/image-utils";
import { clearMcpRegistry } from "@/lib/mcp-registry";

jest.mock("@/lib/mcp-client", () => ({
  getToolsFromServers: jest.fn(),
  executeToolCall: jest.fn(),
  mcpToolsToOpenAIFunctions: jest.fn(),
  parseToolCallName: jest.fn(),
}));

jest.mock("@/lib/image-utils", () => ({
  getImageDataUrl: jest.fn(),
}));

describe("AgentCore", () => {
  const mockEndpoint: EndpointConfig = {
    id: "endpoint",
    name: "Test",
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "key",
    model: "gpt-4",
    systemPrompt: "You are helpful",
  };

  const mockServer: MCPServer = {
    id: "server1",
    name: "Test Server",
    url: "http://localhost:3000",
    enabled: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearMcpRegistry();
  });

  it("builds chat context with system prompt and attachments", async () => {
    (imageUtils.getImageDataUrl as jest.Mock).mockResolvedValueOnce(
      "data:image/png;base64,abc",
    );

    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValue({ fullContent: "", toolCalls: [] }),
    };

    const messages: Message[] = [
      {
        id: "1",
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
        attachments: [
          {
            id: "img1",
            type: "image",
            uri: "file://image.png",
            mimeType: "image/png",
          },
        ],
      },
    ];

    const agent = new AgentCore({ driver });

    await agent.runChat({
      messages,
      endpoint: mockEndpoint,
      onChunk: jest.fn(),
      mcpServers: [],
      mcpEnabled: false,
    });

    expect(driver.streamChat).toHaveBeenCalledTimes(1);
    const call = (driver.streamChat as jest.Mock).mock.calls[0][0];
    expect(call.messages[0]).toEqual({
      role: "system",
      content: "You are helpful",
    });
    expect(call.messages[1].role).toBe("user");
    expect(call.messages[1].content).toEqual([
      { type: "text", text: "Hello" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
    ]);
    expect(call.tools).toEqual([]);
  });

  it("executes tool calls and loops until completion", async () => {
    const toolCall = {
      id: "call_1",
      type: "function" as const,
      function: {
        name: "server1__tool",
        arguments: '{"input":"x"}',
      },
    };

    (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
      tools: [
        {
          name: "tool",
          description: "Test tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ],
      errors: [],
    });

    (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValueOnce([
      {
        type: "function",
        function: {
          name: "server1__tool",
          description: "[Test Server] Test tool",
          parameters: { type: "object" },
        },
      },
    ]);

    (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
      serverId: "server1",
      toolName: "tool",
    });

    (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValueOnce({ fullContent: "", toolCalls: [toolCall] })
        .mockResolvedValueOnce({ fullContent: "Done", toolCalls: [] }),
    };

    const onChunk = jest.fn();
    const agent = new AgentCore({ driver });

    await agent.runChat({
      messages: [
        { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
      ],
      endpoint: mockEndpoint,
      onChunk,
      mcpServers: [mockServer],
      mcpEnabled: true,
    });

    expect(driver.streamChat).toHaveBeenCalledTimes(2);
    expect(mcpClient.executeToolCall).toHaveBeenCalledWith(mockServer, "tool", {
      input: "x",
    });
    expect(onChunk).toHaveBeenCalledWith(expect.stringContaining("Using tool"));
  });

  it("throws when max depth exceeded", async () => {
    const toolCall = {
      id: "call_1",
      type: "function" as const,
      function: {
        name: "server1__loop",
        arguments: "{}",
      },
    };

    (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValue({
      tools: [
        {
          name: "loop",
          description: "Loop tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ],
      errors: [],
    });

    (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValue([
      {
        type: "function",
        function: {
          name: "server1__loop",
          description: "[Test Server] Loop tool",
          parameters: { type: "object" },
        },
      },
    ]);

    (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
      serverId: "server1",
      toolName: "loop",
    });

    (mcpClient.executeToolCall as jest.Mock).mockResolvedValue({
      content: [{ type: "text", text: "again" }],
    });

    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValue({ fullContent: "", toolCalls: [toolCall] }),
    };

    const agent = new AgentCore({ driver, maxDepth: 1 });

    await expect(
      agent.runChat({
        messages: [
          { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
        ],
        endpoint: mockEndpoint,
        onChunk: jest.fn(),
        mcpServers: [mockServer],
        mcpEnabled: true,
      }),
    ).rejects.toThrow("Maximum tool call depth exceeded");
  });

  it("skips tool loading when servers are disabled", async () => {
    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValue({ fullContent: "Done", toolCalls: [] }),
    };

    const agent = new AgentCore({ driver });

    await agent.runChat({
      messages: [
        { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
      ],
      endpoint: mockEndpoint,
      onChunk: jest.fn(),
      mcpServers: [{ ...mockServer, enabled: false }],
      mcpEnabled: true,
    });

    expect(mcpClient.getToolsFromServers).not.toHaveBeenCalled();
  });

  it("warns when MCP server returns errors", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
      tools: [],
      errors: [{ serverName: "Test Server", error: "Timeout" }],
    });

    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValue({ fullContent: "Done", toolCalls: [] }),
    };

    const agent = new AgentCore({ driver });

    await agent.runChat({
      messages: [
        { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
      ],
      endpoint: mockEndpoint,
      onChunk: jest.fn(),
      mcpServers: [mockServer],
      mcpEnabled: true,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "MCP server errors:",
      expect.arrayContaining([expect.objectContaining({ error: "Timeout" })]),
    );
    warnSpy.mockRestore();
  });

  it("handles unknown tool", async () => {
    const toolCalls = [
      {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "server1__missing",
          arguments: "{}",
        },
      },
    ];

    (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
      tools: [],
      errors: [],
    });

    (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValueOnce([]);

    (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
      serverId: "server1",
      toolName: "missing",
    });

    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValueOnce({ fullContent: "", toolCalls })
        .mockResolvedValueOnce({ fullContent: "Done", toolCalls: [] }),
    };

    const agent = new AgentCore({ driver });

    await agent.runChat({
      messages: [
        { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
      ],
      endpoint: mockEndpoint,
      onChunk: jest.fn(),
      mcpServers: [mockServer],
      mcpEnabled: true,
    });

    const secondCall = (driver.streamChat as jest.Mock).mock.calls[1][0];
    const toolMessage = secondCall.messages.find(
      (msg: Message) => msg.role === "tool",
    );

    expect(toolMessage.content).toBe('Error: Unknown tool "server1__missing"');
  });

  it("formats tool results and handles execution errors", async () => {
    const toolCalls = [
      {
        id: "call_empty",
        type: "function" as const,
        function: {
          name: "server1__empty",
          arguments: "{bad json",
        },
      },
      {
        id: "call_image",
        type: "function" as const,
        function: {
          name: "server1__image",
          arguments: "{}",
        },
      },
      {
        id: "call_weird",
        type: "function" as const,
        function: {
          name: "server1__weird",
          arguments: "{}",
        },
      },
      {
        id: "call_fail",
        type: "function" as const,
        function: {
          name: "server1__fail",
          arguments: "{}",
        },
      },
    ];

    (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
      tools: [
        {
          name: "empty",
          description: "Empty tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
        {
          name: "image",
          description: "Image tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
        {
          name: "weird",
          description: "Weird tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
        {
          name: "fail",
          description: "Fail tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ],
      errors: [],
    });

    (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValueOnce([
      {
        type: "function",
        function: {
          name: "server1__empty",
          description: "[Test Server] Empty tool",
          parameters: { type: "object" },
        },
      },
      {
        type: "function",
        function: {
          name: "server1__image",
          description: "[Test Server] Image tool",
          parameters: { type: "object" },
        },
      },
      {
        type: "function",
        function: {
          name: "server1__weird",
          description: "[Test Server] Weird tool",
          parameters: { type: "object" },
        },
      },
      {
        type: "function",
        function: {
          name: "server1__fail",
          description: "[Test Server] Fail tool",
          parameters: { type: "object" },
        },
      },
    ]);

    (mcpClient.parseToolCallName as jest.Mock).mockImplementation(
      (name: string) => ({
        serverId: "server1",
        toolName: name.split("__")[1],
      }),
    );

    (mcpClient.executeToolCall as jest.Mock)
      .mockResolvedValueOnce({ content: [] })
      .mockResolvedValueOnce({
        content: [{ type: "image", data: "base64", mimeType: "image/jpeg" }],
      })
      .mockResolvedValueOnce({
        content: [{ type: "unknown", data: { foo: "bar" } }],
      })
      .mockRejectedValueOnce(new Error("Boom"));

    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValueOnce({ fullContent: "", toolCalls })
        .mockResolvedValueOnce({ fullContent: "Done", toolCalls: [] }),
    };

    const agent = new AgentCore({ driver });

    await agent.runChat({
      messages: [
        { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
      ],
      endpoint: mockEndpoint,
      onChunk: jest.fn(),
      mcpServers: [mockServer],
      mcpEnabled: true,
    });

    expect(mcpClient.executeToolCall).toHaveBeenCalledWith(
      mockServer,
      "empty",
      {},
    );

    const secondCall = (driver.streamChat as jest.Mock).mock.calls[1][0];
    const toolMessages = secondCall.messages.filter(
      (msg: Message) => msg.role === "tool",
    );

    expect(toolMessages[0].content).toBe("No result");
    expect(toolMessages[1].content).toBe("[Image: image/jpeg]");
    expect(toolMessages[2].content).toBe(
      JSON.stringify({ type: "unknown", data: { foo: "bar" } }),
    );
    expect(toolMessages[3].content).toBe("Error executing tool: Boom");
  });

  it("handles missing server for tool", async () => {
    const toolCalls = [
      {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "server1__tool",
          arguments: "{}",
        },
      },
    ];

    (mcpClient.getToolsFromServers as jest.Mock).mockResolvedValueOnce({
      tools: [
        {
          name: "tool",
          description: "Tool",
          inputSchema: { type: "object" },
          serverName: "Test Server",
          serverId: "server1",
        },
      ],
      errors: [],
    });

    (mcpClient.mcpToolsToOpenAIFunctions as jest.Mock).mockReturnValueOnce([
      {
        type: "function",
        function: {
          name: "server1__tool",
          description: "[Test Server] Tool",
          parameters: { type: "object" },
        },
      },
    ]);

    (mcpClient.parseToolCallName as jest.Mock).mockReturnValue({
      serverId: "missing",
      toolName: "tool",
    });

    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValueOnce({ fullContent: "", toolCalls })
        .mockResolvedValueOnce({ fullContent: "Done", toolCalls: [] }),
    };

    const agent = new AgentCore({ driver });

    await agent.runChat({
      messages: [
        { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
      ],
      endpoint: mockEndpoint,
      onChunk: jest.fn(),
      mcpServers: [mockServer],
      mcpEnabled: true,
    });

    const secondCall = (driver.streamChat as jest.Mock).mock.calls[1][0];
    const toolMessage = secondCall.messages.find(
      (msg: Message) => msg.role === "tool",
    );

    expect(toolMessage.content).toBe(
      "Error: Server not found for tool server1__tool",
    );
  });

  it("handles tool loading failure", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation();

    (mcpClient.getToolsFromServers as jest.Mock).mockRejectedValueOnce(
      new Error("Network down"),
    );

    const driver = {
      streamChat: jest
        .fn()
        .mockResolvedValue({ fullContent: "Done", toolCalls: [] }),
    };

    const agent = new AgentCore({ driver });

    await agent.runChat({
      messages: [
        { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
      ],
      endpoint: mockEndpoint,
      onChunk: jest.fn(),
      mcpServers: [mockServer],
      mcpEnabled: true,
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to fetch MCP tools:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
