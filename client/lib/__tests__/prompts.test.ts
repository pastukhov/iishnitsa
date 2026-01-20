import { SYSTEM_PROMPTS, getPromptById, searchPrompts } from "@/lib/prompts";

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
});
