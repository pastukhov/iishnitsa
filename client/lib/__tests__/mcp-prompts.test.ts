import {
  findPromptsChatServer,
  isCacheValid,
  getCacheAge,
  PROMPTS_CHAT_URL,
  PROMPTS_CHAT_SERVER_ID,
  PromptCache,
} from "@/lib/mcp-prompts";
import { MCPServer } from "@/lib/store";

describe("mcp-prompts", () => {
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
});
