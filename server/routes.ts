import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";

const mcpSessions = new Map<string, { created: Date }>();
const proxySessionCache = new Map<string, string>();

function generateSessionId(): string {
  return `mcp-session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const mockTools = [
  {
    name: "get_weather",
    description: "Get current weather for a location",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name or coordinates" },
      },
      required: ["location"],
    },
  },
  {
    name: "calculate",
    description: "Perform a mathematical calculation",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Math expression to evaluate" },
      },
      required: ["expression"],
    },
  },
  {
    name: "search_web",
    description: "Search the web for information",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results to return" },
      },
      required: ["query"],
    },
  },
];

function handleMCPRequest(method: string, params: any, sessionId: string | null): any {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "Mock MCP Server",
          version: "1.0.0",
        },
        capabilities: {
          tools: {},
        },
      };

    case "notifications/initialized":
      return null;

    case "tools/list":
      return { tools: mockTools };

    case "tools/call":
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (toolName === "get_weather") {
        return {
          content: [
            {
              type: "text",
              text: `Weather in ${args.location || "Unknown"}: Sunny, 22°C, humidity 45%`,
            },
          ],
        };
      }

      if (toolName === "calculate") {
        try {
          const result = Function(`"use strict"; return (${args.expression})`)();
          return {
            content: [{ type: "text", text: `Result: ${result}` }],
          };
        } catch (e: any) {
          return {
            content: [{ type: "text", text: `Error: ${e.message}` }],
            isError: true,
          };
        }
      }

      if (toolName === "search_web") {
        return {
          content: [
            {
              type: "text",
              text: `Search results for "${args.query}":\n1. Example result 1\n2. Example result 2\n3. Example result 3`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };

    default:
      throw { code: -32601, message: `Method not found: ${method}` };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/mcp", (req: Request, res: Response) => {
    const accept = req.headers.accept || "";
    if (!accept.includes("application/json") && !accept.includes("text/event-stream")) {
      res.status(406).json({
        jsonrpc: "2.0",
        id: req.body?.id,
        error: {
          code: -32600,
          message: "Not Acceptable: Client must accept both application/json or text/event-stream",
        },
      });
      return;
    }

    let sessionId = req.headers["mcp-session-id"] as string | undefined;
    const method = req.body?.method;
    const params = req.body?.params;
    const id = req.body?.id;

    if (method === "initialize") {
      sessionId = generateSessionId();
      mcpSessions.set(sessionId, { created: new Date() });
      res.setHeader("Mcp-Session-Id", sessionId);
    } else if (!sessionId && method !== "notifications/initialized") {
      res.status(400).json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32600,
          message: "Mcp-Session-Id header required for POST requests.",
        },
      });
      return;
    }

    try {
      const result = handleMCPRequest(method, params, sessionId || null);

      if (id === undefined) {
        res.status(204).send();
        return;
      }

      res.json({
        jsonrpc: "2.0",
        id,
        result,
      });
    } catch (error: any) {
      res.json({
        jsonrpc: "2.0",
        id,
        error: error.code ? error : { code: -32603, message: error.message || "Internal error" },
      });
    }
  });

  app.get("/api/mcp/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      activeSessions: mcpSessions.size,
      tools: mockTools.map((t) => t.name),
    });
  });

  app.post("/api/mcp-proxy", async (req: Request, res: Response) => {
    const { targetUrl, method, params, id } = req.body;

    if (!targetUrl) {
      res.status(400).json({ error: "targetUrl is required" });
      return;
    }

    const cacheKey = targetUrl;
    let sessionId = proxySessionCache.get(cacheKey);
    const isNotification = method.startsWith("notifications/");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };

    if (sessionId && method !== "initialize") {
      headers["Mcp-Session-Id"] = sessionId;
    }

    const jsonRpcRequest: Record<string, any> = {
      jsonrpc: "2.0",
      method,
      params,
    };

    if (!isNotification) {
      jsonRpcRequest.id = id ?? Date.now();
    }

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(jsonRpcRequest),
      });

      const newSessionId = response.headers.get("Mcp-Session-Id") ||
                           response.headers.get("mcp-session-id");
      if (newSessionId) {
        proxySessionCache.set(cacheKey, newSessionId);
        console.log(`MCP Proxy: Session ID received for ${targetUrl}: ${newSessionId.substring(0, 20)}...`);
      }

      if (response.status === 204 || isNotification) {
        res.json({
          jsonrpc: "2.0",
          result: null,
          _proxySessionId: newSessionId || sessionId || null,
        });
        return;
      }

      const responseText = await response.text();

      if (!response.ok) {
        console.error(`MCP Proxy error for ${targetUrl}:`, response.status, responseText);
        res.status(response.status).json({
          error: `MCP server returned ${response.status}`,
          details: responseText,
          sessionId: newSessionId || sessionId || null,
        });
        return;
      }

      const jsonResponse = responseText ? JSON.parse(responseText) : null;

      res.json({
        ...jsonResponse,
        _proxySessionId: newSessionId || sessionId || null,
      });
    } catch (error: any) {
      console.error(`MCP Proxy fetch error for ${targetUrl}:`, error.message);
      res.status(500).json({
        error: "Failed to connect to MCP server",
        details: error.message,
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
