import { Message, EndpointConfig, MCPServer } from "@/lib/store";
import {
  getToolsFromServers,
  executeToolCall,
  mcpToolsToOpenAIFunctions,
  parseToolCallName,
  MCPTool,
  MCPToolResult,
} from "@/lib/mcp-client";
import { buildAgentContext } from "@/lib/agent/context-manager";
import { MemorySettings, MemoryStore, MemoryType } from "@/lib/agent/memory";
import {
  AgentState,
  AgentDecision,
  ChatCompletionMessage,
  OpenAIFunction,
  ToolCall,
} from "@/lib/agent/types";
import { OpenAICompatibleDriver } from "@/lib/agent/openai-driver";
import { decideAgentAction } from "@/lib/agent/decision-engine";

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

const SUMMARY_MAX_MESSAGES = 12;
const SUMMARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface AgentRunInput {
  messages: Message[];
  endpoint: EndpointConfig;
  onChunk: (content: string) => void;
  onDecision?: (decision: AgentDecision) => void;
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
  private state: AgentState = "IDLE";
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
  } = {}) {
    this.maxDepth = maxDepth;
    this.driver = driver;
    this.memoryStore = memoryStore;
    this.memoryLimit = memoryLimit;
    this.memoryMinImportance = memoryMinImportance;
    this.memoryEnabled = memoryEnabled;
    this.memoryAutoSave = memoryAutoSave;
    this.memoryAutoSummary = memoryAutoSummary;
    this.memorySummaryTtlMs = memorySummaryTtlMs;
  }

  async runChat({
    messages,
    endpoint,
    onChunk,
    onDecision,
    mcpServers,
    mcpEnabled,
    systemPrompt,
    chatPrompt,
  }: AgentRunInput): Promise<void> {
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

    this.state = "RECEIVE_INPUT";

    let decisionEmitted = false;

    while (this.state !== "IDLE") {
      switch (this.state) {
        case "RECEIVE_INPUT": {
          this.state = "BUILD_CONTEXT";
          break;
        }
        case "BUILD_CONTEXT": {
          if (!context.contextBuilt) {
            context.chatMessages = await buildAgentContext({
              messages: context.rawMessages,
              endpoint,
              systemPrompt,
              chatPrompt,
              memoryStore: this.memoryEnabled ? this.memoryStore : undefined,
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

          this.state = "THINK";
          break;
        }
        case "THINK": {
          this.state = "DECIDE";
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
          this.state = "ACT";
          break;
        }
        case "ACT": {
          const decisionTools =
            context.decision?.toolChoice === "auto" ? context.tools : [];
          const { fullContent, toolCalls } = await this.driver.streamChat({
            endpoint,
            messages: context.chatMessages,
            tools: decisionTools,
            onChunk,
            decision: context.decision,
          });

          if (toolCalls.length === 0) {
            context.lastAssistantMessage = fullContent || "";
            this.state = "IDLE";
            break;
          }

          context.chatMessages.push({
            role: "assistant",
            content: fullContent || null,
            tool_calls: toolCalls,
          });
          context.pendingToolCalls = toolCalls;
          this.state = "OBSERVE";
          break;
        }
        case "OBSERVE": {
          this.emitToolStatus(context.pendingToolCalls, onChunk);
          await this.executeToolCalls(
            context.chatMessages,
            context.pendingToolCalls,
            context.mcpToolsMap,
            mcpServers,
          );
          this.state = "UPDATE_STATE";
          break;
        }
        case "UPDATE_STATE": {
          context.depth += 1;
          if (context.depth >= this.maxDepth) {
            throw new Error("Maximum tool call depth exceeded");
          }
          this.state = "BUILD_CONTEXT";
          break;
        }
        default: {
          this.state = "IDLE";
          break;
        }
      }
    }

    if (this.memoryEnabled && context.lastAssistantMessage) {
      await this.persistMemories({
        messages: context.rawMessages,
        assistantMessage: context.lastAssistantMessage,
        endpoint,
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
    const tools: OpenAIFunction[] = [];
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
        console.warn("MCP server errors:", errors);
      }

      if (fetchedTools.length > 0) {
        tools.push(...mcpToolsToOpenAIFunctions(fetchedTools));
        fetchedTools.forEach((tool) => {
          mcpToolsMap.set(`${tool.serverId}__${tool.name}`, tool);
        });
      }
    } catch (error) {
      console.error("Failed to fetch MCP tools:", error);
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
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      const { serverId, toolName } = parseToolCallName(toolCall.function.name);
      const server = mcpServers.find((s) => s.id === serverId);
      const toolInfo = mcpToolsMap.get(toolCall.function.name);

      let result: string;
      if (!toolInfo) {
        result = `Error: Unknown tool "${toolCall.function.name}"`;
      } else if (!server) {
        result = `Error: Server not found for tool ${toolCall.function.name}`;
      } else {
        try {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {}

          const toolResult = await executeToolCall(server, toolName, args);
          result = formatToolResult(toolResult);
        } catch (error: any) {
          result = `Error executing tool: ${error.message}`;
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
      });

      const summary = fullContent?.trim();
      return summary ? this.truncateText(summary, 600) : null;
    } catch (error) {
      console.warn("Failed to summarize conversation for memory:", error);
      return null;
    }
  }

  private async persistMemories({
    messages,
    assistantMessage,
    endpoint,
  }: {
    messages: Message[];
    assistantMessage: string;
    endpoint: EndpointConfig;
  }): Promise<void> {
    if (!this.memoryAutoSave && !this.memoryAutoSummary) return;

    if (this.memoryAutoSave) {
      const lastUserMessage = this.getLatestUserMessage(messages);
      if (lastUserMessage?.content) {
        const memory = this.extractExplicitMemory(lastUserMessage.content);
        if (memory) {
          try {
            await this.memoryStore.addMemory({
              type: memory.type,
              content: memory.content,
              importance: 0.9,
            });
          } catch (error) {
            console.warn("Failed to store explicit memory:", error);
          }
        }
      }
    }

    if (this.memoryAutoSummary) {
      const summary = await this.createConversationSummary(
        messages,
        assistantMessage,
        endpoint,
      );
      if (summary) {
        try {
          await this.memoryStore.addMemory({
            type: "task",
            content: summary,
            importance: 0.6,
            ttlMs: this.memorySummaryTtlMs,
          });
        } catch (error) {
          console.warn("Failed to store summary memory:", error);
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
  });
}
