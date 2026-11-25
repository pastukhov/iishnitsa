import {
  resolveSkillContext,
  type SkillContextOptions,
} from "@/lib/skill-registry";
import {
  createToolExecutionPolicy,
  ToolPolicyDeniedError,
  type ToolPolicyOptions,
} from "./tool-policy";
import type { AttemptTrace } from "@/lib/agent/execution-trace";
import {
  Message,
  EndpointConfig,
  MCPServer,
  MessageAttachment,
} from "@/lib/store";
import {
  getToolsFromServers,
  executeToolCall,
  mcpToolsToOpenAIFunctions,
  parseToolCallName,
  MCPTool,
  MCPToolResult,
} from "@/lib/mcp-client";
import { buildAgentContext } from "@/lib/agent/context-manager";
import {
  MemorySettings,
  MemoryStore,
  MemoryType,
  type MemoryScope,
  validateMemoryScope,
  normalizeMemoryLimit,
} from "@/lib/agent/memory";
import {
  AgentState,
  AgentDecision,
  ChatCompletionMessage,
  OpenAIFunction,
  ToolCall,
} from "@/lib/agent/types";
import {
  createAgentLifecycle,
  type AgentLifecycleOptions,
  type AgentLifecycleSubscriber,
} from "@/lib/agent/lifecycle";
import { OpenAICompatibleDriver } from "@/lib/agent/openai-driver";
import { decideAgentAction } from "@/lib/agent/decision-engine";
import { generateImage } from "@/lib/image-generation";

const BUILTIN_IMAGE_TOOL: OpenAIFunction = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Generate an image based on a text description. Use this when the user asks to draw, create, or generate an image, picture, illustration, photo, etc.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed text description of the image to generate in English. Translate user request to English if needed.",
        },
      },
      required: ["prompt"],
    },
  },
};

function formatToolResult(result: MCPToolResult): string {
  if (!result.content || result.content.length === 0) {
    return "No result";
  }

  return result.content
    .map((item) => {
      if (item.type === "text" && item.text) {
        return item.text;
      }
      if (item.type === "image" && item.data) {
        return `[Image: ${item.mimeType || "image/png"}]`;
      }
      return JSON.stringify(item);
    })
    .join("\n");
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ToolPolicyDeniedError();
  }
}

const SUMMARY_MAX_MESSAGES = 12;
const SUMMARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface AgentRunInput {
  messages: Message[];
  endpoint: EndpointConfig;
  onChunk: (content: string) => void;
  onDecision?: (decision: AgentDecision) => void;
  onAttachment?: (attachment: MessageAttachment) => void;
  onToolExecutionAttempt?: () => void;
  onLifecycleEvent?: AgentLifecycleSubscriber;
  memoryScope?: MemoryScope;
  onMemoryError?: (code: "memory_write_failed") => void;
  skillContext?: SkillContextOptions;
  toolPolicy?: ToolPolicyOptions;
  trace?: AttemptTrace;
  mcpServers: MCPServer[];
  mcpEnabled: boolean;
  systemPrompt?: string;
  chatPrompt?: string;
}

interface AgentContext {
  rawMessages: Message[];
  chatMessages: ChatCompletionMessage[];
  tools: OpenAIFunction[];
  mcpToolsMap: Map<string, MCPTool & { serverName: string; serverId: string }>;
  pendingToolCalls: ToolCall[];
  depth: number;
  contextBuilt: boolean;
  toolsLoaded: boolean;
  lastAssistantMessage?: string;
  decision?: AgentDecision;
}

export class AgentCore {
  private lifecycle: AgentLifecycleOptions;
  private maxDepth: number;
  private driver: OpenAICompatibleDriver;
  private memoryStore: MemoryStore;
  private memoryLimit?: number;
  private memoryMinImportance?: number;
  private memoryEnabled: boolean;
  private memoryAutoSave: boolean;
  private memoryAutoSummary: boolean;
  private memorySummaryTtlMs: number;

