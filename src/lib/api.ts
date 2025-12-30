import { Message, ToolCall } from "./store";

export interface OpenAIMessage {
  role: "user" | "assistant" | "system";
  content: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export async function sendChatMessage(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: OpenAIMessage[],
  tools?: MCPTool[],
  onChunk?: (chunk: string) => void
): Promise<{ content: string; toolCalls?: ToolCall[] }> {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body: Record<string, any> = {
    model,
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  const response = await window.electronAPI.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(response.error || `API error: ${response.status} ${response.statusText}`);
  }

  let content = "";
  const toolCalls: ToolCall[] = [];

  const lines = response.body.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (data === "[DONE]") break;

    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;

      if (delta?.content) {
        content += delta.content;
        onChunk?.(delta.content);
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined) {
            if (!toolCalls[tc.index]) {
              toolCalls[tc.index] = {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: {},
              };
            }
            if (tc.id) toolCalls[tc.index].id = tc.id;
            if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
            if (tc.function?.arguments) {
              const existing = toolCalls[tc.index].arguments as any;
              if (typeof existing === "string") {
                (toolCalls[tc.index] as any)._rawArgs =
                  (existing || "") + tc.function.arguments;
              } else {
                (toolCalls[tc.index] as any)._rawArgs =
                  ((toolCalls[tc.index] as any)._rawArgs || "") + tc.function.arguments;
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  for (const tc of toolCalls) {
    if ((tc as any)._rawArgs) {
      try {
        tc.arguments = JSON.parse((tc as any)._rawArgs);
      } catch {
        tc.arguments = {};
      }
      delete (tc as any)._rawArgs;
    }
  }

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls.filter((t) => t.id) : undefined,
  };
}
