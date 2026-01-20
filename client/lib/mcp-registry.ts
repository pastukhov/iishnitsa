import { MCPTool } from "@/lib/mcp-client";

export type ToolLatencyClass = "low" | "medium" | "high";

export interface MCPRegistryEntry {
  tool: MCPTool & { serverName: string; serverId: string };
  latencyClass: ToolLatencyClass;
  lastSeenAt: number;
  failureCount: number;
}

const registry = new Map<string, MCPRegistryEntry>();
const latencyOrder: ToolLatencyClass[] = ["low", "medium", "high"];

function toolKey(serverId: string, toolName: string) {
  return `${serverId}__${toolName}`;
}

function classifyLatency(): ToolLatencyClass {
  return "medium";
}

export function registerMcpTools(
  tools: (MCPTool & { serverName: string; serverId: string })[],
): void {
  const now = Date.now();
  tools.forEach((tool) => {
    const key = toolKey(tool.serverId, tool.name);
    const existing = registry.get(key);
    registry.set(key, {
      tool,
      latencyClass: existing?.latencyClass ?? classifyLatency(),
      lastSeenAt: now,
      failureCount: existing?.failureCount ?? 0,
    });
  });
}

export function markToolFailure(serverId: string, toolName: string): void {
  const key = toolKey(serverId, toolName);
  const entry = registry.get(key);
  if (!entry) return;
  entry.failureCount += 1;
  entry.lastSeenAt = Date.now();
}

export function getRegisteredTools(options?: {
  serverIds?: string[];
}): MCPRegistryEntry[] {
  const entries = Array.from(registry.values());
  const filtered = options?.serverIds
    ? entries.filter((entry) =>
        options.serverIds?.includes(entry.tool.serverId),
      )
    : entries;

  return filtered.sort((a, b) => {
    const latencyDiff =
      latencyOrder.indexOf(a.latencyClass) -
      latencyOrder.indexOf(b.latencyClass);
    if (latencyDiff !== 0) return latencyDiff;
    if (a.tool.serverName !== b.tool.serverName) {
      return a.tool.serverName.localeCompare(b.tool.serverName);
    }
    return a.tool.name.localeCompare(b.tool.name);
  });
}

export function clearMcpRegistry(): void {
  registry.clear();
}
