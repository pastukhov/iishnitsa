export type ProviderId =
  | "openai"
  | "anthropic"
  | "together"
  | "mistral"
  | "perplexity"
  | "yandex"
  | "replicate"
  | "deepseek"
  | "groq"
  | "dashscope"
  | "custom";

export type ModelListType = "openai" | "anthropic" | "replicate" | "perplexity";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  authHeader: string;
  authFormat: string;
  modelListType: ModelListType;
}

const providers: ProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    modelListType: "openai",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    authHeader: "x-api-key",
    authFormat: "<KEY>",
    modelListType: "anthropic",
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.ai/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    modelListType: "openai",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    modelListType: "openai",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    modelListType: "perplexity",
  },
  {
    id: "yandex",
    name: "Yandex AI Studio",
    baseUrl: "https://api.ai.yandex.net/v1",
    authHeader: "Authorization",
    authFormat: "Api-Key <KEY>",
    modelListType: "openai",
  },
  {
    id: "replicate",
    name: "Replicate",
    baseUrl: "https://api.replicate.com/v1",
    authHeader: "Authorization",
    authFormat: "Token <KEY>",
    modelListType: "replicate",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    modelListType: "openai",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    modelListType: "openai",
  },
  {
    id: "dashscope",
    name: "Alibaba DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    modelListType: "openai",
  },
  {
    id: "custom",
    name: "Custom / Self-hosted",
    baseUrl: "",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    modelListType: "openai",
  },
];

const perplexityFallbackModels = [
  "sonar",
  "sonar-pro",
  "sonar-reasoning",
  "sonar-pro-reasoning",
];

const anthropicFallbackModels = [
  "claude-3-5-sonnet-20240620",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
];

export const getProviders = () => providers.slice();

export const getProviderConfig = (id: ProviderId): ProviderConfig => {
  return providers.find((provider) => provider.id === id) || providers[0];
};

export const formatAuthHeaderLabel = (providerId: ProviderId): string => {
  const provider = getProviderConfig(providerId);
  return `${provider.authHeader}: ${provider.authFormat}`;
};

export const buildAuthHeaders = (
  providerId: ProviderId,
  apiKey: string,
): Record<string, string> => {
  if (!apiKey) return {};
  const provider = getProviderConfig(providerId);
  return {
    [provider.authHeader]: provider.authFormat.replace("<KEY>", apiKey),
  };
};

export const normalizeBaseUrl = (baseUrl: string): string => {
  let url = baseUrl.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, "");
};

const extractModels = (payload: any): string[] => {
  const candidates =
    payload?.data || payload?.models || payload?.results || payload;
  if (!Array.isArray(candidates)) return [];

  const models = candidates
    .map((item) => {
      if (typeof item === "string") return item;
      if (item?.id) return item.id as string;
      if (item?.name && item?.owner) {
        return `${item.owner}/${item.name}`;
      }
      if (item?.name) return item.name as string;
      if (item?.model) return item.model as string;
      return null;
    })
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(models));
};

export const fetchProviderModels = async ({
  providerId,
  baseUrl,
  apiKey,
  currentModel,
}: {
  providerId: ProviderId;
  baseUrl: string;
  apiKey: string;
  currentModel?: string;
}): Promise<{ models: string[]; message?: string; error?: string }> => {
  const provider = getProviderConfig(providerId);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const headers = {
    ...buildAuthHeaders(providerId, apiKey),
    "Content-Type": "application/json",
  };

  try {
    if (!normalizedBaseUrl) {
      return { models: [], error: "Base URL is missing." };
    }

    if (provider.modelListType === "perplexity") {
      return {
        models: perplexityFallbackModels,
        message: "Using built-in Perplexity model list.",
      };
    }

    if (provider.modelListType === "anthropic") {
      const modelToCheck = currentModel || anthropicFallbackModels[0] || "";
      if (!modelToCheck) {
        return {
          models: [],
          error: "No Anthropic model available. Enter a model manually.",
        };
      }

      const response = await fetch(`${normalizedBaseUrl}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelToCheck,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          models: [],
          error:
            errorText ||
            `Anthropic request failed: ${response.status} ${response.statusText}`,
        };
      }

      return {
        models: anthropicFallbackModels,
        message:
          "Anthropic does not expose a model list; showing common models.",
      };
    }

    const response = await fetch(`${normalizedBaseUrl}/models`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        models: [],
        error:
          errorText ||
          `Model request failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    const models = extractModels(data);

    if (models.length === 0) {
      return {
        models: [],
        error: "No models found. Enter a model manually.",
      };
    }

    return { models };
  } catch (error: any) {
    return {
      models: [],
      error: `Failed to load models: ${error.message}`,
    };
  }
};
