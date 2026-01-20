import {
  SYSTEM_PROMPTS,
  getPromptById,
  getPromptsByCategory,
  searchPrompts,
  localizePrompt,
  getLocalizedPromptById,
} from "@/lib/prompts";

describe("prompts", () => {
  it("loads prompt catalog", () => {
    expect(SYSTEM_PROMPTS.length).toBeGreaterThan(0);
  });

  it("finds a prompt by id", () => {
    const sample = SYSTEM_PROMPTS[0];
    const found = getPromptById(sample.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe(sample.title);
  });

  it("searches prompts by tag", () => {
    const promptWithTag = SYSTEM_PROMPTS.find(
      (prompt) => prompt.tags && prompt.tags.length > 0,
    );
    expect(promptWithTag).toBeDefined();
    if (!promptWithTag?.tags) return;

    const tag = promptWithTag.tags[0];
    const results = searchPrompts(tag);
    expect(results.some((prompt) => prompt.id === promptWithTag.id)).toBe(true);
  });

  it("returns all prompts for empty query", () => {
    const results = searchPrompts("");
    expect(results.length).toBe(SYSTEM_PROMPTS.length);
  });

  it("filters prompts by category", () => {
    const sample = SYSTEM_PROMPTS[0];
    const results = getPromptsByCategory(sample.category);
    expect(results.some((prompt) => prompt.id === sample.id)).toBe(true);
  });

  it("localizes prompt titles for ru", () => {
    const localized = getLocalizedPromptById("weekly-planning-coach", "ru");
    expect(localized?.title).toBe("🧠 Коуч по еженедельному планированию");
    expect(localized?.category).toBe("Лучшие промпты");
  });

  it("keeps original prompt when locale missing", () => {
    const original = getPromptById("weekly-planning-coach");
    expect(original).toBeDefined();
    if (!original) return;

    const localized = localizePrompt(original, "fr");
    expect(localized.title).toBe(original.title);
    expect(localized.category).toBe(original.category);
  });
});
