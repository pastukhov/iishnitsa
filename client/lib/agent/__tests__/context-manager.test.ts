import { buildAgentContext } from "../context-manager";
import { MemoryStore } from "../memory";
import { EndpointConfig, Message } from "@/lib/store";
import * as imageUtils from "@/lib/image-utils";

jest.mock("@/lib/image-utils", () => ({
  getImageDataUrl: jest.fn(),
}));

describe("buildAgentContext", () => {
  const endpoint: EndpointConfig = {
    baseUrl: "https://api.example.com",
    apiKey: "key",
    model: "model",
    systemPrompt: "System",
    providerId: "custom",
  };

  it("injects memory context after system prompt", async () => {
    const memoryStore = new MemoryStore();
    jest.spyOn(memoryStore, "getRelevantMemories").mockResolvedValueOnce([
      {
        id: "mem1",
        type: "fact",
        content: "User prefers concise answers.",
        importance: 0.9,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      },
    ]);

    const messages: Message[] = [
      {
        id: "1",
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      },
    ];

    const context = await buildAgentContext({
      messages,
      endpoint,
      memoryStore,
    });

    expect(context[0]).toEqual({ role: "system", content: "System" });
    expect(context[1].role).toBe("system");
    expect(context[1].content).toContain("Relevant memory:");
    expect(context[2]).toEqual({ role: "user", content: "Hello" });
  });

  it("formats attachments as multimodal content", async () => {
    (imageUtils.getImageDataUrl as jest.Mock).mockResolvedValueOnce(
      "data:image/png;base64,abc",
    );

    const messages: Message[] = [
      {
        id: "1",
        role: "user",
        content: "Look",
        timestamp: Date.now(),
        attachments: [
          {
            id: "img1",
            type: "image",
            uri: "file://image.png",
            mimeType: "image/png",
          },
        ],
      },
    ];

    const context = await buildAgentContext({ messages, endpoint });
    expect(context[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      ],
    });
  });
});
