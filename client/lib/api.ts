import {
  Message,
  EndpointConfig,
  MCPServer,
  MessageAttachment,
} from "@/lib/store";
import { getToolsFromServers } from "@/lib/mcp-client";
import { fetchProviderModels } from "@/lib/providers";
import { runAgentChat } from "@/lib/agent/core";
import { MemorySettings } from "@/lib/agent/memory";
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

class UnsafeChatReplayError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Automatic replay stopped: a tool may already have performed an action. Check its result before retrying. ${detail}`,
      { cause },
    );
    this.name = "UnsafeChatReplayError";
  }
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
    systemPrompt?: string;
    chatPrompt?: string;
    memorySettings?: MemorySettings;
    onDecision?: (decision: { providerId: string; model: string }) => void;
    onAttachment?: (attachment: MessageAttachment) => void;
  },
): Promise<void> {
  let toolExecutionAttempted = false;
  try {
    await runAgentChat(messages, endpoint, onChunk, mcpServers, mcpEnabled, {
      systemPrompt: options?.systemPrompt,
      chatPrompt: options?.chatPrompt,
      memorySettings: options?.memorySettings,
      onDecision: options?.onDecision
        ? (decision) =>
            options.onDecision?.({
              providerId: endpoint.providerId,
              model: decision.model,
            })
        : undefined,
      onAttachment: options?.onAttachment,
      onToolExecutionAttempt: () => {
        toolExecutionAttempted = true;
      },
    });
  } catch (error: any) {
    if (toolExecutionAttempted) throw new UnsafeChatReplayError(error);
    if (options?.queueOnFailure && isNetworkError(error)) {
      const payload = {
        chatId: options.chatId,
        messages,
        endpoint,
        mcpServers,
        mcpEnabled,
        systemPrompt: options.systemPrompt,
        memorySettings: options.memorySettings,
        ...(options.chatPrompt !== undefined
          ? { chatPrompt: options.chatPrompt }
          : {}),
      };
      const queued = await enqueueChatRequest(payload);
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
  onItemError?: (error: any) => void;
  memorySettings?: MemorySettings;
}): Promise<{ processed: number; failed: number; remaining: number }> {
  return await flushQueuedChatRequests({
    filter: (item) => !options.chatId || item.payload.chatId === options.chatId,
    shouldRetry: (error) => !(error instanceof UnsafeChatReplayError),
    handler: async (payload) => {
      let toolExecutionAttempted = false;
      options.onItemStart?.();
      try {
        await runAgentChat(
          payload.messages,
          payload.endpoint,
          options.onChunk,
          payload.mcpServers,
          payload.mcpEnabled,
          {
            systemPrompt: payload.systemPrompt,
            chatPrompt: payload.chatPrompt,
            memorySettings: payload.memorySettings ?? options.memorySettings,
            onToolExecutionAttempt: () => {
              toolExecutionAttempted = true;
            },
          },
        );
      } catch (error) {
        const failure = toolExecutionAttempted
          ? new UnsafeChatReplayError(error)
          : error;
        options.onItemError?.(failure);
        throw failure;
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
      folderId: endpoint.folderId,
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
