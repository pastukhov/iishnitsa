import { MCPServer } from "@/lib/store";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class MCPClient {
  private serverUrl: string;
  private serverName: string;

  constructor(server: MCPServer) {
    this.serverUrl = server.url;
    this.serverName = server.name;
  }

  private async sendRequest(method: string, params?: Record<string, any>): Promise<any> {
    const request: MCPRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    try {
      const response = await fetch(this.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`MCP server returned ${response.status}: ${await response.text()}`);
      }

      const jsonResponse: MCPResponse = await response.json();

      if (jsonResponse.error) {
        throw new Error(`MCP error: ${jsonResponse.error.message}`);
      }

      return jsonResponse.result;
    } catch (error: any) {
      console.error(`MCP request to ${this.serverName} failed:`, error);
      throw error;
    }
  }

  async initialize(): Promise<{ protocolVersion: string; serverInfo: any; capabilities: any }> {
    const result = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "AI Agent Mobile",
        version: "1.0.0",
      },
    });
    
    await this.sendRequest("notifications/initialized");
    
    return result;
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest("tools/list");
    return result?.tools || [];
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<MCPToolResult> {
    const result = await this.sendRequest("tools/call", {
      name: toolName,
      arguments: args,
    });
    return result;
  }

  async listResources(): Promise<any[]> {
    try {
      const result = await this.sendRequest("resources/list");
      return result?.resources || [];
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<any> {
    const result = await this.sendRequest("resources/read", { uri });
    return result;
  }

  async listPrompts(): Promise<any[]> {
    try {
      const result = await this.sendRequest("prompts/list");
      return result?.prompts || [];
    } catch {
      return [];
    }
  }
}

export async function getToolsFromServers(servers: MCPServer[]): Promise<{
  tools: Array<MCPTool & { serverName: string; serverId: string }>;
  errors: Array<{ serverName: string; error: string }>;
}> {
  const enabledServers = servers.filter((s) => s.enabled);
  const tools: Array<MCPTool & { serverName: string; serverId: string }> = [];
  const errors: Array<{ serverName: string; error: string }> = [];

  await Promise.all(
    enabledServers.map(async (server) => {
      try {
        const client = new MCPClient(server);
        await client.initialize();
        const serverTools = await client.listTools();

        serverTools.forEach((tool) => {
          tools.push({
            ...tool,
            serverName: server.name,
            serverId: server.id,
          });
        });
      } catch (error: any) {
        errors.push({
          serverName: server.name,
          error: error.message || "Failed to connect",
        });
      }
    })
  );

  return { tools, errors };
}

export async function executeToolCall(
  server: MCPServer,
  toolName: string,
  args: Record<string, any>
): Promise<MCPToolResult> {
  const client = new MCPClient(server);
  await client.initialize();
  return await client.callTool(toolName, args);
}

export function mcpToolsToOpenAIFunctions(
  tools: Array<MCPTool & { serverName: string; serverId: string }>
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: `${tool.serverId}__${tool.name}`,
      description: `[${tool.serverName}] ${tool.description}`,
      parameters: tool.inputSchema,
    },
  }));
}

export function parseToolCallName(functionName: string): {
  serverId: string;
  toolName: string;
} {
  const parts = functionName.split("__");
  if (parts.length >= 2) {
    return {
      serverId: parts[0],
      toolName: parts.slice(1).join("__"),
    };
  }
  return { serverId: "", toolName: functionName };
}
