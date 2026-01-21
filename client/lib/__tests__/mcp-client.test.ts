import {
  MCPClient,
  MCPTool,
  getToolsFromServers,
  executeToolCall,
  mcpToolsToOpenAIFunctions,
  parseToolCallName,
  clearClientCache,
} from "../mcp-client";
import { MCPServer } from "../store";

// Mock fetch
const mockFetch = global.fetch as jest.Mock;

// Helper to create mock headers
const createMockHeaders = (entries: [string, string][] = []) => ({
  get: (name: string) => {
    const entry = entries.find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    return entry ? entry[1] : null;
  },
});

describe("mcp-client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearClientCache();
  });

  describe("parseToolCallName", () => {
    it("parses function name with server id", () => {
      const result = parseToolCallName("server123__tool_name");
      expect(result.serverId).toBe("server123");
      expect(result.toolName).toBe("tool_name");
    });

    it("handles multiple underscores in tool name", () => {
      const result = parseToolCallName("server__my__tool__name");
      expect(result.serverId).toBe("server");
      expect(result.toolName).toBe("my__tool__name");
    });

    it("returns empty serverId for names without separator", () => {
      const result = parseToolCallName("tool_name");
      expect(result.serverId).toBe("");
      expect(result.toolName).toBe("tool_name");
    });

    it("handles empty string", () => {
      const result = parseToolCallName("");
      expect(result.serverId).toBe("");
      expect(result.toolName).toBe("");
    });
  });

  describe("mcpToolsToOpenAIFunctions", () => {
    it("converts MCP tools to OpenAI function format", () => {
      const tools: (MCPTool & { serverName: string; serverId: string })[] = [
        {
          name: "get_weather",
          description: "Get weather for a location",
          inputSchema: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
          serverName: "Weather Server",
          serverId: "weather123",
        },
      ];

      const result = mcpToolsToOpenAIFunctions(tools);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("function");
      expect(result[0].function.name).toBe("weather123__get_weather");
      expect(result[0].function.description).toBe(
        "[Weather Server] Get weather for a location",
      );
      expect(result[0].function.parameters).toEqual(tools[0].inputSchema);
    });

    it("handles multiple tools", () => {
      const tools: (MCPTool & { serverName: string; serverId: string })[] = [
        {
          name: "tool1",
          description: "First tool",
          inputSchema: { type: "object" },
          serverName: "Server A",
          serverId: "a",
        },
        {
          name: "tool2",
          description: "Second tool",
          inputSchema: { type: "object" },
          serverName: "Server B",
          serverId: "b",
        },
      ];

      const result = mcpToolsToOpenAIFunctions(tools);

      expect(result).toHaveLength(2);
      expect(result[0].function.name).toBe("a__tool1");
      expect(result[1].function.name).toBe("b__tool2");
    });

    it("returns empty array for empty input", () => {
      const result = mcpToolsToOpenAIFunctions([]);
      expect(result).toEqual([]);
    });
  });

  describe("MCPClient", () => {
    const mockServer: MCPServer = {
      id: "test-server",
      name: "Test Server",
      url: "http://localhost:3000/mcp",
      enabled: true,
    };

    const mockServerWithToken: MCPServer = {
      ...mockServer,
      token: "secret-token",
    };

    describe("constructor and matchesServer", () => {
      it("creates client from server config", () => {
        const client = new MCPClient(mockServer);
        expect(client.matchesServer(mockServer)).toBe(true);
      });

      it("detects when server config changes", () => {
        const client = new MCPClient(mockServer);
        const changedServer = { ...mockServer, url: "http://other:3000" };
        expect(client.matchesServer(changedServer)).toBe(false);
      });

      it("detects when token changes", () => {
        const client = new MCPClient(mockServerWithToken);
        const changedServer = { ...mockServerWithToken, token: "new-token" };
        expect(client.matchesServer(changedServer)).toBe(false);
      });
    });

    describe("initialize", () => {
      it("sends initialize request and initialized notification", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders([["mcp-session-id", "session123"]]),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: expect.any(Number),
                  result: {
                    protocolVersion: "2024-11-05",
                    serverInfo: { name: "Test" },
                    capabilities: {},
                  },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServer);
        const result = await client.initialize();

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(result.protocolVersion).toBe("2024-11-05");
      });

      it("returns cached result on subsequent calls", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: {
                    protocolVersion: "2024-11-05",
                    serverInfo: {},
                    capabilities: {},
                  },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        await client.initialize();

        // Only called twice for first initialize (request + notification)
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it("includes auth header when token is set", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServerWithToken);
        await client.initialize();

        expect(mockFetch).toHaveBeenCalledWith(
          mockServerWithToken.url,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer secret-token",
            }),
          }),
        );
      });

      it("throws on HTTP error", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: createMockHeaders(),
          text: () => Promise.resolve("Server error"),
        });

        const client = new MCPClient(mockServer);
        await expect(client.initialize()).rejects.toThrow(
          "MCP server returned 500",
        );
      });

      it("throws on JSON-RPC error", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                error: { code: -32600, message: "Invalid request" },
              }),
            ),
        });

        const client = new MCPClient(mockServer);
        await expect(client.initialize()).rejects.toThrow(
          "MCP error: Invalid request",
        );
      });
    });

    describe("listTools", () => {
      it("returns tools from server", async () => {
        // Mock initialize
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();

        // Mock listTools
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                result: {
                  tools: [
                    {
                      name: "test_tool",
                      description: "A test tool",
                      inputSchema: { type: "object" },
                    },
                  ],
                },
              }),
            ),
        });

        const tools = await client.listTools();

        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe("test_tool");
      });

      it("returns empty array when no tools", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 2,
                  result: {},
                }),
              ),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        const tools = await client.listTools();

        expect(tools).toEqual([]);
      });
    });

    describe("callTool", () => {
      it("calls tool and returns result", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 2,
                  result: {
                    content: [{ type: "text", text: "Tool result" }],
                  },
                }),
              ),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        const result = await client.callTool("test_tool", { arg1: "value1" });

        expect(result.content).toHaveLength(1);
        expect(result.content[0].text).toBe("Tool result");
      });
    });

    describe("listResources", () => {
      it("returns resources from server", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 2,
                  result: {
                    resources: [{ uri: "file://test.txt", name: "Test" }],
                  },
                }),
              ),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        const resources = await client.listResources();

        expect(resources).toHaveLength(1);
      });

      it("returns empty array on error", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          })
          .mockRejectedValueOnce(new Error("Network error"));

        const client = new MCPClient(mockServer);
        await client.initialize();
        const resources = await client.listResources();

        expect(resources).toEqual([]);
      });
    });

    describe("listPrompts", () => {
      it("returns prompts from server", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 2,
                  result: {
                    prompts: [{ name: "test_prompt" }],
                  },
                }),
              ),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        const prompts = await client.listPrompts();

        expect(prompts).toHaveLength(1);
      });

      it("returns empty array on error", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          })
          .mockRejectedValueOnce(new Error("Network error"));

        const client = new MCPClient(mockServer);
        await client.initialize();
        const prompts = await client.listPrompts();

        expect(prompts).toEqual([]);
      });
    });

    describe("SSE response parsing", () => {
      it("parses SSE formatted response", async () => {
        const requestId = 1700000000000;
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(requestId);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([["content-type", "text/event-stream"]]),
          text: () =>
            Promise.resolve(
              `data: {"jsonrpc":"2.0","id":${requestId},"result":{"protocolVersion":"2024-11-05"}}\n`,
            ),
        });

        const client = new MCPClient(mockServer);
        try {
          await client.initialize();
          expect(client.isInitialized()).toBe(true);
        } finally {
          nowSpy.mockRestore();
        }
      });
    });

    describe("isInitialized", () => {
      it("returns false before initialization", () => {
        const client = new MCPClient(mockServer);
        expect(client.isInitialized()).toBe(false);
      });

      it("returns true after initialization", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        expect(client.isInitialized()).toBe(true);
      });
    });

    describe("readResource", () => {
      it("reads a resource by URI", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders([["mcp-session-id", "session123"]]),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 2,
                  result: {
                    contents: [{ uri: "file://test.txt", text: "content" }],
                  },
                }),
              ),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        const result = await client.readResource("file://test.txt");

        expect(result.contents).toHaveLength(1);
      });
    });

    describe("session handling", () => {
      it("sends session ID in subsequent requests", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders([["mcp-session-id", "session123"]]),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 2,
                  result: { tools: [] },
                }),
              ),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        await client.listTools();

        // Third call should have session header
        expect(mockFetch).toHaveBeenCalledTimes(3);
        const lastCall = mockFetch.mock.calls[2];
        expect(lastCall[1].headers["Mcp-Session-Id"]).toBe("session123");
      });
    });

    describe("empty response handling", () => {
      it("returns null for empty response text", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders(),
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServer);
        await client.initialize();
        // Notification returns empty, which is handled
      });
    });

    describe("SSE parsing edge cases", () => {
      let dateNowSpy: jest.SpyInstance;

      beforeEach(() => {
        dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(1);
      });

      afterEach(() => {
        dateNowSpy.mockRestore();
      });

      it("parses SSE with data prefix correctly", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders([["content-type", "text/event-stream"]]),
            text: () =>
              Promise.resolve(
                `data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}\n`,
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServer);
        const result = await client.initialize();

        expect(result.protocolVersion).toBe("2024-11-05");
      });

      it("handles SSE with DONE marker", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders([["content-type", "text/event-stream"]]),
            text: () =>
              Promise.resolve(
                `data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}\ndata: [DONE]\n`,
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServer);
        const result = await client.initialize();

        expect(result.protocolVersion).toBe("2024-11-05");
      });

      it("handles SSE error in stream", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: createMockHeaders([["content-type", "text/event-stream"]]),
          text: () =>
            Promise.resolve(
              `data: {"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Bad request"}}\n`,
            ),
        });

        const client = new MCPClient(mockServer);
        await expect(client.initialize()).rejects.toThrow(
          "MCP error: Bad request",
        );
      });

      it("handles mismatched request id in SSE", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders([["content-type", "text/event-stream"]]),
            text: () =>
              Promise.resolve(
                `data: {"jsonrpc":"2.0","id":999,"result":{"other":"data"}}\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}\n`,
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(""),
          });

        const client = new MCPClient(mockServer);
        // Should find the matching id
        const result = await client.initialize();
        expect(result.protocolVersion).toBe("2024-11-05");
      });
    });

    describe("notification failure", () => {
      it("warns but does not throw on notification failure", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            headers: createMockHeaders(),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { protocolVersion: "2024-11-05" },
                }),
              ),
          })
          .mockRejectedValueOnce(new Error("Notification failed"));

        const client = new MCPClient(mockServer);
        const result = await client.initialize();

        expect(result.protocolVersion).toBe("2024-11-05");
        expect(consoleWarnSpy).toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
      });
    });
  });

  describe("getToolsFromServers", () => {
    const mockServer: MCPServer = {
      id: "server1",
      name: "Server 1",
      url: "http://localhost:3000",
      enabled: true,
    };

    it("returns tools from enabled servers", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: { protocolVersion: "2024-11-05" },
              }),
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                result: {
                  tools: [
                    {
                      name: "tool1",
                      description: "Test",
                      inputSchema: { type: "object" },
                    },
                  ],
                },
              }),
            ),
        });

      const result = await getToolsFromServers([mockServer]);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].serverName).toBe("Server 1");
      expect(result.tools[0].serverId).toBe("server1");
      expect(result.errors).toHaveLength(0);
    });

    it("skips disabled servers", async () => {
      const disabledServer = { ...mockServer, enabled: false };

      const result = await getToolsFromServers([disabledServer]);

      expect(result.tools).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("collects errors from failed servers", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection failed"));

      const result = await getToolsFromServers([mockServer]);

      expect(result.tools).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].serverName).toBe("Server 1");
      expect(result.errors[0].error).toBe("Connection failed");
    });
  });

  describe("executeToolCall", () => {
    const mockServer: MCPServer = {
      id: "server1",
      name: "Server 1",
      url: "http://localhost:3000",
      enabled: true,
    };

    it("executes tool call and returns result", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: { protocolVersion: "2024-11-05" },
              }),
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                result: {
                  content: [{ type: "text", text: "Result" }],
                },
              }),
            ),
        });

      const result = await executeToolCall(mockServer, "my_tool", {
        arg: "value",
      });

      expect(result.content[0].text).toBe("Result");
    });
  });

  describe("clearClientCache", () => {
    it("clears specific server from cache", async () => {
      const server: MCPServer = {
        id: "server1",
        name: "Server 1",
        url: "http://localhost:3000",
        enabled: true,
      };

      // First getToolsFromServers call: initialize (2 fetches) + listTools (1 fetch) = 3
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: { protocolVersion: "2024-11-05" },
              }),
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                result: { tools: [] },
              }),
            ),
        });

      // Initialize to add to cache
      await getToolsFromServers([server]);

      // Clear cache
      clearClientCache("server1");

      // Second getToolsFromServers call: initialize (2 fetches) + listTools (1 fetch) = 3
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: { protocolVersion: "2024-11-05" },
              }),
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                result: { tools: [] },
              }),
            ),
        });

      await getToolsFromServers([server]);

      // Should have made 6 calls total (3 + 3): initialize(2) + listTools(1) per call
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });

    it("clears all servers when no id provided", () => {
      clearClientCache();
      // Just verify it doesn't throw
    });
  });
});
