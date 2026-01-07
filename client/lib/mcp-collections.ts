import { parse, stringify } from "yaml";
import type { MCPServer } from "@/lib/store";

export interface MCPServersImport {
  servers: MCPServer[];
  warnings: string[];
}

type RawServer = {
  name?: unknown;
  url?: unknown;
  enabled?: unknown;
};

type RawCollection = {
  name?: unknown;
  servers?: unknown;
};

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const normalizeServer = (raw: RawServer): MCPServer | null => {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!name || !url) return null;

  return {
    id: generateId(),
    name,
    url,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
  };
};

const extractServers = (
  payload: unknown,
): {
  servers: RawServer[];
  warnings: string[];
} => {
  const warnings: string[] = [];

  if (Array.isArray(payload)) {
    const isServerList = payload.every(
      (item) =>
        item &&
        typeof item === "object" &&
        "url" in item &&
        !("servers" in item),
    );
    if (isServerList) {
      return { servers: payload as RawServer[], warnings };
    }

    const collections = payload as RawCollection[];
    if (collections.length > 0) {
      warnings.push("Imported collection list. Using the first collection.");
      const serversRaw = Array.isArray(collections[0].servers)
        ? collections[0].servers
        : [];
      return { servers: serversRaw as RawServer[], warnings };
    }
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const serversRaw = Array.isArray(record.servers)
      ? record.servers
      : Array.isArray(record.mcpServers)
        ? record.mcpServers
        : null;
    if (serversRaw) {
      return { servers: serversRaw as RawServer[], warnings };
    }

    const collectionsRaw = Array.isArray(record.collections)
      ? (record.collections as RawCollection[])
      : [];
    if (collectionsRaw.length > 0) {
      const activeName =
        typeof record.activeCollection === "string"
          ? record.activeCollection
          : null;
      const active =
        activeName &&
        collectionsRaw.find((collection) => collection.name === activeName);
      if (!active) {
        warnings.push(
          "Imported collections. Active collection not found, using the first one.",
        );
      }
      const selected = active || collectionsRaw[0];
      const servers = Array.isArray(selected.servers) ? selected.servers : [];
      return { servers: servers as RawServer[], warnings };
    }
  }

  return { servers: [], warnings };
};

export const parseMCPServersYaml = (yamlText: string): MCPServersImport => {
  const parsed = parse(yamlText);
  const { servers: rawServers, warnings } = extractServers(parsed);
  const servers = rawServers
    .map((raw) => normalizeServer((raw || {}) as RawServer))
    .filter(Boolean) as MCPServer[];

  if (servers.length === 0) {
    warnings.push("No servers found in YAML.");
  }

  return { servers, warnings };
};

export const buildMCPServersYaml = (servers: MCPServer[]): string => {
  const payload = servers.map((server) => ({
    name: server.name,
    url: server.url,
    enabled: server.enabled,
  }));

  return stringify(payload);
};
