import {
  clearMcpRegistry,
  getRegisteredTools,
  markToolFailure,
  registerMcpTools,
} from "../mcp-registry";

describe("mcp-registry", () => {
  beforeEach(() => {
    clearMcpRegistry();
  });

  it("registers tools and returns them sorted by name", () => {
    registerMcpTools([
      {
        serverId: "server",
        serverName: "Server",
        name: "zeta",
        description: "Z",
        inputSchema: { type: "object" },
      },
      {
        serverId: "server",
        serverName: "Server",
        name: "alpha",
        description: "A",
        inputSchema: { type: "object" },
      },
    ]);

    const tools = getRegisteredTools();
    expect(tools.map((entry) => entry.tool.name)).toEqual(["alpha", "zeta"]);
  });

  it("keeps failure count across updates and increments on failure", () => {
    registerMcpTools([
      {
        serverId: "server",
        serverName: "Server",
        name: "tool",
        description: "Tool",
        inputSchema: { type: "object" },
      },
    ]);

    markToolFailure("server", "tool");
    markToolFailure("server", "tool");

    registerMcpTools([
      {
        serverId: "server",
        serverName: "Server",
        name: "tool",
        description: "Tool updated",
        inputSchema: { type: "object" },
      },
    ]);

    const tools = getRegisteredTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].failureCount).toBe(2);
    expect(tools[0].tool.description).toBe("Tool updated");
  });
});
