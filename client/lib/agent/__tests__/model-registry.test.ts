import {
  registerModel,
  clearModelRegistry,
  getProviderDefaultCapabilities,
  getProviderDefaultModel,
  getModelTier,
  getModelCandidates,
} from "../model-registry";
import { EndpointConfig } from "@/lib/store";

describe("model-registry", () => {
  const endpoint: EndpointConfig = {
    baseUrl: "https://api.example.com",
    apiKey: "key",
    model: "default-model",
    systemPrompt: "system",
    providerId: "custom",
  };

  beforeEach(() => {
    clearModelRegistry();
  });

  it("returns provider defaults with streaming enabled", () => {
    const capabilities = getProviderDefaultCapabilities("custom");
    expect(capabilities.supportsStreaming).toBe(true);
  });

  it("registers and returns candidates in priority order", () => {
    registerModel({
      providerId: "custom",
      model: "low",
      capabilities: {
        supportsVision: false,
        supportsTools: true,
        supportsAudio: false,
        supportsStreaming: true,
      },
      priority: 1,
    });
    registerModel({
      providerId: "custom",
      model: "high",
      capabilities: {
        supportsVision: false,
        supportsTools: true,
        supportsAudio: false,
        supportsStreaming: true,
      },
      priority: 10,
    });

    const candidates = getModelCandidates(endpoint);
    expect(candidates.map((candidate) => candidate.model)).toEqual([
      "high",
      "low",
    ]);
  });

  it("updates an existing model entry", () => {
    registerModel({
      providerId: "custom",
      model: "default-model",
      capabilities: {
        supportsVision: false,
        supportsTools: false,
        supportsAudio: false,
        supportsStreaming: true,
      },
      priority: 1,
    });
    registerModel({
      providerId: "custom",
      model: "default-model",
      capabilities: {
        supportsVision: true,
        supportsTools: true,
        supportsAudio: false,
        supportsStreaming: true,
      },
      priority: 2,
    });

    const candidates = getModelCandidates(endpoint);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].capabilities.supportsVision).toBe(true);
    expect(candidates[0].priority).toBe(2);
  });

  describe("getProviderDefaultModel", () => {
    it("returns default model for openai", () => {
      expect(getProviderDefaultModel("openai")).toBe("gpt-4o-mini");
    });

    it("returns yandex model with folderId as gpt:// URI", () => {
      expect(getProviderDefaultModel("yandex", "b1abc123")).toBe(
        "gpt://b1abc123/yandexgpt-lite/latest",
      );
    });

    it("returns plain yandex model without folderId", () => {
      expect(getProviderDefaultModel("yandex")).toBe("yandexgpt-lite/latest");
    });

    it("returns undefined for unknown provider", () => {
      expect(
        getProviderDefaultModel("custom" as EndpointConfig["providerId"]),
      ).toBeUndefined();
    });
  });

  describe("getModelTier", () => {
    it("returns premium for yandexgpt/", () => {
      expect(getModelTier("yandex", "gpt://folder/yandexgpt/latest")).toBe(
        "premium",
      );
    });

    it("returns cheap for yandexgpt-lite/", () => {
      expect(getModelTier("yandex", "gpt://folder/yandexgpt-lite/latest")).toBe(
        "cheap",
      );
    });

    it("returns standard for unknown model in known provider", () => {
      expect(getModelTier("yandex", "some-unknown-model")).toBe("standard");
    });
  });

  it("clears the registry", () => {
    registerModel({
      providerId: "custom",
      model: "temp",
      capabilities: {
        supportsVision: false,
        supportsTools: true,
        supportsAudio: false,
        supportsStreaming: true,
      },
    });

    clearModelRegistry();
    const candidates = getModelCandidates(endpoint);
    expect(candidates).toHaveLength(0);
  });
});
