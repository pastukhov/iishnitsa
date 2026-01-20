import {
  registerModel,
  clearModelRegistry,
  getProviderDefaultCapabilities,
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
