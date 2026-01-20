import { Message, EndpointConfig, MCPServer } from "@/lib/store";
import { getToolsFromServers } from "@/lib/mcp-client";
import { fetchProviderModels } from "@/lib/providers";
import { runAgentChat } from "@/lib/agent/core";
import {
  enqueueChatRequest,
  flushQueuedChatRequests,
} from "@/lib/offline-queue";

const NETWORK_ERROR_HINTS = [
  "Network request failed",
  "Failed to fetch",
  "NetworkError",
  "Request failed",
];

function isNetworkError(error: any): boolean {
  const message = error?.message || "";
  return NETWORK_ERROR_HINTS.some((hint) => message.includes(hint));
}

export async function sendChatMessage(
  messages: Message[],
  endpoint: EndpointConfig,
  onChunk: (content: string) => void,
  mcpServers: MCPServer[] = [],
  mcpEnabled: boolean = false,
  options?: {
    queueOnFailure?: boolean;
    chatId?: string | null;
    onQueued?: (id: string) => void;
  },
): Promise<void> {
  try {
    await runAgentChat(messages, endpoint, onChunk, mcpServers, mcpEnabled);
  } catch (error: any) {
    if (options?.queueOnFailure && isNetworkError(error)) {
      const queued = await enqueueChatRequest({
        chatId: options.chatId,
        messages,
        endpoint,
        mcpServers,
        mcpEnabled,
      });
      options?.onQueued?.(queued.id);
      return;
    }
    throw error;
  }
}

export async function flushQueuedChatMessages(options: {
  chatId?: string | null;
  onChunk: (content: string) => void;
  onItemStart?: () => void;
  onItemFinish?: () => void;
}): Promise<{ processed: number; failed: number; remaining: number }> {
  return await flushQueuedChatRequests({
    filter: (item) => !options.chatId || item.payload.chatId === options.chatId,
    handler: async (payload) => {
      options.onItemStart?.();
      try {
        await runAgentChat(
          payload.messages,
          payload.endpoint,
          options.onChunk,
          payload.mcpServers,
          payload.mcpEnabled,
        );
      } finally {
        options.onItemFinish?.();
      }
    },
  });
}

export async function testConnection(endpoint: EndpointConfig): Promise<{
  success: boolean;
  message: string;
  models?: string[];
}> {
  try {
    const result = await fetchProviderModels({
      providerId: endpoint.providerId,
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      currentModel: endpoint.model,
    });

    if (result.error) {
      return {
        success: false,
        message: result.error,
      };
    }

    if (result.models.length === 0) {
      return {
        success: true,
        message: result.message || "Connected. Enter a model manually.",
      };
    }

    return {
      success: true,
      message:
        result.message || `Connected! Found ${result.models.length} models.`,
      models: result.models,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Connection error: ${error.message}`,
    };
  }
}

export async function testMCPServer(server: MCPServer): Promise<{
  success: boolean;
  message: string;
  tools?: string[];
}> {
  try {
    const { tools, errors } = await getToolsFromServers([
      { ...server, enabled: true },
    ]);

    if (errors.length > 0) {
      return {
        success: false,
        message: errors[0].error,
      };
    }

    return {
      success: true,
      message: `Connected! Found ${tools.length} tools.`,
      tools: tools.map((t) => t.name),
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Connection error: ${error.message}`,
    };
  }
}
