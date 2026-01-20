import { SYSTEM_PROMPTS as PROMPT_DATA } from "@/lib/prompts-data";
import { PROMPT_LOCALES } from "@/lib/prompts-locales";

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

function getLocaleKey(locale?: string): string | null {
  if (!locale) return null;
  const normalized = locale.toLowerCase();
  return normalized.split("-")[0];
}

function getLocaleData(locale?: string) {
  const key = getLocaleKey(locale);
  if (!key) return null;
  return (
    (PROMPT_LOCALES[key as keyof typeof PROMPT_LOCALES] as {
      titles: Record<string, string>;
      categories: Record<string, string>;
    }) || null
  );
}

export function localizePrompt(
  prompt: SystemPrompt,
  locale?: string,
): SystemPrompt {
  const localeData = getLocaleData(locale);
  if (!localeData) return prompt;

  return {
    ...prompt,
    title: localeData.titles[prompt.id] || prompt.title,
    category:
      localeData.categories[prompt.category] ||
      localeData.categories["Awesome Prompts"] ||
      prompt.category,
  };
}

export function getLocalizedPrompts(locale?: string): SystemPrompt[] {
  return SYSTEM_PROMPTS.map((prompt) => localizePrompt(prompt, locale));
}

export function getPromptCategories(locale?: string): string[] {
  const prompts = getLocalizedPrompts(locale);
  return Array.from(new Set(prompts.map((prompt) => prompt.category)));
}

export function getPromptsByCategory(
  category: PromptCategory,
  locale?: string,
): SystemPrompt[] {
  return getLocalizedPrompts(locale).filter((p) => p.category === category);
}

export function searchPrompts(query: string, locale?: string): SystemPrompt[] {
  const prompts = getLocalizedPrompts(locale);
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) return prompts;

  return prompts.filter(
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

export function getLocalizedPromptById(
  id: string,
  locale?: string,
): SystemPrompt | undefined {
  const prompt = getPromptById(id);
  if (!prompt) return undefined;
  return localizePrompt(prompt, locale);
}
