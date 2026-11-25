import {
  runTextDelegation,
  type TextDelegation,
  type UntrustedChildResult,
} from "@/lib/agent/text-delegation";
import { throwIfCancelled } from "@/lib/runtime/cancellation";
import {
  resolveSkillContext,
  type SkillContextOptions,
} from "@/lib/skill-registry";
import {
  snapshotToolPolicyOptions,
  type ToolPolicyOptions,
} from "@/lib/agent/tool-policy";
import {
  Message,
  EndpointConfig,
  MCPServer,
  MessageAttachment,
} from "@/lib/store";
import { getToolsFromServers } from "@/lib/mcp-client";
import { fetchProviderModels } from "@/lib/providers";
import { runAgentChat } from "@/lib/agent/core";
import { LLMResponseError } from "@/lib/agent/openai-driver";
import {
  createExecutionTrace,
  type ExecutionSubscriber,
  type RunOutcome,
} from "@/lib/agent/execution-trace";
import {
  MemorySettings,
  type MemoryStore,
  type MemoryScope,
  validateMemoryScope,
} from "@/lib/agent/memory";
import {
  enqueueChatRequest,
  cancelQueuedChatRequest,
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
    textDelegation?: TextDelegation;
    signal?: AbortSignal;
    memoryStore?: MemoryStore;
    skillContext?: SkillContextOptions;
    toolPolicy?: ToolPolicyOptions;
    fallbackEndpoint?: EndpointConfig;
    onExecutionEvent?: ExecutionSubscriber;
    queueOnFailure?: boolean;
    chatId?: string | null;
    onQueued?: (id: string) => void;
    systemPrompt?: string;
    chatPrompt?: string;
    memorySettings?: MemorySettings;
    memoryScope?: MemoryScope;
    onMemoryError?: (code: "memory_write_failed") => void;
    onDecision?: (decision: { providerId: string; model: string }) => void;
    onAttachment?: (attachment: MessageAttachment) => void;
  },
): Promise<void | readonly UntrustedChildResult[]> {
  throwIfCancelled(options?.signal);
  const memoryScope =
    options?.memoryScope === undefined
      ? undefined
      : validateMemoryScope(options.memoryScope);
  const skillContext =
    options?.skillContext === undefined
      ? undefined
      : Object.freeze({ ...options.skillContext });
  resolveSkillContext(skillContext);
  const textDelegation = options?.textDelegation;
  const toolPolicy = snapshotToolPolicyOptions(options?.toolPolicy);
  const trace = createExecutionTrace(options?.onExecutionEvent);
  let outcome: RunOutcome = "failed";
  let childResults: readonly UntrustedChildResult[] | undefined;
  let toolExecutionAttempted = false;
  let outputStarted = false;
  const attemptEndpoint = async (selected: EndpointConfig) => {
    throwIfCancelled(options?.signal);
    const attempt = trace.attempt();
    try {
      await runAgentChat(
        messages,
        selected,
        options?.fallbackEndpoint
          ? (chunk) => {
              outputStarted = true;
              onChunk(chunk);
            }
          : onChunk,
        mcpServers,
        mcpEnabled,
        {
          signal: options?.signal,
          memoryStore: options?.memoryStore,
          skillContext,
          toolPolicy,
          systemPrompt: options?.systemPrompt,
          chatPrompt: options?.chatPrompt,
          memorySettings: options?.memorySettings,
          memoryScope,
          onMemoryError: options?.onMemoryError,
          onDecision: options?.onDecision
            ? (decision) =>
                options.onDecision?.({
                  providerId: selected.providerId,
                  model: decision.model,
                })
            : undefined,
          onAttachment: options?.onAttachment,
          onToolExecutionAttempt: () => {
            toolExecutionAttempted = true;
          },
          ...(options?.onExecutionEvent ? { trace: attempt } : {}),
        },
      );
      throwIfCancelled(options?.signal);
      attempt.finish("completed");
    } catch (error) {
      attempt.finish("failed");
      throw error;
    }
  };
  try {
    if (textDelegation !== undefined)
      childResults = await runTextDelegation(
        textDelegation,
        trace,
        options?.signal,
      );
    try {
      await attemptEndpoint(endpoint);
    } catch (error) {
      throwIfCancelled(options?.signal);
      if (
        options?.fallbackEndpoint &&
        !toolExecutionAttempted &&
        !outputStarted &&
        error instanceof LLMResponseError &&
        [429, 502, 503, 504].includes(error.status)
      ) {
        await attemptEndpoint(options.fallbackEndpoint);
      } else {
        throw error;
      }
    }
    outcome = "completed";
    return childResults;
  } catch (error: any) {
    throwIfCancelled(options?.signal);
    if (toolExecutionAttempted) throw new UnsafeChatReplayError(error);
    if (
      !skillContext &&
      textDelegation === undefined &&
      options?.queueOnFailure &&
      isNetworkError(error)
    ) {
      const payload = {
        chatId: options.chatId,
        messages,
        endpoint,
        mcpServers,
        mcpEnabled,
        systemPrompt: options.systemPrompt,
        memorySettings: options.memorySettings,
        ...(memoryScope ? { memoryScope } : {}),
        ...(options.chatPrompt !== undefined
          ? { chatPrompt: options.chatPrompt }
          : {}),
      };
      const queued = options?.signal
        ? await enqueueChatRequest(payload, options.signal)
        : await enqueueChatRequest(payload);
      const checkQueuedCancellation = async () => {
        if (options?.signal?.aborted) {
          await cancelQueuedChatRequest(queued.id);
          throwIfCancelled(options.signal);
        }
      };
      if (options?.signal?.aborted) await checkQueuedCancellation();
      try {
        options?.onQueued?.(queued.id);
      } finally {
        if (options?.signal?.aborted) await checkQueuedCancellation();
      }
      outcome = "queued";
      return;
    }
    throw error;
  } finally {
    trace.finish(outcome);
  }
}

export async function flushQueuedChatMessages(options: {
  toolPolicy?: ToolPolicyOptions;
  chatId?: string | null;
  onChunk: (content: string) => void;
  onItemStart?: () => void;
  onItemFinish?: () => void;
  onItemError?: (error: any) => void;
  memorySettings?: MemorySettings;
  memoryScope?: MemoryScope;
  onMemoryError?: (code: "memory_write_failed") => void;
}): Promise<{ processed: number; failed: number; remaining: number }> {
  const memoryScope =
    options.memoryScope === undefined
      ? undefined
      : validateMemoryScope(options.memoryScope);
  const toolPolicy = snapshotToolPolicyOptions(options.toolPolicy);
  return await flushQueuedChatRequests({
    filter: (item) => {
      if (options.chatId && item.payload.chatId !== options.chatId)
        return false;
      if (!memoryScope) return item.payload.memoryScope === undefined;
      try {
        const queuedScope = validateMemoryScope(item.payload.memoryScope!);
        return (
          queuedScope.accountId === memoryScope.accountId &&
          queuedScope.chatId === memoryScope.chatId
        );
      } catch {
        return false;
      }
    },
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
            toolPolicy,
            systemPrompt: payload.systemPrompt,
            chatPrompt: payload.chatPrompt,
            memorySettings: payload.memorySettings ?? options.memorySettings,
            memoryScope,
            onMemoryError: options.onMemoryError,
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
