import {
  sendChatMessage,
  flushQueuedChatMessages,
  testConnection,
  testMCPServer,
} from "../api";
import { Message, EndpointConfig, MCPServer } from "../store";
import * as mcpClient from "../mcp-client";
import * as providers from "../providers";
import * as agentCore from "../agent/core";
import * as offlineQueue from "../offline-queue";

jest.mock("../mcp-client", () => ({
  getToolsFromServers: jest.fn(),
}));

jest.mock("../providers", () => ({
  fetchProviderModels: jest.fn(),
}));

jest.mock("../agent/core", () => ({
  runAgentChat: jest.fn(),
}));

jest.mock("../offline-queue", () => ({
  enqueueChatRequest: jest.fn(),
  flushQueuedChatRequests: jest.fn(),
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
  });

  describe("sendChatMessage", () => {
    it("delegates to agent core", async () => {
      const onChunk = jest.fn();

      await sendChatMessage(mockMessages, mockEndpoint, onChunk);

      expect(agentCore.runAgentChat).toHaveBeenCalledWith(
        mockMessages,
        mockEndpoint,
        onChunk,
        [],
        false,
        undefined,
      );
    });

    it("passes MCP params when enabled", async () => {
      const onChunk = jest.fn();
      const mcpServers: MCPServer[] = [
        {
          id: "server1",
          name: "Test Server",
          url: "http://localhost:3000",
          enabled: true,
        },
      ];

      await sendChatMessage(
        mockMessages,
        mockEndpoint,
        onChunk,
        mcpServers,
        true,
      );

      expect(agentCore.runAgentChat).toHaveBeenCalledWith(
        mockMessages,
        mockEndpoint,
        onChunk,
        mcpServers,
        true,
        undefined,
      );
    });

    it("surfaces agent errors", async () => {
      (agentCore.runAgentChat as jest.Mock).mockRejectedValueOnce(
        new Error("Agent failed"),
      );

      await expect(
        sendChatMessage(mockMessages, mockEndpoint, jest.fn()),
      ).rejects.toThrow("Agent failed");
    });

    it("queues on network failure when enabled", async () => {
      (agentCore.runAgentChat as jest.Mock).mockRejectedValueOnce(
        new Error("Network request failed"),
      );
      (offlineQueue.enqueueChatRequest as jest.Mock).mockResolvedValueOnce({
        id: "queued-1",
      });

      const onQueued = jest.fn();
      await sendChatMessage(mockMessages, mockEndpoint, jest.fn(), [], false, {
        queueOnFailure: true,
        chatId: "chat-1",
        onQueued,
      });

      expect(offlineQueue.enqueueChatRequest).toHaveBeenCalledWith({
        chatId: "chat-1",
        messages: mockMessages,
        endpoint: mockEndpoint,
        mcpServers: [],
        mcpEnabled: false,
      });
      expect(onQueued).toHaveBeenCalledWith("queued-1");
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

  describe("flushQueuedChatMessages", () => {
    it("delegates to offline queue flush", async () => {
      (offlineQueue.flushQueuedChatRequests as jest.Mock).mockResolvedValueOnce(
        {
          processed: 1,
          failed: 0,
          remaining: 0,
        },
      );

      const result = await flushQueuedChatMessages({
        chatId: "chat-1",
        onChunk: jest.fn(),
      });

      expect(offlineQueue.flushQueuedChatRequests).toHaveBeenCalled();
      expect(result.processed).toBe(1);
    });
  });
});
