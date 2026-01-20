import { Message, EndpointConfig, MCPServer } from "@/lib/store";
import { getToolsFromServers } from "@/lib/mcp-client";
import { fetchProviderModels } from "@/lib/providers";
import { runAgentChat } from "@/lib/agent/core";

export async function sendChatMessage(
  messages: Message[],
  endpoint: EndpointConfig,
  onChunk: (content: string) => void,
  mcpServers: MCPServer[] = [],
  mcpEnabled: boolean = false,
): Promise<void> {
  await runAgentChat(messages, endpoint, onChunk, mcpServers, mcpEnabled);
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
