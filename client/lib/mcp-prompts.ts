import AsyncStorage from "@react-native-async-storage/async-storage";
import { MCPServer } from "@/lib/store";
import { MCPClient } from "@/lib/mcp-client";

export const PROMPTS_CHAT_URL = "https://prompts.chat/api/mcp";
export const PROMPTS_CHAT_SERVER_ID = "prompts-chat-default";

export interface MCPPromptData {
  id: string;
  slug?: string;
  title: string;
  description?: string;
  content: string;
  type?: "TEXT" | "STRUCTURED" | "IMAGE" | "VIDEO" | "AUDIO";
  structuredFormat?: "JSON" | "YAML";
  author?: string;
  category?: string;
  tags?: string[];
  votes?: number;
  createdAt?: string;
}

export interface SystemPrompt {
  id: string;
  title: string;
  prompt: string;
  category: string;
  tags?: string[];
  description?: string;
  author?: string;
  votes?: number;
  createdAt?: string;
  type?: string;
  slug?: string;
}

export interface PromptCache {
  version: 1;
  timestamp: number;
  ttl: number;
  source: "mcp" | "local";
  prompts: SystemPrompt[];
}

const CACHE_KEY = "@ai_agent_mcp_prompts_cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function findPromptsChatServer(
  mcpServers: MCPServer[],
): MCPServer | undefined {
  return mcpServers.find(
    (s) => s.url === PROMPTS_CHAT_URL || s.id === PROMPTS_CHAT_SERVER_ID,
  );
}

function mapMCPPromptToSystemPrompt(mcpPrompt: MCPPromptData): SystemPrompt {
  return {
    id: mcpPrompt.id,
    title: mcpPrompt.title,
    prompt: mcpPrompt.content,
    category: mcpPrompt.category || "Uncategorized",
    tags: mcpPrompt.tags || [],
    description: mcpPrompt.description,
    author: mcpPrompt.author,
    votes: mcpPrompt.votes,
    createdAt: mcpPrompt.createdAt,
    type: mcpPrompt.type,
    slug: mcpPrompt.slug,
  };
}

export async function loadPromptsFromMCP(
  mcpServers: MCPServer[],
  limit: number = 1000,
): Promise<SystemPrompt[]> {
  const promptsServer = findPromptsChatServer(mcpServers);

  if (!promptsServer || !promptsServer.enabled) {
    return [];
  }

  const client = new MCPClient(promptsServer);

  try {
    await client.initialize();

    const result = await client.callTool("search_prompts", {
      query: "",
      limit: Math.min(limit, 50), // API max is 50
    });

    if (result.isError) {
      console.error("MCP search_prompts returned error:", result.content);
      return [];
    }

    const textContent = result.content?.find((c) => c.type === "text");
    if (!textContent?.text) {
      console.warn("MCP search_prompts returned no text content");
      return [];
    }

    const parsed = JSON.parse(textContent.text);
    const mcpPrompts: MCPPromptData[] = parsed.prompts || [];

    return mcpPrompts.map(mapMCPPromptToSystemPrompt);
  } catch (error) {
    console.error("Failed to load prompts from MCP:", error);
    throw error;
  }
}

export async function getCachedPrompts(): Promise<PromptCache | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const parsed: PromptCache = JSON.parse(cached);

    if (parsed.version !== 1) {
      await clearPromptCache();
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("Failed to read prompt cache:", error);
    await clearPromptCache();
    return null;
  }
}

export async function setCachedPrompts(
  prompts: SystemPrompt[],
  source: "mcp" | "local",
): Promise<void> {
  const cache: PromptCache = {
    version: 1,
    timestamp: Date.now(),
    ttl: CACHE_TTL_MS,
    source,
    prompts,
  };

  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Failed to save prompt cache:", error);
  }
}

export async function clearPromptCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.warn("Failed to clear prompt cache:", error);
  }
}

export function isCacheValid(cache: PromptCache | null): boolean {
  if (!cache) return false;
  if (!cache.prompts || cache.prompts.length === 0) return false;

  const now = Date.now();
  const expiresAt = cache.timestamp + cache.ttl;

  return now < expiresAt;
}

export function getCacheAge(cache: PromptCache | null): number | null {
  if (!cache) return null;
  return Date.now() - cache.timestamp;
}
