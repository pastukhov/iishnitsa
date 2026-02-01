import { EndpointConfig } from "@/lib/store";
import { buildProviderHeaders, resolveBaseUrl } from "@/lib/providers";
import {
  AgentDecision,
  ChatCompletionMessage,
  LLMUsage,
  OpenAIFunction,
  ToolCall,
} from "@/lib/agent/types";

export class OpenAICompatibleDriver {
  async streamChat({
    endpoint,
    messages,
    tools,
    onChunk,
    decision,
  }: {
    endpoint: EndpointConfig;
    messages: ChatCompletionMessage[];
    tools: OpenAIFunction[];
    onChunk: (content: string) => void;
    decision?: AgentDecision;
  }): Promise<{
    fullContent: string;
    toolCalls: ToolCall[];
    usage?: LLMUsage;
  }> {
    const baseUrl = resolveBaseUrl(endpoint.providerId, endpoint.baseUrl);
    const url = `${baseUrl}/chat/completions`;

    const requestBody: any = {
      model: decision?.model || endpoint.model,
      messages: messages,
      stream: true,
    };

    if (tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = decision?.toolChoice || "auto";
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildProviderHeaders(
          endpoint.providerId,
          endpoint.apiKey,
          endpoint.folderId,
        ),
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
    let toolCalls: ToolCall[] = [];
    let currentToolCallIndex = -1;
    let usage: LLMUsage | undefined;

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
          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
              totalTokens: json.usage.total_tokens,
            };
          }

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
          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
              totalTokens: json.usage.total_tokens,
            };
          }
        } catch {}
      }
    }

    return { fullContent, toolCalls, usage };
  }
}
