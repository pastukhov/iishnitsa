import { EndpointConfig } from "@/lib/store";
import {
  ModelCapabilities,
  ModelCatalogEntry,
  ModelTier,
} from "@/lib/agent/types";

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsVision: false,
  supportsTools: true,
  supportsAudio: false,
  supportsStreaming: true,
};

// Default models for each provider (used as fallback in auto mode)
const PROVIDER_DEFAULT_MODELS: Partial<
  Record<EndpointConfig["providerId"], string>
> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  together: "meta-llama/Llama-3.1-8B-Instruct-Turbo",
  mistral: "mistral-small-latest",
  groq: "llama-3.1-8b-instant",
  deepseek: "deepseek-chat",
  perplexity: "sonar",
  dashscope: "qwen-turbo",
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

// Model tier patterns for known providers
// Each pattern maps a regex to a tier level
const MODEL_TIER_PATTERNS: Record<
  string,
  { pattern: RegExp; tier: ModelTier }[]
> = {
  openai: [
    // Premium tier
    { pattern: /gpt-4o(?!-mini)/i, tier: "premium" },
    { pattern: /gpt-4-turbo/i, tier: "premium" },
    { pattern: /gpt-4-(?!turbo)/i, tier: "premium" },
    { pattern: /o1(?!-mini)/i, tier: "premium" },
    // Standard tier
    { pattern: /gpt-4o-mini/i, tier: "standard" },
    { pattern: /o1-mini/i, tier: "standard" },
    // Cheap tier
    { pattern: /gpt-3\.5/i, tier: "cheap" },
  ],
  anthropic: [
    // Premium tier
    { pattern: /claude-3-opus/i, tier: "premium" },
    { pattern: /claude-3-5-sonnet/i, tier: "premium" },
    { pattern: /claude-3-sonnet/i, tier: "standard" },
    // Standard tier
    { pattern: /claude-3-5-haiku/i, tier: "standard" },
    // Cheap tier
    { pattern: /claude-3-haiku/i, tier: "cheap" },
    { pattern: /claude-instant/i, tier: "cheap" },
  ],
  together: [
    // Premium tier
    { pattern: /llama-3\.1-405b/i, tier: "premium" },
    { pattern: /mixtral-8x22b/i, tier: "premium" },
    // Standard tier
    { pattern: /llama-3\.1-70b/i, tier: "standard" },
    { pattern: /mixtral-8x7b/i, tier: "standard" },
    { pattern: /qwen-72b/i, tier: "standard" },
    // Cheap tier
    { pattern: /llama-3\.1-8b/i, tier: "cheap" },
    { pattern: /mistral-7b/i, tier: "cheap" },
    { pattern: /gemma-7b/i, tier: "cheap" },
  ],
  mistral: [
    // Premium tier
    { pattern: /mistral-large/i, tier: "premium" },
    // Standard tier
    { pattern: /mistral-medium/i, tier: "standard" },
    { pattern: /mixtral/i, tier: "standard" },
    // Cheap tier
    { pattern: /mistral-small/i, tier: "cheap" },
    { pattern: /mistral-tiny/i, tier: "cheap" },
    { pattern: /open-mistral/i, tier: "cheap" },
  ],
  groq: [
    // Standard tier (Groq is generally fast/cheap)
    { pattern: /llama-3\.1-70b/i, tier: "standard" },
    { pattern: /mixtral-8x7b/i, tier: "standard" },
    // Cheap tier
    { pattern: /llama-3\.1-8b/i, tier: "cheap" },
    { pattern: /gemma/i, tier: "cheap" },
  ],
  deepseek: [
    // Premium tier
    { pattern: /deepseek-coder/i, tier: "standard" },
    { pattern: /deepseek-chat/i, tier: "standard" },
    // Cheap tier (DeepSeek is generally affordable)
    { pattern: /deepseek/i, tier: "cheap" },
  ],
  perplexity: [
    // Premium tier
    { pattern: /sonar-pro/i, tier: "premium" },
    // Standard tier
    { pattern: /sonar/i, tier: "standard" },
  ],
};

export function getModelTier(providerId: string, modelName: string): ModelTier {
  const patterns = MODEL_TIER_PATTERNS[providerId];
  if (!patterns) {
    return "standard"; // Default tier for unknown providers
  }

  for (const { pattern, tier } of patterns) {
    if (pattern.test(modelName)) {
      return tier;
    }
  }

  return "standard"; // Default tier for unknown models
}

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

export function getProviderDefaultModel(
  providerId: EndpointConfig["providerId"],
): string | undefined {
  return PROVIDER_DEFAULT_MODELS[providerId];
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
