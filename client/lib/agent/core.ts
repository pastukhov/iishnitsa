import {
  Message,
  EndpointConfig,
  MCPServer,
  MessageAttachment,
} from "@/lib/store";
import { getImageDataUrl } from "@/lib/image-utils";
import {
  getToolsFromServers,
  executeToolCall,
  mcpToolsToOpenAIFunctions,
  parseToolCallName,
  MCPTool,
  MCPToolResult,
} from "@/lib/mcp-client";
import {
  AgentState,
  ChatCompletionMessage,
  ContentPart,
  OpenAIFunction,
  ToolCall,
} from "@/lib/agent/types";
import { OpenAICompatibleDriver } from "@/lib/agent/openai-driver";

async function buildMultimodalContent(
  text: string,
  attachments?: MessageAttachment[],
): Promise<string | ContentPart[]> {
  if (!attachments || attachments.length === 0) {
    return text;
  }

  const parts: ContentPart[] = [];

  if (text) {
    parts.push({ type: "text", text });
  }

  for (const attachment of attachments) {
    if (attachment.type === "image") {
      const dataUrl = await getImageDataUrl(attachment);
      parts.push({
        type: "image_url",
        image_url: { url: dataUrl },
      });
    }
  }

  return parts;
}

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

interface AgentRunInput {
  messages: Message[];
  endpoint: EndpointConfig;
  onChunk: (content: string) => void;
  mcpServers: MCPServer[];
  mcpEnabled: boolean;
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
}

export class AgentCore {
  private state: AgentState = "IDLE";
  private maxDepth: number;
  private driver: OpenAICompatibleDriver;

  constructor({
    maxDepth = 10,
    driver = new OpenAICompatibleDriver(),
  }: {
    maxDepth?: number;
    driver?: OpenAICompatibleDriver;
  } = {}) {
    this.maxDepth = maxDepth;
    this.driver = driver;
  }

  async runChat({
    messages,
    endpoint,
    onChunk,
    mcpServers,
    mcpEnabled,
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

    while (this.state !== "IDLE") {
      switch (this.state) {
        case "RECEIVE_INPUT": {
          this.state = "BUILD_CONTEXT";
          break;
        }
        case "BUILD_CONTEXT": {
          if (!context.contextBuilt) {
            context.chatMessages = await this.buildChatMessages(
              context.rawMessages,
              endpoint,
            );
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
          this.state = "ACT";
          break;
        }
        case "ACT": {
          const { fullContent, toolCalls } = await this.driver.streamChat({
            endpoint,
            messages: context.chatMessages,
            tools: context.tools,
            onChunk,
            decision: {
              model: endpoint.model,
              toolChoice: context.tools.length > 0 ? "auto" : "none",
            },
          });

          if (toolCalls.length === 0) {
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
  }

  private async buildChatMessages(
    messages: Message[],
    endpoint: EndpointConfig,
  ): Promise<ChatCompletionMessage[]> {
    const chatMessages: ChatCompletionMessage[] = [];

    if (endpoint.systemPrompt) {
      chatMessages.push({
        role: "system",
        content: endpoint.systemPrompt,
      });
    }

    for (const msg of messages) {
      if (msg.role === "system") continue;
      const hasContent = msg.content && msg.content.trim().length > 0;
      const hasAttachments = msg.attachments && msg.attachments.length > 0;

      if (!hasContent && !hasAttachments) continue;

      if (msg.role === "user" && hasAttachments) {
        const content = await buildMultimodalContent(
          msg.content || "",
          msg.attachments,
        );
        chatMessages.push({ role: msg.role, content });
      } else {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }

    return chatMessages;
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
}

export async function runAgentChat(
  messages: Message[],
  endpoint: EndpointConfig,
  onChunk: (content: string) => void,
  mcpServers: MCPServer[] = [],
  mcpEnabled: boolean = false,
): Promise<void> {
  const agent = new AgentCore();
  await agent.runChat({ messages, endpoint, onChunk, mcpServers, mcpEnabled });
}
