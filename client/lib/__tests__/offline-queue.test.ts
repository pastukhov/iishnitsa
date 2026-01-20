import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  enqueueChatRequest,
  flushQueuedChatRequests,
  getQueuedChatRequests,
} from "../offline-queue";
import { EndpointConfig, Message } from "../store";

describe("offline-queue", () => {
  const endpoint: EndpointConfig = {
    id: "endpoint",
    name: "Test",
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "key",
    model: "gpt-4",
    systemPrompt: "",
  };

  const messages: Message[] = [
    { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    let storedValue: string | null = null;
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      async () => storedValue,
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (_, value) => {
      storedValue = value as string;
    });
  });

  it("enqueues requests and returns them", async () => {
    await enqueueChatRequest({
      chatId: "chat-1",
      messages,
      endpoint,
      mcpServers: [],
      mcpEnabled: false,
    });

    const stored = await getQueuedChatRequests();
    expect(stored).toHaveLength(1);
    expect(stored[0].payload.chatId).toBe("chat-1");
  });

  it("flushes items and retains failures", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([
        {
          id: "q1",
          createdAt: Date.now(),
          attempts: 0,
          payload: {
            chatId: "chat-1",
            messages,
            endpoint,
            mcpServers: [],
            mcpEnabled: false,
          },
        },
        {
          id: "q2",
          createdAt: Date.now(),
          attempts: 0,
          payload: {
            chatId: "chat-2",
            messages,
            endpoint,
            mcpServers: [],
            mcpEnabled: false,
          },
        },
      ]),
    );

    const handler = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Offline"));

    const result = await flushQueuedChatRequests({ handler });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
  });
});
