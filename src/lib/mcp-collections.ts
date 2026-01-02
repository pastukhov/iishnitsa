import { parse, stringify } from "yaml";
import type { MCPServer, MCPServerCollection } from "./store";

export interface MCPCollectionsImport {
  collections: MCPServerCollection[];
  activeCollectionId: string | null;
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

const normalizeServer = (raw: RawServer, index: number): MCPServer | null => {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!name || !url) return null;

  return {
    id: crypto.randomUUID(),
    name,
    url,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
  };
};

const normalizeCollection = (
  raw: RawCollection,
  index: number,
): MCPServerCollection => {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const serversRaw = Array.isArray(raw.servers) ? raw.servers : [];
  const servers = serversRaw
    .map((server, serverIndex) =>
      normalizeServer((server || {}) as RawServer, serverIndex),
    )
    .filter(Boolean) as MCPServer[];

  return {
    id: crypto.randomUUID(),
    name: name || `Collection ${index + 1}`,
    servers,
  };
};

const normalizeCollectionsPayload = (
  payload: unknown,
): { collections: MCPServerCollection[]; activeName?: string } => {
  if (Array.isArray(payload)) {
    const isServerList = payload.every(
      (item) =>
        item &&
        typeof item === "object" &&
        "url" in item &&
        !("servers" in item),
    );
    if (isServerList) {
      return {
        collections: [
          normalizeCollection(
            { name: "Imported", servers: payload as RawServer[] },
            0,
          ),
        ],
      };
    }

    return {
      collections: payload.map((item, index) =>
        normalizeCollection((item || {}) as RawCollection, index),
      ),
    };
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const collectionsRaw = Array.isArray(record.collections)
      ? record.collections
      : [];
    return {
      collections: collectionsRaw.map((item, index) =>
        normalizeCollection((item || {}) as RawCollection, index),
      ),
      activeName:
        typeof record.activeCollection === "string"
          ? record.activeCollection
          : undefined,
    };
  }

  return { collections: [] };
};

export const parseMCPCollectionsYaml = (
  yamlText: string,
): MCPCollectionsImport => {
  const warnings: string[] = [];
  const parsed = parse(yamlText);
  const { collections, activeName } = normalizeCollectionsPayload(parsed);

  if (collections.length === 0) {
    warnings.push("No collections found in YAML. Import created nothing.");
  }

  const active =
    activeName && collections.length > 0
      ? collections.find((collection) => collection.name === activeName) || null
      : null;

  return {
    collections,
    activeCollectionId: active ? active.id : collections[0]?.id || null,
    warnings,
  };
};

export const buildMCPCollectionsYaml = (
  collections: MCPServerCollection[],
  activeCollectionId: string | null,
): string => {
  const activeCollection = activeCollectionId
    ? collections.find((collection) => collection.id === activeCollectionId) ||
      null
    : null;

  const payload = {
    version: 1,
    activeCollection: activeCollection ? activeCollection.name : null,
    collections: collections.map((collection) => ({
      name: collection.name,
      servers: collection.servers.map((server) => ({
        name: server.name,
        url: server.url,
        enabled: server.enabled,
      })),
    })),
  };

  return stringify(payload);
};
