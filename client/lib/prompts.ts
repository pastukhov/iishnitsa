import { SYSTEM_PROMPTS as PROMPT_DATA } from "@/lib/prompts-data";

export interface SystemPrompt {
  id: string;
  title: string;
  prompt: string;
  category: string;
  tags?: string[];
}

export const SYSTEM_PROMPTS: SystemPrompt[] = PROMPT_DATA.map((prompt) => ({
  ...prompt,
  tags: prompt.tags ? [...prompt.tags] : undefined,
}));

export const PROMPT_CATEGORIES = Array.from(
  new Set(SYSTEM_PROMPTS.map((prompt) => prompt.category)),
);

export type PromptCategory = string;

export function getPromptsByCategory(category: PromptCategory): SystemPrompt[] {
  return SYSTEM_PROMPTS.filter((p) => p.category === category);
}

export function searchPrompts(query: string): SystemPrompt[] {
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) return SYSTEM_PROMPTS;

  return SYSTEM_PROMPTS.filter(
    (p) =>
      p.title.toLowerCase().includes(lowerQuery) ||
      p.category.toLowerCase().includes(lowerQuery) ||
      p.prompt.toLowerCase().includes(lowerQuery) ||
      (p.tags || []).some((tag) => tag.toLowerCase().includes(lowerQuery)),
  );
}

export function getPromptById(id: string): SystemPrompt | undefined {
  return SYSTEM_PROMPTS.find((prompt) => prompt.id === id);
}
