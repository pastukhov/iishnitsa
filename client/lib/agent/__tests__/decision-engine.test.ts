import { decideAgentAction } from "../decision-engine";
import { registerModel, clearModelRegistry } from "../model-registry";
import { EndpointConfig, Message } from "@/lib/store";

describe("decideAgentAction", () => {
  const endpoint: EndpointConfig = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "key",
    model: "model-default",
    systemPrompt: "system",
    providerId: "custom",
  };

  const autoEndpoint: EndpointConfig = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "key",
    model: "", // empty model triggers auto mode
    systemPrompt: "system",
    providerId: "openai",
  };

  const baseMessages: Message[] = [
    {
      id: "1",
      role: "user",
      content: "Hello",
      timestamp: Date.now(),
    },
  ];

  beforeEach(() => {
    clearModelRegistry();
  });

  it("enables tools even when MCP is off if tools are provided", () => {
    const decision = decideAgentAction({
      endpoint,
      messages: baseMessages,
      tools: [
        {
          type: "function",
          function: {
            name: "tool",
            description: "Tool",
            parameters: {},
          },
        },
      ],
      mcpEnabled: false,
    });

    expect(decision.toolChoice).toBe("auto");
    expect(decision.mode).toBe("tool");
  });

  it("disables tools when no tools are provided", () => {
    const decision = decideAgentAction({
      endpoint,
      messages: baseMessages,
      tools: [],
      mcpEnabled: false,
    });

    expect(decision.toolChoice).toBe("none");
    expect(decision.mode).toBe("chat");
  });

  it("uses tools when available and supported", () => {
    const decision = decideAgentAction({
      endpoint,
      messages: baseMessages,
      tools: [
        {
          type: "function",
          function: {
            name: "tool",
            description: "Tool",
            parameters: {},
          },
        },
      ],
      mcpEnabled: true,
    });

    expect(decision.toolChoice).toBe("auto");
    expect(decision.mode).toBe("tool");
  });

  it("falls back to a vision-capable model when required", () => {
    registerModel({
      providerId: "custom",
      model: "vision-model",
      capabilities: {
        supportsVision: true,
        supportsTools: true,
        supportsAudio: false,
        supportsStreaming: true,
      },
      priority: 10,
    });

    const decision = decideAgentAction({
      endpoint,
      messages: [
        {
          id: "1",
          role: "user",
          content: "Check this",
          timestamp: Date.now(),
          attachments: [
            {
              id: "img",
              type: "image",
              uri: "file://img.png",
              mimeType: "image/png",
            },
          ],
        },
      ],
      tools: [],
      mcpEnabled: false,
    });

    expect(decision.model).toBe("vision-model");
    expect(decision.reason).toBe("fallback_model_selected");
  });

  it("disables tool usage when the selected model lacks tool support", () => {
    registerModel({
      providerId: "custom",
      model: "model-default",
      capabilities: {
        supportsVision: false,
        supportsTools: false,
        supportsAudio: false,
        supportsStreaming: true,
      },
    });

    const decision = decideAgentAction({
      endpoint,
      messages: baseMessages,
      tools: [
        {
          type: "function",
          function: {
            name: "tool",
            description: "Tool",
            parameters: {},
          },
        },
      ],
      mcpEnabled: true,
    });

    expect(decision.toolChoice).toBe("none");
    expect(decision.mode).toBe("chat");
  });

  it("falls back when the endpoint model lacks streaming", () => {
    registerModel({
      providerId: "custom",
      model: "model-default",
      capabilities: {
        supportsVision: false,
        supportsTools: true,
        supportsAudio: false,
        supportsStreaming: false,
      },
    });
    registerModel({
      providerId: "custom",
      model: "streaming-model",
      capabilities: {
        supportsVision: false,
        supportsTools: true,
        supportsAudio: false,
        supportsStreaming: true,
      },
      priority: 5,
    });

    const decision = decideAgentAction({
      endpoint,
      messages: baseMessages,
      tools: [],
      mcpEnabled: false,
    });

    expect(decision.model).toBe("streaming-model");
    expect(decision.reason).toBe("fallback_model_selected");
  });

  describe("auto mode", () => {
    beforeEach(() => {
      // Register models with different tiers for openai provider
      registerModel({
        providerId: "openai",
        model: "gpt-3.5-turbo",
        capabilities: {
          supportsVision: false,
          supportsTools: true,
          supportsAudio: false,
          supportsStreaming: true,
          tier: "cheap",
        },
        priority: 1,
      });
      registerModel({
        providerId: "openai",
        model: "gpt-4o-mini",
        capabilities: {
          supportsVision: true,
          supportsTools: true,
          supportsAudio: false,
          supportsStreaming: true,
          tier: "standard",
        },
        priority: 2,
      });
      registerModel({
        providerId: "openai",
        model: "gpt-4o",
        capabilities: {
          supportsVision: true,
          supportsTools: true,
          supportsAudio: true,
          supportsStreaming: true,
          tier: "premium",
        },
        priority: 3,
      });
    });

    it("selects cheap model for simple queries", () => {
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("gpt-3.5-turbo");
      expect(decision.reason).toBe("auto_selected_simple");
    });

    it("selects standard model for moderate queries", () => {
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "user",
            content: "Explain how does React work? What is JSX?",
            timestamp: Date.now(),
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("gpt-4o-mini");
      expect(decision.reason).toBe("auto_selected_moderate");
    });

    it("selects premium model for complex queries with code", () => {
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "user",
            content:
              "Please analyze this code:\n```typescript\nfunction test() { return 1; }\n```",
            timestamp: Date.now(),
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("gpt-4o");
      expect(decision.reason).toBe("auto_selected_complex");
    });

    it("selects premium model for queries with multiple complex patterns", () => {
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "user",
            content: "Analyze and compare different architecture strategies",
            timestamp: Date.now(),
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("gpt-4o");
      expect(decision.reason).toBe("auto_selected_complex");
    });

    it("selects premium model for long messages with complex patterns", () => {
      const longContent =
        "Please analyze this situation. " + "word ".repeat(150);
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "user",
            content: longContent,
            timestamp: Date.now(),
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("gpt-4o");
      expect(decision.reason).toBe("auto_selected_complex");
    });

    it("selects standard model for moderately long messages", () => {
      const moderateContent = "word ".repeat(120);
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "user",
            content: moderateContent,
            timestamp: Date.now(),
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("gpt-4o-mini");
      expect(decision.reason).toBe("auto_selected_moderate");
    });

    it("selects premium model for many questions", () => {
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "user",
            content: "What? Why? How? When?",
            timestamp: Date.now(),
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("gpt-4o");
      expect(decision.reason).toBe("auto_selected_complex");
    });

    it("uses provider default model when no candidates in registry", () => {
      clearModelRegistry();
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: baseMessages,
        tools: [],
        mcpEnabled: false,
      });

      // OpenAI provider has default model gpt-4o-mini
      expect(decision.model).toBe("gpt-4o-mini");
      expect(decision.reason).toBe("auto_default_model");
    });

    it("returns no_models_available for custom provider without default", () => {
      clearModelRegistry();
      const customEndpoint = {
        ...autoEndpoint,
        providerId: "custom" as const,
      };
      const decision = decideAgentAction({
        endpoint: customEndpoint,
        messages: baseMessages,
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("");
      expect(decision.reason).toBe("no_models_available");
    });

    it("falls back to first candidate when no tier match", () => {
      clearModelRegistry();
      registerModel({
        providerId: "openai",
        model: "basic-model",
        capabilities: {
          supportsVision: false,
          supportsTools: true,
          supportsAudio: false,
          supportsStreaming: true,
          tier: "cheap",
        },
        priority: 1,
      });

      // Complex query but only cheap model available
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "user",
            content: "Analyze and debug this complex code architecture",
            timestamp: Date.now(),
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("basic-model");
      expect(decision.reason).toBe("auto_fallback");
    });

    it("handles empty user messages", () => {
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "Hello",
            timestamp: Date.now(),
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      expect(decision.model).toBe("gpt-3.5-turbo");
      expect(decision.reason).toBe("auto_selected_simple");
    });

    it("selects vision-capable model for images in auto mode", () => {
      const decision = decideAgentAction({
        endpoint: autoEndpoint,
        messages: [
          {
            id: "1",
            role: "user",
            content: "What is this?",
            timestamp: Date.now(),
            attachments: [
              {
                id: "img",
                type: "image",
                uri: "file://img.png",
                mimeType: "image/png",
              },
            ],
          },
        ],
        tools: [],
        mcpEnabled: false,
      });

      // Should select a vision-capable model (gpt-4o-mini or gpt-4o)
      expect(decision.capabilities.supportsVision).toBe(true);
    });
  });
});
