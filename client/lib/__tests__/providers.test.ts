import {
  getProviders,
  getProviderConfig,
  formatAuthHeaderLabel,
  buildAuthHeaders,
  normalizeBaseUrl,
  resolveBaseUrl,
  fetchProviderModels,
  ProviderId,
} from "../providers";

describe("providers", () => {
  describe("getProviders", () => {
    it("returns array of provider configs", () => {
      const providers = getProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);
    });

    it("includes all expected providers", () => {
      const providers = getProviders();
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("openai");
      expect(ids).toContain("anthropic");
      expect(ids).toContain("together");
      expect(ids).toContain("mistral");
      expect(ids).toContain("perplexity");
      expect(ids).toContain("yandex");
      expect(ids).toContain("replicate");
      expect(ids).toContain("deepseek");
      expect(ids).toContain("groq");
      expect(ids).toContain("dashscope");
      expect(ids).toContain("custom");
    });

    it("returns a copy, not the original array", () => {
      const providers1 = getProviders();
      const providers2 = getProviders();
      expect(providers1).not.toBe(providers2);
    });
  });

  describe("getProviderConfig", () => {
    it("returns correct config for openai", () => {
      const config = getProviderConfig("openai");
      expect(config.id).toBe("openai");
      expect(config.name).toBe("OpenAI");
      expect(config.baseUrl).toBe("https://api.openai.com/v1");
      expect(config.authHeader).toBe("Authorization");
      expect(config.authFormat).toBe("Bearer <KEY>");
    });

    it("returns correct config for anthropic", () => {
      const config = getProviderConfig("anthropic");
      expect(config.id).toBe("anthropic");
      expect(config.authHeader).toBe("x-api-key");
      expect(config.authFormat).toBe("<KEY>");
    });

    it("returns correct config for yandex", () => {
      const config = getProviderConfig("yandex");
      expect(config.authFormat).toBe("Api-Key <KEY>");
    });

    it("returns correct config for replicate", () => {
      const config = getProviderConfig("replicate");
      expect(config.authFormat).toBe("Token <KEY>");
    });

    it("returns first provider for unknown id", () => {
      const config = getProviderConfig("unknown" as ProviderId);
      expect(config.id).toBe("openai");
    });

    it("returns custom provider with empty baseUrl", () => {
      const config = getProviderConfig("custom");
      expect(config.baseUrl).toBe("");
    });
  });

  describe("formatAuthHeaderLabel", () => {
    it("formats openai header correctly", () => {
      const label = formatAuthHeaderLabel("openai");
      expect(label).toBe("Authorization: Bearer <KEY>");
    });

    it("formats anthropic header correctly", () => {
      const label = formatAuthHeaderLabel("anthropic");
      expect(label).toBe("x-api-key: <KEY>");
    });

    it("formats yandex header correctly", () => {
      const label = formatAuthHeaderLabel("yandex");
      expect(label).toBe("Authorization: Api-Key <KEY>");
    });
  });

  describe("buildAuthHeaders", () => {
    it("builds correct headers for openai", () => {
      const headers = buildAuthHeaders("openai", "test-key");
      expect(headers).toEqual({
        Authorization: "Bearer test-key",
      });
    });

    it("builds correct headers for anthropic", () => {
      const headers = buildAuthHeaders("anthropic", "test-key");
      expect(headers).toEqual({
        "x-api-key": "test-key",
      });
    });

    it("builds correct headers for yandex", () => {
      const headers = buildAuthHeaders("yandex", "test-key");
      expect(headers).toEqual({
        Authorization: "Api-Key test-key",
      });
    });

    it("builds correct headers for replicate", () => {
      const headers = buildAuthHeaders("replicate", "test-key");
      expect(headers).toEqual({
        Authorization: "Token test-key",
      });
    });

    it("returns empty object for empty api key", () => {
      const headers = buildAuthHeaders("openai", "");
      expect(headers).toEqual({});
    });
  });

  describe("normalizeBaseUrl", () => {
    it("returns empty string for empty input", () => {
      expect(normalizeBaseUrl("")).toBe("");
      expect(normalizeBaseUrl("   ")).toBe("");
    });

    it("adds https protocol if missing", () => {
      expect(normalizeBaseUrl("api.example.com")).toBe(
        "https://api.example.com",
      );
    });

    it("preserves http protocol", () => {
      expect(normalizeBaseUrl("http://localhost:3000")).toBe(
        "http://localhost:3000",
      );
    });

    it("preserves https protocol", () => {
      expect(normalizeBaseUrl("https://api.example.com")).toBe(
        "https://api.example.com",
      );
    });

    it("removes trailing slashes", () => {
      expect(normalizeBaseUrl("https://api.example.com/")).toBe(
        "https://api.example.com",
      );
      expect(normalizeBaseUrl("https://api.example.com///")).toBe(
        "https://api.example.com",
      );
    });

    it("appends /v1 when option is set and not present", () => {
      expect(
        normalizeBaseUrl("https://api.example.com", { appendV1: true }),
      ).toBe("https://api.example.com/v1");
    });

    it("does not append /v1 if already present", () => {
      expect(
        normalizeBaseUrl("https://api.example.com/v1", { appendV1: true }),
      ).toBe("https://api.example.com/v1");
    });

    it("does not append /v1 when option is false", () => {
      expect(
        normalizeBaseUrl("https://api.example.com", { appendV1: false }),
      ).toBe("https://api.example.com");
    });

    it("trims whitespace", () => {
      expect(normalizeBaseUrl("  https://api.example.com  ")).toBe(
        "https://api.example.com",
      );
    });
  });

  describe("resolveBaseUrl", () => {
    it("returns provider baseUrl for non-custom providers", () => {
      expect(resolveBaseUrl("openai", "ignored")).toBe(
        "https://api.openai.com/v1",
      );
      expect(resolveBaseUrl("anthropic", "ignored")).toBe(
        "https://api.anthropic.com/v1",
      );
    });

    it("returns custom baseUrl for custom provider", () => {
      expect(resolveBaseUrl("custom", "https://my-server.com")).toBe(
        "https://my-server.com/v1",
      );
    });

    it("adds /v1 to custom provider url if missing", () => {
      expect(resolveBaseUrl("custom", "https://my-server.com")).toBe(
        "https://my-server.com/v1",
      );
    });

    it("does not duplicate /v1 for custom provider", () => {
      expect(resolveBaseUrl("custom", "https://my-server.com/v1")).toBe(
        "https://my-server.com/v1",
      );
    });
  });

  describe("fetchProviderModels", () => {
    beforeEach(() => {
      (global.fetch as jest.Mock).mockReset();
    });

    it("returns error for missing base URL", async () => {
      const result = await fetchProviderModels({
        providerId: "custom",
        baseUrl: "",
        apiKey: "test",
      });
      expect(result.error).toBe("Base URL is missing.");
      expect(result.models).toEqual([]);
    });

    it("returns fallback models for perplexity without API call", async () => {
      const result = await fetchProviderModels({
        providerId: "perplexity",
        baseUrl: "https://api.perplexity.ai",
        apiKey: "test",
      });
      expect(result.models).toContain("sonar");
      expect(result.models).toContain("sonar-pro");
      expect(result.message).toContain("Perplexity");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("makes ping request to anthropic and returns fallback models on success", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await fetchProviderModels({
        providerId: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "test",
        currentModel: "claude-3-opus-20240229",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(result.models).toContain("claude-3-5-sonnet-20240620");
      expect(result.message).toContain("Anthropic");
    });

    it("returns error for failed anthropic ping", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("Invalid API key"),
      });

      const result = await fetchProviderModels({
        providerId: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "bad-key",
      });

      expect(result.error).toBe("Invalid API key");
      expect(result.models).toEqual([]);
    });

    it("fetches models from /models endpoint for openai-like providers", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "gpt-4" }, { id: "gpt-3.5-turbo" }],
          }),
      });

      const result = await fetchProviderModels({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/models",
        expect.objectContaining({
          method: "GET",
        }),
      );
      expect(result.models).toContain("gpt-4");
      expect(result.models).toContain("gpt-3.5-turbo");
    });

    it("extracts models from various response formats", async () => {
      // Test with 'models' array
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [{ id: "model1" }, { id: "model2" }],
          }),
      });

      let result = await fetchProviderModels({
        providerId: "together",
        baseUrl: "https://api.together.ai/v1",
        apiKey: "test",
      });
      expect(result.models).toContain("model1");

      // Test with 'results' array
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ name: "model3" }],
          }),
      });

      result = await fetchProviderModels({
        providerId: "together",
        baseUrl: "https://api.together.ai/v1",
        apiKey: "test",
      });
      expect(result.models).toContain("model3");

      // Test with owner/name format (replicate style)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ owner: "meta", name: "llama-2" }],
          }),
      });

      result = await fetchProviderModels({
        providerId: "together",
        baseUrl: "https://api.together.ai/v1",
        apiKey: "test",
      });
      expect(result.models).toContain("meta/llama-2");
    });

    it("returns error when no models found", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const result = await fetchProviderModels({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test",
      });

      expect(result.error).toBe("No models found. Enter a model manually.");
    });

    it("handles network errors", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const result = await fetchProviderModels({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test",
      });

      expect(result.error).toBe("Failed to load models: Network error");
    });

    it("handles API error responses", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Server error"),
      });

      const result = await fetchProviderModels({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test",
      });

      expect(result.error).toBe("Server error");
    });

    it("deduplicates model ids", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "gpt-4" }, { id: "gpt-4" }, { id: "gpt-3.5-turbo" }],
          }),
      });

      const result = await fetchProviderModels({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test",
      });

      const gpt4Count = result.models.filter((m) => m === "gpt-4").length;
      expect(gpt4Count).toBe(1);
    });

    it("extracts model from 'model' field", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ model: "custom-model" }],
          }),
      });

      const result = await fetchProviderModels({
        providerId: "together",
        baseUrl: "https://api.together.ai/v1",
        apiKey: "test",
      });

      expect(result.models).toContain("custom-model");
    });

    it("handles string array in response", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(["model1", "model2"]),
      });

      const result = await fetchProviderModels({
        providerId: "together",
        baseUrl: "https://api.together.ai/v1",
        apiKey: "test",
      });

      expect(result.models).toContain("model1");
      expect(result.models).toContain("model2");
    });

    it("filters out invalid model entries", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { id: "valid-model" },
              { invalid: "no id field" },
              null,
              undefined,
              { foo: "bar" },
            ],
          }),
      });

      const result = await fetchProviderModels({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test",
      });

      expect(result.models).toContain("valid-model");
      expect(result.models).toHaveLength(1);
    });

    it("handles JSON parse error in response", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      const result = await fetchProviderModels({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test",
      });

      expect(result.error).toContain("Failed to load models");
    });
  });
});
