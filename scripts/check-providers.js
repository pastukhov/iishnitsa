const providers = [
  {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    check: "models",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    envKey: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com/v1",
    authHeader: "x-api-key",
    authFormat: "<KEY>",
    check: "anthropic",
  },
  {
    id: "together",
    name: "Together AI",
    envKey: "TOGETHER_API_KEY",
    baseUrl: "https://api.together.ai/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    check: "models",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    envKey: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    check: "models",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    envKey: "PERPLEXITY_API_KEY",
    baseUrl: "https://api.perplexity.ai",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    check: "chat",
  },
  {
    id: "yandex",
    name: "Yandex AI Studio",
    envKey: "YANDEX_API_KEY",
    baseUrl: "https://api.ai.yandex.net/v1",
    authHeader: "Authorization",
    authFormat: "Api-Key <KEY>",
    check: "models",
  },
  {
    id: "replicate",
    name: "Replicate",
    envKey: "REPLICATE_API_KEY",
    baseUrl: "https://api.replicate.com/v1",
    authHeader: "Authorization",
    authFormat: "Token <KEY>",
    check: "models",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    check: "models",
  },
  {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    check: "models",
  },
  {
    id: "dashscope",
    name: "Alibaba DashScope",
    envKey: "DASHSCOPE_API_KEY",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1",
    authHeader: "Authorization",
    authFormat: "Bearer <KEY>",
    check: "models",
  },
];

const modelEnvDefaults = {
  anthropic: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
  perplexity: process.env.PERPLEXITY_MODEL || "sonar",
};

const normalizeBaseUrl = (url) => url.replace(/\/+$/, "");

const buildAuthHeaders = (provider, apiKey) => ({
  [provider.authHeader]: provider.authFormat.replace("<KEY>", apiKey),
});

const fetchWithTimeout = async (url, options) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

const checkModels = async (provider, apiKey, baseUrl) => {
  const response = await fetchWithTimeout(`${baseUrl}/models`, {
    method: "GET",
    headers: buildAuthHeaders(provider, apiKey),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      errorText || `HTTP ${response.status} ${response.statusText}`,
    );
  }
};

const checkAnthropic = async (provider, apiKey, baseUrl) => {
  const response = await fetchWithTimeout(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(provider, apiKey),
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelEnvDefaults.anthropic,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      errorText || `HTTP ${response.status} ${response.statusText}`,
    );
  }
};

const checkChat = async (provider, apiKey, baseUrl) => {
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(provider, apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelEnvDefaults.perplexity,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      errorText || `HTTP ${response.status} ${response.statusText}`,
    );
  }
};

const runCheck = async (provider) => {
  if (process.env.MOCK_PROVIDERS === "1") {
    return {
      provider,
      status: "ok",
      message: "Mocked provider check.",
    };
  }

  const apiKey = process.env[provider.envKey];
  if (!apiKey) {
    return { provider, status: "skipped", message: "Missing API key." };
  }

  const baseUrl =
    process.env[`${provider.envKey}_BASE_URL`] || provider.baseUrl;
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  try {
    if (!normalizedBaseUrl) {
      throw new Error("Base URL is empty.");
    }

    if (provider.check === "models") {
      await checkModels(provider, apiKey, normalizedBaseUrl);
    } else if (provider.check === "anthropic") {
      await checkAnthropic(provider, apiKey, normalizedBaseUrl);
    } else {
      await checkChat(provider, apiKey, normalizedBaseUrl);
    }

    return { provider, status: "ok" };
  } catch (error) {
    return {
      provider,
      status: "fail",
      message: error.message || String(error),
    };
  }
};

const main = async () => {
  if (typeof fetch !== "function") {
    console.error("Fetch API is not available in this Node runtime.");
    process.exit(1);
  }

  const results = await Promise.all(providers.map(runCheck));
  const failed = results.filter((result) => result.status === "fail");
  const ran = results.filter((result) => result.status !== "skipped");

  results.forEach((result) => {
    const label = result.provider.name;
    if (result.status === "ok") {
      console.log(`OK  ${label}`);
    } else if (result.status === "skipped") {
      console.log(`SKIP ${label}: ${result.message}`);
    } else {
      console.error(`FAIL ${label}: ${result.message}`);
    }
  });

  if (ran.length === 0) {
    console.log("No providers checked. Set API keys to run checks.");
    process.exit(0);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Provider checks failed:", error.message || error);
  process.exit(1);
});