  constructor({
    maxDepth = 10,
    driver = new OpenAICompatibleDriver(),
    memoryStore = new MemoryStore(),
    memoryLimit,
    memoryMinImportance,
    memoryEnabled = true,
    memoryAutoSave = true,
    memoryAutoSummary = false,
    memorySummaryTtlMs = SUMMARY_TTL_MS,
    lifecycle = {},
  }: {
    maxDepth?: number;
    driver?: OpenAICompatibleDriver;
    memoryStore?: MemoryStore;
    memoryLimit?: number;
    memoryMinImportance?: number;
    memoryEnabled?: boolean;
    memoryAutoSave?: boolean;
    memoryAutoSummary?: boolean;
    memorySummaryTtlMs?: number;
    lifecycle?: AgentLifecycleOptions;
  } = {}) {
    this.lifecycle = lifecycle;
    this.maxDepth = maxDepth;
    this.driver = driver;
    this.memoryStore = memoryStore;
    this.memoryLimit = normalizeMemoryLimit(memoryLimit);
    this.memoryMinImportance = memoryMinImportance;
    this.memoryEnabled = memoryEnabled;
    this.memoryAutoSave = memoryAutoSave;
    this.memoryAutoSummary = memoryAutoSummary;
    this.memorySummaryTtlMs = memorySummaryTtlMs;
  }

  async runChat(input: AgentRunInput): Promise<void> {
    const memoryScope =
      input.memoryScope === undefined
        ? undefined
        : validateMemoryScope(input.memoryScope);
    const skillContext =
      input.skillContext === undefined
        ? undefined
        : Object.freeze({ ...input.skillContext });
    resolveSkillContext(skillContext);
    const lifecycle = createAgentLifecycle(this.lifecycle);
    if (input.onLifecycleEvent) lifecycle.subscribe(input.onLifecycleEvent);
    const policy = createToolExecutionPolicy(input.toolPolicy);
    lifecycle.start();
    try {
      await this.executeChat(
        { ...input, skillContext, memoryScope },
        lifecycle.enter,
        policy,
      );
    } catch (error) {
      lifecycle.finish("failed");
      throw error;
    } finally {
      policy.close();
    }
    lifecycle.finish("completed");
  }

  private async executeChat(
    {
      messages,
      endpoint,
      onChunk,
      onDecision,
      onAttachment,
      onToolExecutionAttempt,
      trace,
      mcpServers,
      mcpEnabled,
      systemPrompt,
      chatPrompt,
      skillContext,
      memoryScope,
      onMemoryError,
    }: AgentRunInput,
    enterState: ReturnType<typeof createAgentLifecycle>["enter"],
    policy: ReturnType<typeof createToolExecutionPolicy>,
  ): Promise<void> {
    const context: AgentContext = {
      rawMessages: messages,
      chatMessages: [],
      tools: [],
      mcpToolsMap: new Map(),
      pendingToolCalls: [],
      depth: 0,
      contextBuilt: false,
      toolsLoaded: false,
    };

    let state: AgentState = "RECEIVE_INPUT";

    let decisionEmitted = false;

    while (state !== "IDLE") {
      enterState(state);
      switch (state) {
        case "RECEIVE_INPUT": {
          state = "BUILD_CONTEXT";
          break;
        }
        case "BUILD_CONTEXT": {
          if (!context.contextBuilt) {
            context.chatMessages = await buildAgentContext({
              messages: context.rawMessages,
              endpoint,
              systemPrompt,
              chatPrompt,
              untrustedSkillContext: resolveSkillContext(skillContext),
              memoryScope,
              memoryStore:
                this.memoryEnabled && !skillContext && memoryScope
                  ? this.memoryStore
                  : undefined,
              memoryLimit: this.memoryEnabled ? this.memoryLimit : undefined,
              memoryMinImportance: this.memoryEnabled
                ? this.memoryMinImportance
                : undefined,
            });
            context.contextBuilt = true;
          }

          if (!context.toolsLoaded) {
            const { tools, mcpToolsMap } = await this.loadTools(
              mcpServers,
              mcpEnabled,
            );
            context.tools = tools;
            context.mcpToolsMap = mcpToolsMap;
            context.toolsLoaded = true;
          }

          state = "THINK";
          break;
        }
        case "THINK": {
          state = "DECIDE";
          break;
        }
        case "DECIDE": {
          context.decision = decideAgentAction({
            endpoint,
            messages: context.rawMessages,
            tools: context.tools,
            mcpEnabled,
          });
          if (context.decision && !decisionEmitted) {
            onDecision?.(context.decision);
            decisionEmitted = true;
          }
          state = "ACT";
          break;
        }
        case "ACT": {
          resolveSkillContext(skillContext);
          const decisionTools =
            context.decision?.toolChoice === "auto" ? context.tools : [];
          const { fullContent, toolCalls } = await this.driver.streamChat({
            endpoint,
            messages: context.chatMessages,
            tools: decisionTools,
            onChunk,
            decision: context.decision,
            ...(trace ? { boundary: trace.boundary("llm") } : {}),
            ...(skillContext
              ? {
                  beforeDispatch: () => {
                    resolveSkillContext(skillContext);
                  },
                }
              : {}),
          });

          if (toolCalls.length === 0) {
            context.lastAssistantMessage = fullContent || "";
            state = "IDLE";
            break;
          }

          context.chatMessages.push({
            role: "assistant",
            content: fullContent || null,
            tool_calls: toolCalls,
          });
          context.pendingToolCalls = toolCalls;
          state = "OBSERVE";
          break;
        }
        case "OBSERVE": {
          this.emitToolStatus(context.pendingToolCalls, onChunk);
          await this.executeToolCalls(
            context.chatMessages,
            context.pendingToolCalls,
            context.mcpToolsMap,
            mcpServers,
            endpoint,
            policy,
            skillContext,
            onAttachment,
            onToolExecutionAttempt,
            trace,
          );
          state = "UPDATE_STATE";
          break;
        }
        case "UPDATE_STATE": {
          context.depth += 1;
          if (context.depth >= this.maxDepth) {
            throw new Error("Maximum tool call depth exceeded");
          }
          state = "BUILD_CONTEXT";
          break;
        }
        default: {
          state = "IDLE";
          break;
        }
      }
    }

    if (
      !skillContext &&
      memoryScope &&
      this.memoryEnabled &&
      context.lastAssistantMessage
    ) {
      await this.persistMemories({
        messages: context.rawMessages,
        assistantMessage: context.lastAssistantMessage,
        memoryScope,
        onMemoryError,
        endpoint,
        trace,
      });
    }
  }

