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
    const streamedCalls = new Map<number, ToolCall>();
    let usage: LLMUsage | undefined;
    let line = "";
    let dataLines: string[] = [];
    let skipLF = false;
    let streamDone = false;
    let finishReason: string | undefined;

    const parseEvent = (data: string) => {
      if (streamDone) return;
      if (data === "[DONE]") {
        streamDone = true;
        return;
      }
      // A malformed event must fail the turn, not silently alter tool arguments.
      const json = JSON.parse(data);
      const choice = json.choices?.[0];
      const delta = choice?.delta;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
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
      for (const fragment of delta?.tool_calls ?? []) {
        const index = fragment.index ?? 0;
        if (!Number.isInteger(index) || index < 0) {
          throw new Error("Invalid tool call index");
        }
        const call = streamedCalls.get(index) ?? {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        };
        call.id += fragment.id ?? "";
        call.function.name += fragment.function?.name ?? "";
        call.function.arguments += fragment.function?.arguments ?? "";
        streamedCalls.set(index, call);
      }
    };

    const parseLine = () => {
      if (line === "") {
        if (dataLines.length > 0) parseEvent(dataLines.join("\n"));
        dataLines = [];
      } else {
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "data") dataLines.push(value);
      }
      line = "";
    };

    // Network reads can split UTF-8, fields, JSON, or CRLF at any byte.
    const parseChunk = (chunk: string) => {
      for (const character of chunk) {
        if (skipLF) {
          skipLF = false;
          if (character === "\n") continue;
        }
        if (character === "\r" || character === "\n") {
          parseLine();
          skipLF = character === "\r";
        } else {
          line += character;
        }
      }
    };

    const finishStream = () => {
      // DONE already ended the event stream; trailing SSE fields are inert.
      if (!streamDone && (line.length > 0 || dataLines.length > 0)) {
        throw new Error("Incomplete SSE event");
      }
      toolCalls = [...streamedCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call);
      if (toolCalls.length === 0) return;
      if (
        (!streamDone && finishReason !== "tool_calls") ||
        (finishReason && finishReason !== "tool_calls")
      ) {
        throw new Error("Incomplete tool call stream");
      }
      for (const call of toolCalls) {
        if (!call.id.trim() || !call.function.name.trim()) {
          throw new Error("Incomplete tool call identity");
        }
        const args = JSON.parse(call.function.arguments);
        if (args === null || typeof args !== "object" || Array.isArray(args)) {
          throw new Error("Tool call arguments must be a JSON object");
        }
      }
    };

    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        parseChunk(chunk);
      }
      parseChunk(decoder.decode());
      finishStream();
    } else {
      const responseText = await response.text();
      if (/^data(?::|$)/m.test(responseText)) {
        parseChunk(responseText);
        finishStream();
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
