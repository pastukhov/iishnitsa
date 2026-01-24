import {
  findPromptsChatServer,
  isCacheValid,
  getCacheAge,
  PROMPTS_CHAT_URL,
  PROMPTS_CHAT_SERVER_ID,
  PromptCache,
  loadPromptsFromMCP,
  getCachedPrompts,
  setCachedPrompts,
  clearPromptCache,
} from "@/lib/mcp-prompts";
import { MCPServer } from "@/lib/store";
import { MCPClient } from "@/lib/mcp-client";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/lib/mcp-client");
jest.mock("@react-native-async-storage/async-storage");

const MockedMCPClient = MCPClient as jest.MockedClass<typeof MCPClient>;
const MockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe("mcp-prompts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("findPromptsChatServer", () => {
    it("finds server by URL", () => {
      const servers: MCPServer[] = [
        { id: "other", name: "Other", url: "https://other.com", enabled: true },
        {
          id: "prompts",
          name: "Prompts",
          url: PROMPTS_CHAT_URL,
          enabled: true,
        },
      ];
      const result = findPromptsChatServer(servers);
      expect(result?.id).toBe("prompts");
    });

    it("finds server by ID", () => {
      const servers: MCPServer[] = [
        {
          id: PROMPTS_CHAT_SERVER_ID,
          name: "Custom",
          url: "https://custom.com",
          enabled: true,
        },
      ];
      const result = findPromptsChatServer(servers);
      expect(result?.id).toBe(PROMPTS_CHAT_SERVER_ID);
    });

    it("returns undefined when not found", () => {
      const servers: MCPServer[] = [
        { id: "other", name: "Other", url: "https://other.com", enabled: true },
      ];
      const result = findPromptsChatServer(servers);
      expect(result).toBeUndefined();
    });

    it("returns undefined for empty array", () => {
      const result = findPromptsChatServer([]);
      expect(result).toBeUndefined();
    });
  });

  describe("isCacheValid", () => {
    it("returns false for null cache", () => {
      expect(isCacheValid(null)).toBe(false);
    });

    it("returns false for empty prompts", () => {
      const cache: PromptCache = {
        version: 1,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: [],
      };
      expect(isCacheValid(cache)).toBe(false);
    });

    it("returns true for valid cache", () => {
      const cache: PromptCache = {
        version: 1,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: [{ id: "1", title: "Test", prompt: "Test", category: "Test" }],
      };
      expect(isCacheValid(cache)).toBe(true);
    });

    it("returns false for expired cache", () => {
      const cache: PromptCache = {
        version: 1,
        timestamp: Date.now() - 48 * 60 * 60 * 1000, // 48 hours ago
        ttl: 24 * 60 * 60 * 1000, // 24 hour TTL
        source: "mcp",
        prompts: [{ id: "1", title: "Test", prompt: "Test", category: "Test" }],
      };
      expect(isCacheValid(cache)).toBe(false);
    });

    it("returns true for cache just before expiry", () => {
      const cache: PromptCache = {
        version: 1,
        timestamp: Date.now() - 23 * 60 * 60 * 1000, // 23 hours ago
        ttl: 24 * 60 * 60 * 1000, // 24 hour TTL
        source: "mcp",
        prompts: [{ id: "1", title: "Test", prompt: "Test", category: "Test" }],
      };
      expect(isCacheValid(cache)).toBe(true);
    });
  });

  describe("getCacheAge", () => {
    it("returns null for null cache", () => {
      expect(getCacheAge(null)).toBeNull();
    });

    it("returns age in milliseconds", () => {
      const timestamp = Date.now() - 1000;
      const cache: PromptCache = {
        version: 1,
        timestamp,
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: [],
      };
      const age = getCacheAge(cache);
      expect(age).toBeGreaterThanOrEqual(1000);
      expect(age).toBeLessThan(2000);
    });

    it("returns zero for fresh cache", () => {
      const cache: PromptCache = {
        version: 1,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: [],
      };
      const age = getCacheAge(cache);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(100);
    });
  });

  describe("loadPromptsFromMCP", () => {
    const mockServer: MCPServer = {
      id: "prompts",
      name: "Prompts",
      url: PROMPTS_CHAT_URL,
      enabled: true,
    };

    it("returns empty array when no prompts server found", async () => {
      const result = await loadPromptsFromMCP([]);
      expect(result).toEqual([]);
    });

    it("returns empty array when prompts server is disabled", async () => {
      const disabledServer: MCPServer = { ...mockServer, enabled: false };
      const result = await loadPromptsFromMCP([disabledServer]);
      expect(result).toEqual([]);
    });

    it("loads prompts from MCP server successfully", async () => {
      const mockPrompts = {
        prompts: [
          {
            id: "1",
            title: "Test Prompt",
            content: "Test content",
            category: "Testing",
            tags: ["test"],
            description: "A test prompt",
            author: "tester",
            votes: 10,
            type: "TEXT",
          },
        ],
      };

      const mockInitialize = jest.fn().mockResolvedValue(undefined);
      const mockCallTool = jest.fn().mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: JSON.stringify(mockPrompts) }],
      });

      MockedMCPClient.mockImplementation(
        () =>
          ({
            initialize: mockInitialize,
            callTool: mockCallTool,
          }) as any,
      );

      const result = await loadPromptsFromMCP([mockServer]);

      expect(mockInitialize).toHaveBeenCalled();
      expect(mockCallTool).toHaveBeenCalledWith("search_prompts", {
        query: "",
        limit: 50,
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "1",
        title: "Test Prompt",
        prompt: "Test content",
        category: "Testing",
        tags: ["test"],
        description: "A test prompt",
        author: "tester",
        votes: 10,
        type: "TEXT",
        slug: undefined,
        createdAt: undefined,
      });
    });

    it("respects limit parameter (capped at 50)", async () => {
      const mockCallTool = jest.fn().mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ prompts: [] }) }],
      });

      MockedMCPClient.mockImplementation(
        () =>
          ({
            initialize: jest.fn().mockResolvedValue(undefined),
            callTool: mockCallTool,
          }) as any,
      );

      await loadPromptsFromMCP([mockServer], 100);

      expect(mockCallTool).toHaveBeenCalledWith("search_prompts", {
        query: "",
        limit: 50,
      });
    });

    it("returns empty array when MCP returns error", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      MockedMCPClient.mockImplementation(
        () =>
          ({
            initialize: jest.fn().mockResolvedValue(undefined),
            callTool: jest.fn().mockResolvedValue({
              isError: true,
              content: [{ type: "text", text: "Error message" }],
            }),
          }) as any,
      );

      const result = await loadPromptsFromMCP([mockServer]);

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "MCP search_prompts returned error:",
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });

    it("returns empty array when no text content", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      MockedMCPClient.mockImplementation(
        () =>
          ({
            initialize: jest.fn().mockResolvedValue(undefined),
            callTool: jest.fn().mockResolvedValue({
              isError: false,
              content: [{ type: "image", data: "..." }],
            }),
          }) as any,
      );

      const result = await loadPromptsFromMCP([mockServer]);

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "MCP search_prompts returned no text content",
      );

      consoleSpy.mockRestore();
    });

    it("returns empty array when content is undefined", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      MockedMCPClient.mockImplementation(
        () =>
          ({
            initialize: jest.fn().mockResolvedValue(undefined),
            callTool: jest.fn().mockResolvedValue({
              isError: false,
              content: undefined,
            }),
          }) as any,
      );

      const result = await loadPromptsFromMCP([mockServer]);

      expect(result).toEqual([]);

      consoleSpy.mockRestore();
    });

    it("throws error when MCP client fails", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      MockedMCPClient.mockImplementation(
        () =>
          ({
            initialize: jest
              .fn()
              .mockRejectedValue(new Error("Connection failed")),
            callTool: jest.fn(),
          }) as any,
      );

      await expect(loadPromptsFromMCP([mockServer])).rejects.toThrow(
        "Connection failed",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to load prompts from MCP:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("maps prompts with missing optional fields", async () => {
      const mockPrompts = {
        prompts: [
          {
            id: "1",
            title: "Minimal Prompt",
            content: "Content only",
          },
        ],
      };

      MockedMCPClient.mockImplementation(
        () =>
          ({
            initialize: jest.fn().mockResolvedValue(undefined),
            callTool: jest.fn().mockResolvedValue({
              isError: false,
              content: [{ type: "text", text: JSON.stringify(mockPrompts) }],
            }),
          }) as any,
      );

      const result = await loadPromptsFromMCP([mockServer]);

      expect(result[0]).toEqual({
        id: "1",
        title: "Minimal Prompt",
        prompt: "Content only",
        category: "Uncategorized",
        tags: [],
        description: undefined,
        author: undefined,
        votes: undefined,
        type: undefined,
        slug: undefined,
        createdAt: undefined,
      });
    });
  });

  describe("getCachedPrompts", () => {
    it("returns null when no cache exists", async () => {
      MockedAsyncStorage.getItem.mockResolvedValue(null);

      const result = await getCachedPrompts();

      expect(result).toBeNull();
    });

    it("returns cached prompts", async () => {
      const cache: PromptCache = {
        version: 1,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: [{ id: "1", title: "Test", prompt: "Test", category: "Test" }],
      };

      MockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(cache));

      const result = await getCachedPrompts();

      expect(result).toEqual(cache);
    });

    it("clears cache and returns null for invalid version", async () => {
      const cache = {
        version: 999,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: [],
      };

      MockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(cache));
      MockedAsyncStorage.removeItem.mockResolvedValue();

      const result = await getCachedPrompts();

      expect(result).toBeNull();
      expect(MockedAsyncStorage.removeItem).toHaveBeenCalled();
    });

    it("clears cache and returns null on parse error", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      MockedAsyncStorage.getItem.mockResolvedValue("invalid json");
      MockedAsyncStorage.removeItem.mockResolvedValue();

      const result = await getCachedPrompts();

      expect(result).toBeNull();
      expect(MockedAsyncStorage.removeItem).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to read prompt cache:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("setCachedPrompts", () => {
    it("saves prompts to cache", async () => {
      const prompts = [
        { id: "1", title: "Test", prompt: "Test", category: "Test" },
      ];

      MockedAsyncStorage.setItem.mockResolvedValue();

      await setCachedPrompts(prompts, "mcp");

      expect(MockedAsyncStorage.setItem).toHaveBeenCalledWith(
        "@ai_agent_mcp_prompts_cache",
        expect.stringContaining('"version":1'),
      );
    });

    it("logs error when save fails", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      MockedAsyncStorage.setItem.mockRejectedValue(new Error("Storage full"));

      await setCachedPrompts([], "mcp");

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to save prompt cache:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("clearPromptCache", () => {
    it("removes cache from storage", async () => {
      MockedAsyncStorage.removeItem.mockResolvedValue();

      await clearPromptCache();

      expect(MockedAsyncStorage.removeItem).toHaveBeenCalledWith(
        "@ai_agent_mcp_prompts_cache",
      );
    });

    it("logs warning when clear fails", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      MockedAsyncStorage.removeItem.mockRejectedValue(
        new Error("Storage error"),
      );

      await clearPromptCache();

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to clear prompt cache:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });
});
