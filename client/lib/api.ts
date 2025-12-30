import { Message, EndpointConfig, MCPServer } from "@/lib/store";

interface ChatCompletionMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function sendChatMessage(
  messages: Message[],
  endpoint: EndpointConfig,
  onChunk: (content: string) => void,
  mcpServers: MCPServer[] = []
): Promise<void> {
  const chatMessages: ChatCompletionMessage[] = [];

  if (endpoint.systemPrompt) {
    chatMessages.push({
      role: "system",
      content: buildSystemPrompt(endpoint.systemPrompt, mcpServers),
    });
  }

  messages.forEach((msg) => {
    if (msg.role !== "system" && msg.content) {
      chatMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  });

  const url = new URL("/chat/completions", normalizeBaseUrl(endpoint.baseUrl));

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages: chatMessages,
      stream: true,
    }),
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

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            onChunk(fullContent);
          }
        } catch {
        }
      }
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  if (!url.endsWith("/v1")) {
    if (!url.includes("/v1")) {
      url = url + "/v1";
    }
  }
  return url;
}

function buildSystemPrompt(basePrompt: string, mcpServers: MCPServer[]): string {
  if (mcpServers.length === 0) {
    return basePrompt;
  }

  const mcpInfo = mcpServers
    .map((server) => `- ${server.name}: ${server.url}`)
    .join("\n");

  return `${basePrompt}

You have access to the following MCP servers for enhanced capabilities:
${mcpInfo}

When you need to use external tools or data, mention which MCP server you would use.`;
}

export async function testConnection(endpoint: EndpointConfig): Promise<{
  success: boolean;
  message: string;
  models?: string[];
}> {
  try {
    const url = new URL("/models", normalizeBaseUrl(endpoint.baseUrl));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `Connection failed: ${response.status} ${errorText}`,
      };
    }

    const data = await response.json();
    const models = data.data?.map((m: any) => m.id) || [];

    return {
      success: true,
      message: `Connected! Found ${models.length} models.`,
      models,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Connection error: ${error.message}`,
    };
  }
}
