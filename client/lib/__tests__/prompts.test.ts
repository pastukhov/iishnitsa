import {
  initializePrompts,
  getPromptsSource,
  getCacheTimestamp,
  getLoadedPromptsCount,
  getPromptCategories,
  getPromptsByCategory,
  searchPrompts,
  getPromptById,
  getAllTags,
  getTopTags,
  getPromptsByTag,
  getPromptsByIds,
  SystemPrompt,
} from "@/lib/prompts";
import * as mcpPrompts from "@/lib/mcp-prompts";

jest.mock("@/lib/mcp-prompts");

const MockedMcpPrompts = mcpPrompts as jest.Mocked<typeof mcpPrompts>;

describe("prompts", () => {
  const mockPrompts: SystemPrompt[] = [
    {
      id: "1",
      title: "Code Review",
      prompt: "Review this code",
      category: "Development",
      tags: ["code", "review"],
    },
    {
      id: "2",
      title: "Write Tests",
      prompt: "Write unit tests",
      category: "Development",
      tags: ["code", "testing"],
    },
    {
      id: "3",
      title: "Summarize Article",
      prompt: "Summarize this article",
      category: "Writing",
      tags: ["writing", "summary"],
    },
    {
      id: "4",
      title: "Debug Error",
      prompt: "Debug this error",
      category: "Development",
      tags: ["code", "debugging"],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    MockedMcpPrompts.getCachedPrompts.mockResolvedValue(null);
    MockedMcpPrompts.isCacheValid.mockReturnValue(false);
    MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue([]);
    MockedMcpPrompts.setCachedPrompts.mockResolvedValue();
  });

  describe("initializePrompts", () => {
    it("returns cached prompts when cache is valid", async () => {
      const cache: mcpPrompts.PromptCache = {
        version: 1,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: mockPrompts,
      };

      MockedMcpPrompts.getCachedPrompts.mockResolvedValue(cache);
      MockedMcpPrompts.isCacheValid.mockReturnValue(true);

      const result = await initializePrompts([]);

      expect(result.source).toBe("mcp");
      expect(result.prompts).toEqual(mockPrompts);
      expect(MockedMcpPrompts.loadPromptsFromMCP).not.toHaveBeenCalled();
    });

    it("loads from MCP when cache is invalid", async () => {
      MockedMcpPrompts.getCachedPrompts.mockResolvedValue(null);
      MockedMcpPrompts.isCacheValid.mockReturnValue(false);
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);

      const result = await initializePrompts([]);

      expect(result.source).toBe("mcp");
      expect(result.prompts).toEqual(mockPrompts);
      expect(MockedMcpPrompts.setCachedPrompts).toHaveBeenCalledWith(
        mockPrompts,
        "mcp",
      );
    });

    it("forces refresh when forceRefresh is true", async () => {
      const cache: mcpPrompts.PromptCache = {
        version: 1,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: mockPrompts,
      };

      MockedMcpPrompts.getCachedPrompts.mockResolvedValue(cache);
      MockedMcpPrompts.isCacheValid.mockReturnValue(true);
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);

      const result = await initializePrompts([], true);

      expect(MockedMcpPrompts.loadPromptsFromMCP).toHaveBeenCalled();
      expect(result.source).toBe("mcp");
    });

    it("returns none source when MCP fails", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      MockedMcpPrompts.loadPromptsFromMCP.mockRejectedValue(
        new Error("MCP error"),
      );

      const result = await initializePrompts([]);

      expect(result.source).toBe("none");
      expect(result.prompts).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to load prompts from MCP:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("returns none source when MCP returns empty array", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue([]);

      const result = await initializePrompts([]);

      expect(result.source).toBe("none");
      expect(result.prompts).toEqual([]);
    });

    it("handles cache with local source", async () => {
      const cache: mcpPrompts.PromptCache = {
        version: 1,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000,
        source: "local",
        prompts: mockPrompts,
      };

      MockedMcpPrompts.getCachedPrompts.mockResolvedValue(cache);
      MockedMcpPrompts.isCacheValid.mockReturnValue(true);

      const result = await initializePrompts([]);

      expect(result.source).toBe("none");
    });
  });

  describe("getPromptsSource", () => {
    it("returns current source after initialization", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);

      await initializePrompts([]);

      expect(getPromptsSource()).toBe("mcp");
    });

    it("returns none when no prompts loaded", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue([]);

      await initializePrompts([]);

      expect(getPromptsSource()).toBe("none");
    });
  });

  describe("getCacheTimestamp", () => {
    it("returns timestamp after MCP load", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);

      await initializePrompts([]);

      const timestamp = getCacheTimestamp();
      expect(timestamp).toBeDefined();
      expect(typeof timestamp).toBe("number");
    });

    it("returns null when no prompts loaded", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue([]);

      await initializePrompts([]);

      expect(getCacheTimestamp()).toBeNull();
    });

    it("returns cache timestamp from valid cache", async () => {
      const cacheTime = Date.now() - 1000;
      const cache: mcpPrompts.PromptCache = {
        version: 1,
        timestamp: cacheTime,
        ttl: 24 * 60 * 60 * 1000,
        source: "mcp",
        prompts: mockPrompts,
      };

      MockedMcpPrompts.getCachedPrompts.mockResolvedValue(cache);
      MockedMcpPrompts.isCacheValid.mockReturnValue(true);

      await initializePrompts([]);

      expect(getCacheTimestamp()).toBe(cacheTime);
    });
  });

  describe("getLoadedPromptsCount", () => {
    it("returns count of loaded prompts", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);

      await initializePrompts([]);

      expect(getLoadedPromptsCount()).toBe(4);
    });

    it("returns 0 when no prompts loaded", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue([]);

      await initializePrompts([]);

      expect(getLoadedPromptsCount()).toBe(0);
    });
  });

  describe("getPromptCategories", () => {
    it("returns unique categories", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);

      await initializePrompts([]);

      const categories = getPromptCategories();
      expect(categories).toContain("Development");
      expect(categories).toContain("Writing");
      expect(categories).toHaveLength(2);
    });

    it("returns empty array when no prompts", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue([]);

      await initializePrompts([]);

      expect(getPromptCategories()).toEqual([]);
    });
  });

  describe("getPromptsByCategory", () => {
    it("filters prompts by category", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);

      await initializePrompts([]);

      const devPrompts = getPromptsByCategory("Development");
      expect(devPrompts).toHaveLength(3);
      expect(devPrompts.every((p) => p.category === "Development")).toBe(true);
    });

    it("returns empty array for non-existent category", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);

      await initializePrompts([]);

      expect(getPromptsByCategory("NonExistent")).toEqual([]);
    });
  });

  describe("searchPrompts", () => {
    beforeEach(async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);
      await initializePrompts([]);
    });

    it("returns all prompts for empty query", () => {
      expect(searchPrompts("")).toHaveLength(4);
    });

    it("returns all prompts for whitespace query", () => {
      expect(searchPrompts("   ")).toHaveLength(4);
    });

    it("searches by title", () => {
      const results = searchPrompts("Code Review");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("searches by category", () => {
      const results = searchPrompts("Writing");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("3");
    });

    it("searches by prompt content", () => {
      const results = searchPrompts("unit tests");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("2");
    });

    it("searches by tag", () => {
      const results = searchPrompts("debugging");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("4");
    });

    it("is case insensitive", () => {
      const results = searchPrompts("CODE");
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns multiple matches", () => {
      const results = searchPrompts("code");
      expect(results.length).toBeGreaterThan(1);
    });
  });

  describe("getPromptById", () => {
    beforeEach(async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);
      await initializePrompts([]);
    });

    it("finds prompt by id", () => {
      const prompt = getPromptById("2");
      expect(prompt).toBeDefined();
      expect(prompt?.title).toBe("Write Tests");
    });

    it("returns undefined for non-existent id", () => {
      expect(getPromptById("999")).toBeUndefined();
    });
  });

  describe("getAllTags", () => {
    beforeEach(async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);
      await initializePrompts([]);
    });

    it("returns all unique tags sorted", () => {
      const tags = getAllTags();
      expect(tags).toContain("code");
      expect(tags).toContain("review");
      expect(tags).toContain("testing");
      expect(tags).toContain("writing");
      expect(tags).toContain("summary");
      expect(tags).toContain("debugging");
      expect(tags).toEqual([...tags].sort());
    });

    it("returns empty array when no prompts", async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue([]);
      await initializePrompts([], true);

      expect(getAllTags()).toEqual([]);
    });
  });

  describe("getTopTags", () => {
    beforeEach(async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);
      await initializePrompts([]);
    });

    it("returns tags sorted by frequency", () => {
      const tags = getTopTags(3);
      expect(tags[0]).toBe("code"); // appears 3 times
      expect(tags.length).toBeLessThanOrEqual(3);
    });

    it("respects limit parameter", () => {
      const tags = getTopTags(2);
      expect(tags).toHaveLength(2);
    });

    it("uses default limit of 10", () => {
      const tags = getTopTags();
      expect(tags.length).toBeLessThanOrEqual(10);
    });
  });

  describe("getPromptsByTag", () => {
    beforeEach(async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);
      await initializePrompts([]);
    });

    it("filters prompts by tag", () => {
      const results = getPromptsByTag("code");
      expect(results).toHaveLength(3);
    });

    it("returns empty array for non-existent tag", () => {
      expect(getPromptsByTag("nonexistent")).toEqual([]);
    });
  });

  describe("getPromptsByIds", () => {
    beforeEach(async () => {
      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(mockPrompts);
      await initializePrompts([]);
    });

    it("returns prompts matching ids", () => {
      const results = getPromptsByIds(["1", "3"]);
      expect(results).toHaveLength(2);
      expect(results.map((p) => p.id)).toContain("1");
      expect(results.map((p) => p.id)).toContain("3");
    });

    it("returns empty array when no matches", () => {
      expect(getPromptsByIds(["999", "888"])).toEqual([]);
    });

    it("returns empty array for empty ids array", () => {
      expect(getPromptsByIds([])).toEqual([]);
    });

    it("ignores non-existent ids", () => {
      const results = getPromptsByIds(["1", "999"]);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });
  });

  describe("prompts without tags", () => {
    it("handles prompts with undefined tags", async () => {
      const promptsWithoutTags: SystemPrompt[] = [
        {
          id: "1",
          title: "No Tags",
          prompt: "Content",
          category: "Test",
        },
      ];

      MockedMcpPrompts.loadPromptsFromMCP.mockResolvedValue(promptsWithoutTags);
      await initializePrompts([], true);

      expect(getAllTags()).toEqual([]);
      expect(getPromptsByTag("any")).toEqual([]);
      expect(searchPrompts("sometag")).toEqual([]);
    });
  });

  it("returns all unique tags sorted", () => {
    const tags = getAllTags();
    expect(tags.length).toBeGreaterThan(0);
    expect(tags).toEqual([...new Set(tags)].sort());
  });

  it("returns top tags by frequency", () => {
    const topTags = getTopTags(5);
    expect(topTags.length).toBeLessThanOrEqual(5);
    expect(topTags.length).toBeGreaterThan(0);
  });

  it("filters prompts by tag", () => {
    const allTags = getAllTags();
    if (allTags.length === 0) return;

    const tag = allTags[0];
    const results = getPromptsByTag(tag);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((prompt) => {
      expect(prompt.tags).toContain(tag);
    });
  });

  it("returns prompts by ids in correct order", () => {
    const ids = SYSTEM_PROMPTS.slice(0, 3).map((p) => p.id);
    const results = getPromptsByIds(ids);
    expect(results.length).toBe(3);
    results.forEach((prompt) => {
      expect(ids).toContain(prompt.id);
    });
  });

  it("filters prompts by ids ignoring non-existent", () => {
    const validId = SYSTEM_PROMPTS[0].id;
    const results = getPromptsByIds([validId, "non-existent-id"]);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(validId);
  });

  it("localizes prompts returned by ids", () => {
    const id = "weekly-planning-coach";
    const results = getPromptsByIds([id], "ru");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("🧠 Коуч по еженедельному планированию");
  });
});
