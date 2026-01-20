import { EndpointConfig } from "@/lib/store";
import { ModelCapabilities, ModelCatalogEntry } from "@/lib/agent/types";

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsVision: false,
  supportsTools: true,
  supportsAudio: false,
  supportsStreaming: true,
};

const PROVIDER_DEFAULTS: Record<
  EndpointConfig["providerId"],
  ModelCapabilities
> = {
  openai: {
    supportsVision: true,
    supportsTools: true,
    supportsAudio: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
  },
  anthropic: {
    supportsVision: true,
    supportsTools: true,
    supportsAudio: false,
    supportsStreaming: true,
    maxContextTokens: 200000,
  },
  together: { ...DEFAULT_CAPABILITIES },
  mistral: { ...DEFAULT_CAPABILITIES },
  perplexity: { ...DEFAULT_CAPABILITIES },
  yandex: { ...DEFAULT_CAPABILITIES },
  replicate: { ...DEFAULT_CAPABILITIES },
  deepseek: { ...DEFAULT_CAPABILITIES },
  groq: { ...DEFAULT_CAPABILITIES },
  dashscope: { ...DEFAULT_CAPABILITIES },
  custom: { ...DEFAULT_CAPABILITIES },
};

const DEFAULT_MODEL_CATALOG: ModelCatalogEntry[] = [];
const modelRegistry: ModelCatalogEntry[] = [...DEFAULT_MODEL_CATALOG];

export function registerModel(entry: ModelCatalogEntry) {
  const existingIndex = modelRegistry.findIndex(
    (item) =>
      item.providerId === entry.providerId && item.model === entry.model,
  );
  if (existingIndex >= 0) {
    modelRegistry[existingIndex] = entry;
  } else {
    modelRegistry.push(entry);
  }
}

export function clearModelRegistry() {
  modelRegistry.splice(0, modelRegistry.length, ...DEFAULT_MODEL_CATALOG);
}

export function getProviderDefaultCapabilities(
  providerId: EndpointConfig["providerId"],
): ModelCapabilities {
  const defaults = PROVIDER_DEFAULTS[providerId] || DEFAULT_CAPABILITIES;
  return { ...defaults };
}

export function getModelCandidates(
  endpoint: EndpointConfig,
): ModelCatalogEntry[] {
  const providerCandidates = modelRegistry.filter(
    (item) => item.providerId === endpoint.providerId,
  );
  return [...providerCandidates].sort(
    (a, b) => (b.priority || 0) - (a.priority || 0),
  );
}
