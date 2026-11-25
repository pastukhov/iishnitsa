import { cancellable, throwIfCancelled } from "@/lib/runtime/cancellation";
import type { BoundaryObserver } from "@/lib/agent/execution-trace";
import { EndpointConfig } from "@/lib/store";
import { buildProviderHeaders, resolveBaseUrl } from "@/lib/providers";
import {
  AgentDecision,
  ChatCompletionMessage,
  LLMUsage,
  OpenAIFunction,
  ToolCall,
} from "@/lib/agent/types";

interface StreamChatInput {
  /** Internal bounded text subtasks only; no tools or unbounded body fallback. */
  textOnly?: boolean;
  signal?: AbortSignal;
  endpoint: EndpointConfig;
  messages: ChatCompletionMessage[];
  tools: OpenAIFunction[];
  onChunk: (content: string) => void;
  decision?: AgentDecision;
  boundary?: BoundaryObserver;
  beforeDispatch?: () => void;
}

export class LLMResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LLMResponseError";
  }
}

export class OpenAICompatibleDriver {
  async streamChat(input: StreamChatInput): Promise<{
    fullContent: string;
    toolCalls: ToolCall[];
    usage?: LLMUsage;
  }> {
    let dispatched = false;
    let finished = false;
    const boundary: BoundaryObserver = {
      dispatched: () => {
        dispatched = true;
        try {
          input.boundary?.dispatched();
        } catch {
          /* Observers are passive. */
        }
      },
      finish: (outcome) => {
        if (finished) return;
        finished = true;
        try {
          input.boundary?.finish(outcome);
        } catch {
          /* Observers are passive. */
        }
      },
    };
    try {
      const result = await this.executeChat(input, boundary);
      throwIfCancelled(input.signal);
      boundary.finish("completed");
      return result;
    } catch (error) {
      boundary.finish(dispatched ? "unknown" : "failed");
      throwIfCancelled(input.signal);
      throw error;
    }
  }

  private async executeChat(
    {
      endpoint,
      messages,
      tools,
      onChunk,
      decision,
      beforeDispatch,
      signal,
      textOnly,
    }: StreamChatInput,
    boundary: BoundaryObserver,
  ): Promise<{ fullContent: string; toolCalls: ToolCall[]; usage?: LLMUsage }> {
    if (textOnly && tools.length) throw new Error("Text-only tools denied");
    const baseUrl = resolveBaseUrl(endpoint.providerId, endpoint.baseUrl);
    const url = `${baseUrl}/chat/completions`;

    const requestBody: any = {
      model: decision?.model || endpoint.model,
      messages: messages,
      stream: true,
      ...(textOnly ? { max_tokens: 1024 } : {}),
    };

    if (tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = decision?.toolChoice || "auto";
    }

    const request = {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: {
        "Content-Type": "application/json",
        ...buildProviderHeaders(
          endpoint.providerId,
          endpoint.apiKey,
          endpoint.folderId,
        ),
      },
      body: JSON.stringify(requestBody),
    };
    throwIfCancelled(signal);
    beforeDispatch?.();
    throwIfCancelled(signal);
    boundary.dispatched();
    const response = await cancellable(fetch(url, request), signal);

    if (!response.ok) {
      boundary.finish("failed");
      if (textOnly) {
        try {
          const reader = response.body?.getReader();
          void Promise.resolve(reader?.cancel()).catch(() => {});
          reader?.releaseLock?.();
        } catch {
          /* Best-effort transport cleanup. */
        }
        throw new LLMResponseError(
          "Text model request failed",
          response.status,
        );
      }
      const errorText = await cancellable(response.text(), signal);
      let errorMessage = `API Error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new LLMResponseError(errorMessage, response.status);
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
      throwIfCancelled(signal);
      if (streamDone) return;
      if (data === "[DONE]") {
        streamDone = true;
        return;
      }
      // A malformed event must fail the turn, not silently alter tool arguments.
      const json = JSON.parse(data);
      const choice = json.choices?.[0];
      const delta = choice?.delta;
      if (
        textOnly &&
        (delta?.tool_calls ||
          delta?.function_call ||
          ["tool_calls", "function_call"].includes(choice?.finish_reason))
      )
        throw new Error("Text-only tools denied");
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (json.usage) {
        usage = {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        };
      }
      if (delta?.content) {
        if (
          textOnly &&
          (typeof delta.content !== "string" ||
            new TextEncoder().encode(fullContent + delta.content).byteLength >
              4096)
        )
          throw new Error("Text output budget exceeded");
        fullContent += delta.content;
        onChunk(fullContent);
        throwIfCancelled(signal);
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
      if (
        textOnly &&
        (!fullContent ||
          (!streamDone &&
            !["stop", "length", "content_filter"].includes(finishReason ?? "")))
      )
        throw new Error("Incomplete text response");
      // DONE already ended the event stream; trailing SSE fields are inert.
      if (!streamDone && (line.length > 0 || dataLines.length > 0)) {
        throw new Error("Incomplete SSE event");
      }
      toolCalls = [...streamedCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call);
      if (toolCalls.length === 0) {
        if (
          !streamDone &&
          ![
            "stop",
            "length",
            "content_filter",
            "tool_calls",
            "function_call",
          ].includes(finishReason ?? "")
        ) {
          boundary.finish("unknown");
        }
        return;
      }
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
      let cancelled = false;
      const abortReader = () => {
        if (cancelled) return;
        cancelled = true;
        try {
          void Promise.resolve(reader.cancel?.()).catch(() => {});
        } catch {
          /* Cleanup is best effort. */
        }
      };
      signal?.addEventListener("abort", abortReader, { once: true });
      try {
        throwIfCancelled(signal);
        let wireBytes = 0;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        while (true) {
          const { done, value } = await cancellable(reader.read(), signal);
          throwIfCancelled(signal);
          if (done) break;
          wireBytes += value.byteLength;
          if (textOnly && wireBytes > 65536)
            throw new Error("Text wire budget exceeded");
          parseChunk(decoder.decode(value, { stream: true }));
        }
        parseChunk(decoder.decode());
        finishStream();
      } catch (error) {
        if (textOnly) abortReader();
        throw error;
      } finally {
        signal?.removeEventListener("abort", abortReader);
        if (signal?.aborted) abortReader();
        try {
          reader.releaseLock?.();
        } catch {
          /* Cleanup is best effort. */
        }
      }
    } else {
      if (textOnly) throw new Error("Text streaming unavailable");
      const responseText = await cancellable(response.text(), signal);
      if (/^data(?::|$)/m.test(responseText)) {
        parseChunk(responseText);
        finishStream();
      } else if (responseText.trim()) {
        try {
          const json = JSON.parse(responseText);
          const message = json.choices?.[0]?.message;
          if (!message) boundary.finish("unknown");
          if (message?.content) {
            fullContent = message.content;
            throwIfCancelled(signal);
            onChunk(fullContent);
            throwIfCancelled(signal);
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
        } catch {
          boundary.finish("unknown");
        }
      } else {
        boundary.finish("unknown");
      }
    }

    throwIfCancelled(signal);
    return { fullContent, toolCalls, usage };
  }
}
