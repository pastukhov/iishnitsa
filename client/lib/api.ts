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
  buildAuthHeaders,
  fetchProviderModels,
  resolveBaseUrl,
} from "@/lib/providers";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatCompletionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }[];
  tool_call_id?: string;
}

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

interface OpenAIFunction {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export async function sendChatMessage(
  messages: Message[],
  endpoint: EndpointConfig,
  onChunk: (content: string) => void,
  mcpServers: MCPServer[] = [],
  mcpEnabled: boolean = false,
): Promise<void> {
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

  let tools: OpenAIFunction[] = [];
  let mcpToolsMap: Map<
    string,
    MCPTool & { serverName: string; serverId: string }
  > = new Map();

  if (mcpEnabled && mcpServers.length > 0) {
    const enabledServers = mcpServers.filter((s) => s.enabled);
    if (enabledServers.length > 0) {
      try {
        const { tools: fetchedTools, errors } =
          await getToolsFromServers(enabledServers);

        if (errors.length > 0) {
          console.warn("MCP server errors:", errors);
        }

        if (fetchedTools.length > 0) {
          tools = mcpToolsToOpenAIFunctions(fetchedTools);
          fetchedTools.forEach((tool) => {
            mcpToolsMap.set(`${tool.serverId}__${tool.name}`, tool);
          });
        }
      } catch (error) {
        console.error("Failed to fetch MCP tools:", error);
      }
    }
  }

  await processConversation(
    chatMessages,
    endpoint,
    onChunk,
    tools,
    mcpToolsMap,
    mcpServers,
  );
}

async function processConversation(
  messages: ChatCompletionMessage[],
  endpoint: EndpointConfig,
  onChunk: (content: string) => void,
  tools: OpenAIFunction[],
  mcpToolsMap: Map<string, MCPTool & { serverName: string; serverId: string }>,
  mcpServers: MCPServer[],
  depth: number = 0,
): Promise<void> {
  const maxDepth = 10;
  if (depth >= maxDepth) {
    throw new Error("Maximum tool call depth exceeded");
  }

  const baseUrl = resolveBaseUrl(endpoint.providerId, endpoint.baseUrl);
  const url = `${baseUrl}/chat/completions`;

  const requestBody: any = {
    model: endpoint.model,
    messages: messages,
    stream: true,
  };

  if (tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(endpoint.providerId, endpoint.apiKey),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `API Error: ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  let fullContent = "";
  let toolCalls: {
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }[] = [];
  let currentToolCallIndex = -1;

  const parseChunk = (chunk: string) => {
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;

        if (delta?.content) {
          fullContent += delta.content;
          onChunk(fullContent);
        }

        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index ?? 0;

            if (index > currentToolCallIndex) {
              currentToolCallIndex = index;
              toolCalls.push({
                id: toolCall.id || `call_${Date.now()}_${index}`,
                type: "function",
                function: {
                  name: toolCall.function?.name || "",
                  arguments: toolCall.function?.arguments || "",
                },
              });
            } else if (toolCalls[index]) {
              if (toolCall.function?.name) {
                toolCalls[index].function.name += toolCall.function.name;
              }
              if (toolCall.function?.arguments) {
                toolCalls[index].function.arguments +=
                  toolCall.function.arguments;
              }
            }
          }
        }
      } catch {}
    }
  };

  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      parseChunk(chunk);
    }
  } else {
    const responseText = await response.text();
    if (responseText.includes("data: ")) {
      parseChunk(responseText);
    } else if (responseText.trim()) {
      try {
        const json = JSON.parse(responseText);
        const message = json.choices?.[0]?.message;
        if (message?.content) {
          fullContent = message.content;
          onChunk(fullContent);
        }
        if (message?.tool_calls) {
          toolCalls = message.tool_calls.map((toolCall: any) => ({
            id: toolCall.id || "",
            type: "function",
            function: {
              name: toolCall.function?.name || "",
              arguments: toolCall.function?.arguments || "",
            },
          }));
        }
      } catch {}
    }
  }

  if (toolCalls.length > 0) {
    const assistantMessage: ChatCompletionMessage = {
      role: "assistant",
      content: fullContent || null,
      tool_calls: toolCalls,
    };
    messages.push(assistantMessage);

    const toolNames = toolCalls.map((tc) => {
      const { toolName } = parseToolCallName(tc.function.name);
      return toolName;
    });
    const statusMessage =
      toolNames.length === 1
        ? `[Using tool: ${toolNames[0]}...]`
        : `[Using tools: ${toolNames.join(", ")}...]`;

    onChunk(statusMessage);

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

    await processConversation(
      messages,
      endpoint,
      onChunk,
      tools,
      mcpToolsMap,
      mcpServers,
      depth + 1,
    );
  }
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
