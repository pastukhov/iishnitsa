import { MCPServer } from "@/lib/store";
import {
  SystemPrompt,
  PromptCache,
  loadPromptsFromMCP,
  getCachedPrompts,
  setCachedPrompts,
  clearPromptCache,
  isCacheValid,
  getCacheAge,
} from "@/lib/mcp-prompts";

export type { SystemPrompt, PromptCache };
export { clearPromptCache, getCacheAge };

let LOADED_PROMPTS: SystemPrompt[] = [];
let PROMPTS_SOURCE: "mcp" | "none" = "none";
let CACHE_TIMESTAMP: number | null = null;

export function getPromptsSource(): "mcp" | "none" {
  return PROMPTS_SOURCE;
}

export function getCacheTimestamp(): number | null {
  return CACHE_TIMESTAMP;
}

export function getLoadedPromptsCount(): number {
  return LOADED_PROMPTS.length;
}

export async function initializePrompts(
  mcpServers: MCPServer[],
  forceRefresh: boolean = false,
): Promise<{ prompts: SystemPrompt[]; source: "mcp" | "none" }> {
  // Check cache if not forcing refresh
  if (!forceRefresh) {
    const cache = await getCachedPrompts();
    if (isCacheValid(cache) && cache) {
      LOADED_PROMPTS = cache.prompts;
      PROMPTS_SOURCE = cache.source === "mcp" ? "mcp" : "none";
      CACHE_TIMESTAMP = cache.timestamp;
      return { prompts: cache.prompts, source: PROMPTS_SOURCE };
    }
  }

  // Try loading from MCP
  try {
    const mcpPrompts = await loadPromptsFromMCP(mcpServers);
    if (mcpPrompts.length > 0) {
      LOADED_PROMPTS = mcpPrompts;
      PROMPTS_SOURCE = "mcp";
      CACHE_TIMESTAMP = Date.now();
      await setCachedPrompts(mcpPrompts, "mcp");
      return { prompts: mcpPrompts, source: "mcp" };
    }
  } catch (error) {
    console.warn("Failed to load prompts from MCP:", error);
  }

  // No prompts available
  LOADED_PROMPTS = [];
  PROMPTS_SOURCE = "none";
  CACHE_TIMESTAMP = null;
  return { prompts: [], source: "none" };
}

function getActivePrompts(): SystemPrompt[] {
  return LOADED_PROMPTS;
}

export type PromptCategory = string;

export function getPromptCategories(): string[] {
  const prompts = getActivePrompts();
  return Array.from(new Set(prompts.map((prompt) => prompt.category)));
}

export function getPromptsByCategory(category: PromptCategory): SystemPrompt[] {
  return getActivePrompts().filter((p) => p.category === category);
}

export function searchPrompts(query: string): SystemPrompt[] {
  const prompts = getActivePrompts();
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
  return getActivePrompts().find((prompt) => prompt.id === id);
}

export function getAllTags(): string[] {
  const tagsSet = new Set<string>();
  getActivePrompts().forEach((prompt) => {
    (prompt.tags || []).forEach((tag) => tagsSet.add(tag));
  });
  return Array.from(tagsSet).sort();
}

export function getTopTags(limit: number = 10): string[] {
  const tagCounts = new Map<string, number>();

  getActivePrompts().forEach((prompt) => {
    (prompt.tags || []).forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  return Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

export function getPromptsByTag(tag: string): SystemPrompt[] {
  return getActivePrompts().filter((p) => (p.tags || []).includes(tag));
}

export function getPromptsByIds(ids: string[]): SystemPrompt[] {
  const prompts = getActivePrompts();
  const idSet = new Set(ids);
  return prompts.filter((p) => idSet.has(p.id));
}
