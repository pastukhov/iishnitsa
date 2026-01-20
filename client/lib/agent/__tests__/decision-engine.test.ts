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

  it("disables tools when MCP is off", () => {
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
});
