import {
  searchPrompts,
  getPromptById,
  getPromptCategories,
  getPromptsByCategory,
  getTopTags,
  getPromptsByTag,
  getPromptsByIds,
  getAllTags,
  getPromptsSource,
  getLoadedPromptsCount,
} from "@/lib/prompts";

// Note: These tests run against the module's internal state
// which starts empty until initializePrompts is called

describe("prompts", () => {
  describe("initial state", () => {
    it("starts with no prompts loaded", () => {
      expect(getLoadedPromptsCount()).toBe(0);
    });

    it("starts with source as none", () => {
      expect(getPromptsSource()).toBe("none");
    });
  });

  describe("search and filter functions with empty state", () => {
    it("searchPrompts returns empty array", () => {
      expect(searchPrompts("test")).toEqual([]);
    });

    it("getPromptById returns undefined", () => {
      expect(getPromptById("test-id")).toBeUndefined();
    });

    it("getPromptCategories returns empty array", () => {
      expect(getPromptCategories()).toEqual([]);
    });

    it("getPromptsByCategory returns empty array", () => {
      expect(getPromptsByCategory("Test")).toEqual([]);
    });

    it("getTopTags returns empty array", () => {
      expect(getTopTags()).toEqual([]);
    });

    it("getPromptsByTag returns empty array", () => {
      expect(getPromptsByTag("test")).toEqual([]);
    });

    it("getPromptsByIds returns empty array", () => {
      expect(getPromptsByIds(["id1", "id2"])).toEqual([]);
    });

    it("getAllTags returns empty array", () => {
      expect(getAllTags()).toEqual([]);
    });
  });
});