  private async loadTools(
    servers: MCPServer[],
    enabled: boolean,
  ): Promise<{
    tools: OpenAIFunction[];
    mcpToolsMap: Map<
      string,
      MCPTool & { serverName: string; serverId: string }
    >;
  }> {
    const tools: OpenAIFunction[] = [BUILTIN_IMAGE_TOOL];
    const mcpToolsMap: Map<
      string,
      MCPTool & { serverName: string; serverId: string }
    > = new Map();

    if (!enabled || servers.length === 0) {
      return { tools, mcpToolsMap };
    }

    const enabledServers = servers.filter((s) => s.enabled);
    if (enabledServers.length === 0) {
      return { tools, mcpToolsMap };
    }

    try {
      const { tools: fetchedTools, errors } =
        await getToolsFromServers(enabledServers);

      if (errors.length > 0) {
        console.warn("MCP tool discovery failed");
      }

      if (fetchedTools.length > 0) {
        tools.push(...mcpToolsToOpenAIFunctions(fetchedTools));
        fetchedTools.forEach((tool) => {
          mcpToolsMap.set(`${tool.serverId}__${tool.name}`, tool);
        });
      }
    } catch {
      console.error("Failed to fetch MCP tools");
    }

    return { tools, mcpToolsMap };
  }

  private emitToolStatus(
    toolCalls: ToolCall[],
    onChunk: (content: string) => void,
  ) {
    const toolNames = toolCalls.map((tc) => {
      const { toolName } = parseToolCallName(tc.function.name);
      return toolName;
    });
    const statusMessage =
      toolNames.length === 1
        ? `[Using tool: ${toolNames[0]}...]`
        : `[Using tools: ${toolNames.join(", ")}...]`;

    onChunk(statusMessage);
  }

