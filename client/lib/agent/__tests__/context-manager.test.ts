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

  const memoryScope = { accountId: "fixture-account", chatId: "fixture-chat" };

  it("injects scoped memory as untrusted user reference after system prompt", async () => {
    const memoryStore = new MemoryStore();
    jest.spyOn(memoryStore, "getRelevantMemories").mockResolvedValueOnce([
      {
        id: "mem1",
        scope: memoryScope,
        provenance: { source: "explicit", sourceId: "explicit:1" },
        type: "fact",
        content: "User prefers concise answers.",
        importance: 0.9,
        ttlMs: 86400000,
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
      memoryScope,
    });

    expect(context[0]).toEqual({ role: "system", content: "System" });
    expect(context[1].role).toBe("user");
    expect(JSON.parse(context[1].content as string)).toEqual({
      type: "untrusted_memory_reference",
      memories: [
        {
          type: "fact",
          content: "User prefers concise answers.",
          provenance: { source: "explicit", sourceId: "explicit:1" },
        },
      ],
    });
    expect(memoryStore.getRelevantMemories).toHaveBeenCalledWith(
      expect.objectContaining({ scope: memoryScope }),
    );
    expect(context[2]).toEqual({ role: "user", content: "Hello" });
  });

  it("does not access memory when no scope is supplied", async () => {
    const memoryStore = new MemoryStore();
    const read = jest
      .spyOn(memoryStore, "getRelevantMemories")
      .mockResolvedValue([]);
    const context = await buildAgentContext({
      messages: [],
      endpoint,
      memoryStore,
    });
    expect(read).not.toHaveBeenCalled();
    expect(context).toEqual([{ role: "system", content: "System" }]);
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
