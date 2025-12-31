import { MCPTool } from "./api";

interface MCPClientState {
  sessionId: string | null;
  tools: MCPTool[];
}

const clientStates = new Map<string, MCPClientState>();

async function mcpRequest(
  serverUrl: string,
  method: string,
  params: Record<string, any> = {},
  id?: number,
): Promise<any> {
  const state = clientStates.get(serverUrl);
  const isNotification = method.startsWith("notifications/");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  if (state?.sessionId && method !== "initialize") {
    headers["Mcp-Session-Id"] = state.sessionId;
  }

  const body: Record<string, any> = {
    jsonrpc: "2.0",
    method,
    params,
  };

  if (!isNotification) {
    body.id = id ?? Date.now();
  }

  const response = await window.electronAPI.fetch(serverUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const newSessionId = response.headers["mcp-session-id"];
  if (newSessionId) {
    if (!clientStates.has(serverUrl)) {
      clientStates.set(serverUrl, { sessionId: null, tools: [] });
    }
    clientStates.get(serverUrl)!.sessionId = newSessionId;
  }

  if (isNotification || response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`MCP error: ${response.statusText}`);
  }

  if (!response.body) {
    return null;
  }

  const data =
    typeof response.body === "string"
      ? JSON.parse(response.body)
      : response.body;
  if (data.error) {
    throw new Error(
      `MCP error: ${data.error.message || JSON.stringify(data.error)}`,
    );
  }

  return data.result;
}

export async function initializeMCPServer(
  serverUrl: string,
): Promise<MCPTool[]> {
  clientStates.set(serverUrl, { sessionId: null, tools: [] });

  await mcpRequest(serverUrl, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "AI Agent Desktop", version: "1.0.0" },
  });

  await mcpRequest(serverUrl, "notifications/initialized", {});

  const toolsResult = await mcpRequest(serverUrl, "tools/list", {});
  const tools: MCPTool[] = (toolsResult?.tools || []).map((t: any) => ({
    name: t.name,
    description: t.description || "",
    inputSchema: t.inputSchema || {},
  }));

  clientStates.get(serverUrl)!.tools = tools;
  return tools;
}

export async function callMCPTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, any>,
): Promise<any> {
  const result = await mcpRequest(serverUrl, "tools/call", {
    name: toolName,
    arguments: args,
  });

  return result;
}

export function getMCPTools(serverUrl: string): MCPTool[] {
  return clientStates.get(serverUrl)?.tools || [];
}

export function clearMCPSession(serverUrl: string): void {
  clientStates.delete(serverUrl);
}