  private async executeToolCalls(
    messages: ChatCompletionMessage[],
    toolCalls: ToolCall[],
    mcpToolsMap: Map<
      string,
      MCPTool & { serverName: string; serverId: string }
    >,
    mcpServers: MCPServer[],
    endpoint: EndpointConfig,
    policy: ReturnType<typeof createToolExecutionPolicy>,
    skillContext: SkillContextOptions | undefined,
    onAttachment?: (attachment: MessageAttachment) => void,
    onToolExecutionAttempt?: () => void,
    trace?: AttemptTrace,
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      resolveSkillContext(skillContext);
      let result: string;

      if (toolCall.function.name === "generate_image") {
        try {
          const args = parseToolArguments(toolCall.function.arguments);
          const imageResult = await policy.execute(
            { kind: "builtin", name: "generate_image", endpoint },
            args,
            async (target, approvedArgs) => {
              if (
                target.kind !== "builtin" ||
                typeof approvedArgs.prompt !== "string" ||
                !approvedArgs.prompt
              )
                throw new ToolPolicyDeniedError();
              resolveSkillContext(skillContext);
              onToolExecutionAttempt?.();
              resolveSkillContext(skillContext);
              return generateImage(target.endpoint, approvedArgs.prompt);
            },
          );
          onAttachment?.(imageResult.attachment);
          result = imageResult.revisedPrompt
            ? `Image generated successfully. Revised prompt: ${imageResult.revisedPrompt}`
            : "Image generated successfully.";
        } catch (error: any) {
          result =
            error instanceof ToolPolicyDeniedError
              ? "Tool execution denied by policy."
              : `Error generating image: ${error.message}`;
        }
      } else {
        const { serverId, toolName } = parseToolCallName(
          toolCall.function.name,
        );
        const server = mcpServers.find((s) => s.id === serverId);
        const toolInfo = mcpToolsMap.get(toolCall.function.name);

        const boundary = trace?.boundary("mcp");
        if (!toolInfo) {
          boundary?.finish("denied");
          result = `Error: Unknown tool "${toolCall.function.name}"`;
        } else if (!server) {
          boundary?.finish("denied");
          result = `Error: Server not found for tool ${toolCall.function.name}`;
        } else {
          try {
            const args = parseToolArguments(toolCall.function.arguments);
            const toolResult = await policy.execute(
              { kind: "mcp", name: toolName, server },
              args,
              async (target, approvedArgs) => {
                if (target.kind !== "mcp") throw new ToolPolicyDeniedError();
                // Mark before awaiting: a lost response does not mean no side effect.
                resolveSkillContext(skillContext);
                onToolExecutionAttempt?.();
                if (skillContext) {
                  return executeToolCall(
                    target.server,
                    target.name,
                    approvedArgs,
                    boundary,
                    () => {
                      resolveSkillContext(skillContext);
                    },
                  );
                }
                return boundary
                  ? executeToolCall(
                      target.server,
                      target.name,
                      approvedArgs,
                      boundary,
                    )
                  : executeToolCall(target.server, target.name, approvedArgs);
              },
            );
            result = formatToolResult(toolResult);
          } catch (error: any) {
            if (error instanceof ToolPolicyDeniedError) {
              boundary?.finish("denied");
              result = "Tool execution denied by policy.";
            } else {
              result = `Error executing tool: ${error.message}`;
            }
          }
        }
      }

      const toolResultMessage: ChatCompletionMessage = {
        role: "tool",
        content: result,
        tool_call_id: toolCall.id,
      };
      messages.push(toolResultMessage);
    }
  }

  private getLatestUserMessage(messages: Message[]): Message | undefined {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") return messages[i];
    }
    return undefined;
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trim()}...`;
  }

  private formatMessageForSummary(message: Message): string {
    const base = message.content?.trim() || "";
    const attachmentCount = message.attachments?.length || 0;
    const attachmentNote =
      attachmentCount > 0
        ? ` [${attachmentCount} image${attachmentCount > 1 ? "s" : ""}]`
        : "";
    const combined = `${base}${attachmentNote}`.trim();
    return combined || "[attachment]";
  }

  private extractExplicitMemory(text: string): {
    type: MemoryType;
    content: string;
  } | null {
    const patterns: { regex: RegExp; type: MemoryType }[] = [
      { regex: /^\s*(please\s+)?remember( that)?[:\s]+/i, type: "user" },
      { regex: /^\s*пожалуйста\s+запомни( что)?[:\s]+/i, type: "user" },
      { regex: /^\s*запомни( что)?[:\s]+/i, type: "user" },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(text)) {
        const content = text.replace(pattern.regex, "").trim();
        if (!content) return null;
        return {
          type: pattern.type,
          content: this.truncateText(content, 400),
        };
      }
    }

    return null;
  }

  private buildSummaryInput(
    messages: Message[],
    assistantMessage: string,
  ): string {
    const recentMessages = messages.slice(-SUMMARY_MAX_MESSAGES);
    const lines = recentMessages.map((message) => {
      const formatted = this.truncateText(
        this.formatMessageForSummary(message),
        300,
      );
      return `${message.role}: ${formatted}`;
    });

    if (assistantMessage.trim()) {
      lines.push(
        `assistant: ${this.truncateText(assistantMessage.trim(), 600)}`,
      );
    }

    return lines.join("\n");
  }

  private async createConversationSummary(
    messages: Message[],
    assistantMessage: string,
    endpoint: EndpointConfig,
    trace?: AttemptTrace,
  ): Promise<string | null> {
    if (!assistantMessage.trim()) return null;
    if (messages.length < 2) return null;

    const conversation = this.buildSummaryInput(messages, assistantMessage);
    if (!conversation.trim()) return null;

    try {
      const { fullContent } = await this.driver.streamChat({
        endpoint,
        messages: [
          {
            role: "system",
            content:
              "Summarize the conversation in 1-2 sentences for long-term memory. Focus on stable facts, preferences, and ongoing tasks. Avoid sensitive or transient details. Output plain text only.",
          },
          { role: "user", content: `Conversation:\n${conversation}` },
        ],
        tools: [],
        onChunk: () => {},
        ...(trace ? { boundary: trace.boundary("llm") } : {}),
      });

      const summary = fullContent?.trim();
      return summary ? this.truncateText(summary, 600) : null;
    } catch {
      console.warn("Failed to summarize conversation for memory");
      return null;
    }
  }

  private async persistMemories({
    messages,
    assistantMessage,
    endpoint,
    trace,
    memoryScope,
    onMemoryError,
  }: {
    messages: Message[];
    assistantMessage: string;
    memoryScope: MemoryScope;
    onMemoryError?: (code: "memory_write_failed") => void;
    endpoint: EndpointConfig;
    trace?: AttemptTrace;
  }): Promise<void> {
    if (!this.memoryAutoSave && !this.memoryAutoSummary) return;
    const sourceId = this.getLatestUserMessage(messages)?.id;
    if (!sourceId) return;
    const reportWriteFailure = () => {
      try {
        onMemoryError?.("memory_write_failed");
      } catch {
        /* Observers cannot trigger chat replay. */
      }
    };

    if (this.memoryAutoSave) {
      const lastUserMessage = this.getLatestUserMessage(messages);
      if (lastUserMessage?.content) {
        const memory = this.extractExplicitMemory(lastUserMessage.content);
        if (memory) {
          try {
            await this.memoryStore.addMemory({
              scope: memoryScope,
              provenance: { source: "explicit", sourceId },
              id: `explicit:${sourceId}`,
              type: memory.type,
              content: memory.content,
              importance: 0.9,
            });
          } catch {
            reportWriteFailure();
          }
        }
      }
    }

    if (this.memoryAutoSummary) {
      const summary = await this.createConversationSummary(
        messages,
        assistantMessage,
        endpoint,
        trace,
      );
      if (summary) {
        try {
          await this.memoryStore.addMemory({
            scope: memoryScope,
            provenance: { source: "summary", sourceId },
            id: `summary:${sourceId}`,
            type: "task",
            content: summary,
            importance: 0.6,
            ttlMs: this.memorySummaryTtlMs,
          });
        } catch {
          reportWriteFailure();
        }
      }
    }
  }
}

export async function runAgentChat(
  messages: Message[],
  endpoint: EndpointConfig,
  onChunk: (content: string) => void,
  mcpServers: MCPServer[] = [],
  mcpEnabled: boolean = false,
  options?: {
    systemPrompt?: string;
    chatPrompt?: string;
    memorySettings?: MemorySettings;
    onDecision?: (decision: AgentDecision) => void;
    onAttachment?: (attachment: MessageAttachment) => void;
    onToolExecutionAttempt?: () => void;
    onLifecycleEvent?: AgentLifecycleSubscriber;
    memoryScope?: MemoryScope;
    onMemoryError?: (code: "memory_write_failed") => void;
    skillContext?: SkillContextOptions;
    toolPolicy?: ToolPolicyOptions;
    trace?: AttemptTrace;
  },
): Promise<void> {
  const { systemPrompt, chatPrompt, memorySettings } = options || {};
  const agent = new AgentCore(
    memorySettings
      ? {
          memoryEnabled: memorySettings.enabled,
          memoryAutoSave: memorySettings.autoSave,
          memoryAutoSummary: memorySettings.autoSummary,
          memoryLimit: memorySettings.limit,
          memoryMinImportance: memorySettings.minImportance,
          memorySummaryTtlMs: memorySettings.summaryTtlMs,
        }
      : undefined,
  );
  await agent.runChat({
    messages,
    endpoint,
    onChunk,
    mcpServers,
    mcpEnabled,
    systemPrompt,
    chatPrompt,
    onDecision: options?.onDecision,
    onAttachment: options?.onAttachment,
    onToolExecutionAttempt: options?.onToolExecutionAttempt,
    onLifecycleEvent: options?.onLifecycleEvent,
    memoryScope: options?.memoryScope,
    onMemoryError: options?.onMemoryError,
    skillContext: options?.skillContext,
    toolPolicy: options?.toolPolicy,
    trace: options?.trace,
  });
}
