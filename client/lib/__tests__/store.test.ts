import AsyncStorage from "@react-native-async-storage/async-storage";
import { useChatStore, Chat, MCPServer } from "../store";

// Simple act replacement for state updates
const act = <T>(fn: () => T): T => {
  return fn();
};

// Helper to reset store state
const resetStore = () => {
  useChatStore.setState({
    chats: [],
    currentChatId: null,
    settings: {
      endpoint: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        systemPrompt: "Test prompt",
        providerId: "openai",
      },
      mcpServers: [],
      mcpCollections: [],
      activeMcpCollectionId: null,
      mcpEnabled: false,
      theme: "system",
    },
    isLoading: false,
    isStreaming: false,
  });
};

describe("useChatStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
  });

  describe("initial state", () => {
    it("has correct default values", () => {
      const state = useChatStore.getState();
      expect(state.chats).toEqual([]);
      expect(state.currentChatId).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isStreaming).toBe(false);
      expect(state.settings.theme).toBe("system");
      expect(state.settings.mcpEnabled).toBe(false);
    });
  });

  describe("createNewChat", () => {
    it("creates a new chat and sets it as current", () => {
      const { createNewChat } = useChatStore.getState();

      act(() => {
        createNewChat();
      });

      const state = useChatStore.getState();
      expect(state.chats).toHaveLength(1);
      expect(state.currentChatId).toBe(state.chats[0].id);
      expect(state.chats[0].title).toBe("New Chat");
      expect(state.chats[0].messages).toEqual([]);
    });

    it("adds new chat to the beginning of chats array", () => {
      const { createNewChat } = useChatStore.getState();

      act(() => {
        createNewChat();
        createNewChat();
      });

      const state = useChatStore.getState();
      expect(state.chats).toHaveLength(2);
      expect(state.currentChatId).toBe(state.chats[0].id);
    });

    it("persists to AsyncStorage", () => {
      const { createNewChat } = useChatStore.getState();

      act(() => {
        createNewChat();
      });

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "@ai_agent_chats",
        expect.any(String),
      );
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "@ai_agent_current_chat",
        expect.any(String),
      );
    });
  });

  describe("selectChat", () => {
    it("changes current chat id", () => {
      const { createNewChat, selectChat } = useChatStore.getState();

      act(() => {
        createNewChat();
        createNewChat();
      });

      const chats = useChatStore.getState().chats;
      const secondChatId = chats[1].id;

      act(() => {
        selectChat(secondChatId);
      });

      expect(useChatStore.getState().currentChatId).toBe(secondChatId);
    });

    it("persists selection to AsyncStorage", () => {
      const { createNewChat, selectChat } = useChatStore.getState();

      act(() => {
        createNewChat();
      });

      const chatId = useChatStore.getState().chats[0].id;
      jest.clearAllMocks();

      act(() => {
        selectChat(chatId);
      });

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "@ai_agent_current_chat",
        chatId,
      );
    });
  });

  describe("deleteChat", () => {
    it("removes chat from array", () => {
      const { createNewChat, deleteChat } = useChatStore.getState();

      act(() => {
        createNewChat();
        createNewChat();
      });

      const chats = useChatStore.getState().chats;
      const chatToDelete = chats[1].id;

      act(() => {
        deleteChat(chatToDelete);
      });

      expect(useChatStore.getState().chats).toHaveLength(1);
      expect(
        useChatStore.getState().chats.find((c) => c.id === chatToDelete),
      ).toBeUndefined();
    });

    it("selects next chat when deleting current", () => {
      const { createNewChat, deleteChat, selectChat } = useChatStore.getState();

      act(() => {
        createNewChat();
        createNewChat();
      });

      const chats = useChatStore.getState().chats;
      const currentChat = chats[0].id;
      const otherChat = chats[1].id;

      act(() => {
        deleteChat(currentChat);
      });

      expect(useChatStore.getState().currentChatId).toBe(otherChat);
    });

    it("creates new chat when deleting last chat", () => {
      const { createNewChat, deleteChat } = useChatStore.getState();

      act(() => {
        createNewChat();
      });

      const chatId = useChatStore.getState().chats[0].id;

      act(() => {
        deleteChat(chatId);
      });

      expect(useChatStore.getState().chats).toHaveLength(1);
      expect(useChatStore.getState().currentChatId).not.toBe(chatId);
    });
  });

  describe("addMessage", () => {
    it("adds message to current chat", () => {
      const { createNewChat, addMessage } = useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "Hello" });
      });

      const chat = useChatStore.getState().chats[0];
      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(chat.messages[0].content).toBe("Hello");
      expect(chat.messages[0].id).toBeDefined();
      expect(chat.messages[0].timestamp).toBeDefined();
    });

    it("updates chat title from first user message", () => {
      const { createNewChat, addMessage } = useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({
          role: "user",
          content: "This is my first message to the assistant",
        });
      });

      const chat = useChatStore.getState().chats[0];
      expect(chat.title).toBe("This is my first message to the assistant");
    });

    it("truncates long messages in title", () => {
      const { createNewChat, addMessage } = useChatStore.getState();
      const longMessage = "A".repeat(100);

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: longMessage });
      });

      const chat = useChatStore.getState().chats[0];
      expect(chat.title.length).toBeLessThanOrEqual(53); // 50 chars + "..."
      expect(chat.title.endsWith("...")).toBe(true);
    });

    it("does not update title from assistant message", () => {
      const { createNewChat, addMessage } = useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "assistant", content: "Hello there" });
      });

      const chat = useChatStore.getState().chats[0];
      expect(chat.title).toBe("New Chat");
    });

    it("does not update title after first message", () => {
      const { createNewChat, addMessage } = useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "First message" });
        addMessage({ role: "user", content: "Second message" });
      });

      const chat = useChatStore.getState().chats[0];
      expect(chat.title).toBe("First message");
    });

    it("does not affect other chats when adding message", () => {
      const { createNewChat, addMessage } = useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "First chat" });
      });

      const firstChatId = useChatStore.getState().chats[0].id;
      const firstChatMsgCount =
        useChatStore.getState().chats[0].messages.length;

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "Second chat message" });
      });

      // First chat should be unchanged
      const firstChat = useChatStore
        .getState()
        .chats.find((c) => c.id === firstChatId);
      expect(firstChat?.messages).toHaveLength(firstChatMsgCount);
    });
  });

  describe("updateLastAssistantMessage", () => {
    it("updates last assistant message content", () => {
      const { createNewChat, addMessage, updateLastAssistantMessage } =
        useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "Hello" });
        addMessage({ role: "assistant", content: "Hi" });
        updateLastAssistantMessage("Hello! How can I help?");
      });

      const chat = useChatStore.getState().chats[0];
      expect(chat.messages[1].content).toBe("Hello! How can I help?");
    });

    it("does not update if last message is not assistant", () => {
      const { createNewChat, addMessage, updateLastAssistantMessage } =
        useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "Hello" });
        updateLastAssistantMessage("Should not appear");
      });

      const chat = useChatStore.getState().chats[0];
      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].content).toBe("Hello");
    });

    it("does not affect other chats", () => {
      const {
        createNewChat,
        addMessage,
        selectChat,
        updateLastAssistantMessage,
      } = useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "User 1" });
        addMessage({ role: "assistant", content: "Assistant 1" });
      });

      const firstChatId = useChatStore.getState().chats[0].id;

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "User 2" });
        addMessage({ role: "assistant", content: "Assistant 2" });
        updateLastAssistantMessage("Updated Assistant 2");
      });

      // First chat should be unchanged
      const firstChat = useChatStore
        .getState()
        .chats.find((c) => c.id === firstChatId);
      expect(firstChat?.messages[1].content).toBe("Assistant 1");
    });
  });

  describe("getCurrentChat", () => {
    it("returns current chat", () => {
      const { createNewChat, getCurrentChat } = useChatStore.getState();

      act(() => {
        createNewChat();
      });

      const chat = useChatStore.getState().getCurrentChat();
      expect(chat).not.toBeNull();
      expect(chat?.id).toBe(useChatStore.getState().currentChatId);
    });

    it("returns null when no current chat", () => {
      const chat = useChatStore.getState().getCurrentChat();
      expect(chat).toBeNull();
    });
  });

  describe("clearCurrentChat", () => {
    it("clears messages from current chat", () => {
      const { createNewChat, addMessage, clearCurrentChat } =
        useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "Hello" });
        addMessage({ role: "assistant", content: "Hi" });
        clearCurrentChat();
      });

      const chat = useChatStore.getState().chats[0];
      expect(chat.messages).toEqual([]);
      expect(chat.title).toBe("New Chat");
    });

    it("does not affect other chats", () => {
      const { createNewChat, addMessage, selectChat, clearCurrentChat } =
        useChatStore.getState();

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "First chat message" });
      });

      const firstChatId = useChatStore.getState().chats[0].id;

      act(() => {
        createNewChat();
        addMessage({ role: "user", content: "Second chat message" });
        clearCurrentChat();
      });

      // First chat should be unchanged
      const firstChat = useChatStore
        .getState()
        .chats.find((c) => c.id === firstChatId);
      expect(firstChat?.messages).toHaveLength(1);
      expect(firstChat?.title).toBe("First chat message");
    });
  });

  describe("updateSettings", () => {
    it("updates settings partially", () => {
      const { updateSettings } = useChatStore.getState();

      act(() => {
        updateSettings({ theme: "dark" });
      });

      expect(useChatStore.getState().settings.theme).toBe("dark");
      expect(useChatStore.getState().settings.mcpEnabled).toBe(false); // unchanged
    });

    it("persists to AsyncStorage", () => {
      const { updateSettings } = useChatStore.getState();

      act(() => {
        updateSettings({ mcpEnabled: true });
      });

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "@ai_agent_settings",
        expect.stringContaining("mcpEnabled"),
      );
    });
  });

  describe("updateEndpoint", () => {
    it("updates endpoint config partially", () => {
      const { updateEndpoint } = useChatStore.getState();

      act(() => {
        updateEndpoint({ model: "gpt-4" });
      });

      expect(useChatStore.getState().settings.endpoint.model).toBe("gpt-4");
      expect(useChatStore.getState().settings.endpoint.providerId).toBe(
        "openai",
      ); // unchanged
    });

    it("updates provider and baseUrl together", () => {
      const { updateEndpoint } = useChatStore.getState();

      act(() => {
        updateEndpoint({
          providerId: "anthropic",
          baseUrl: "https://api.anthropic.com/v1",
          model: "claude-3-opus",
        });
      });

      const endpoint = useChatStore.getState().settings.endpoint;
      expect(endpoint.providerId).toBe("anthropic");
      expect(endpoint.baseUrl).toBe("https://api.anthropic.com/v1");
      expect(endpoint.model).toBe("claude-3-opus");
    });
  });

  describe("setIsStreaming", () => {
    it("sets streaming state", () => {
      const { setIsStreaming } = useChatStore.getState();

      act(() => {
        setIsStreaming(true);
      });

      expect(useChatStore.getState().isStreaming).toBe(true);

      act(() => {
        setIsStreaming(false);
      });

      expect(useChatStore.getState().isStreaming).toBe(false);
    });
  });

  describe("MCP Server management", () => {
    describe("addMCPServer", () => {
      it("adds new MCP server", () => {
        const { addMCPServer } = useChatStore.getState();

        act(() => {
          addMCPServer({
            name: "Test Server",
            url: "http://localhost:3000",
            enabled: true,
          });
        });

        const servers = useChatStore.getState().settings.mcpServers;
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe("Test Server");
        expect(servers[0].url).toBe("http://localhost:3000");
        expect(servers[0].enabled).toBe(true);
        expect(servers[0].id).toBeDefined();
      });
    });

    describe("updateMCPServer", () => {
      it("updates existing server", () => {
        const { addMCPServer, updateMCPServer } = useChatStore.getState();

        act(() => {
          addMCPServer({ name: "Test", url: "http://test.com", enabled: true });
        });

        const serverId = useChatStore.getState().settings.mcpServers[0].id;

        act(() => {
          updateMCPServer(serverId, { name: "Updated" });
        });

        expect(useChatStore.getState().settings.mcpServers[0].name).toBe(
          "Updated",
        );
      });
    });

    describe("removeMCPServer", () => {
      it("removes server by id", () => {
        const { addMCPServer, removeMCPServer } = useChatStore.getState();

        act(() => {
          addMCPServer({ name: "Test", url: "http://test.com", enabled: true });
        });

        const serverId = useChatStore.getState().settings.mcpServers[0].id;

        act(() => {
          removeMCPServer(serverId);
        });

        expect(useChatStore.getState().settings.mcpServers).toHaveLength(0);
      });
    });

    describe("toggleMCPServer", () => {
      it("toggles server enabled state", () => {
        const { addMCPServer, toggleMCPServer } = useChatStore.getState();

        act(() => {
          addMCPServer({ name: "Test", url: "http://test.com", enabled: true });
        });

        const serverId = useChatStore.getState().settings.mcpServers[0].id;

        act(() => {
          toggleMCPServer(serverId);
        });

        expect(useChatStore.getState().settings.mcpServers[0].enabled).toBe(
          false,
        );

        act(() => {
          toggleMCPServer(serverId);
        });

        expect(useChatStore.getState().settings.mcpServers[0].enabled).toBe(
          true,
        );
      });
    });
  });

  describe("MCP Collection management", () => {
    describe("addMCPCollection", () => {
      it("adds new collection", () => {
        const { addMCPCollection } = useChatStore.getState();

        act(() => {
          addMCPCollection("My Collection");
        });

        const collections = useChatStore.getState().settings.mcpCollections;
        expect(collections).toHaveLength(1);
        expect(collections[0].name).toBe("My Collection");
        expect(collections[0].servers).toEqual([]);
      });

      it("adds collection with servers", () => {
        const { addMCPCollection } = useChatStore.getState();
        const servers: MCPServer[] = [
          { id: "1", name: "Server 1", url: "http://s1.com", enabled: true },
        ];

        act(() => {
          addMCPCollection("With Servers", servers);
        });

        expect(
          useChatStore.getState().settings.mcpCollections[0].servers,
        ).toHaveLength(1);
      });
    });

    describe("updateMCPCollection", () => {
      it("updates collection name", () => {
        const { addMCPCollection, updateMCPCollection } =
          useChatStore.getState();

        act(() => {
          addMCPCollection("Original");
        });

        const collectionId =
          useChatStore.getState().settings.mcpCollections[0].id;

        act(() => {
          updateMCPCollection(collectionId, { name: "Updated" });
        });

        expect(useChatStore.getState().settings.mcpCollections[0].name).toBe(
          "Updated",
        );
      });

      it("updates active collection servers and syncs to mcpServers", () => {
        const {
          addMCPCollection,
          setActiveMCPCollection,
          updateMCPCollection,
        } = useChatStore.getState();

        act(() => {
          addMCPCollection("Test Collection");
        });

        const collectionId =
          useChatStore.getState().settings.mcpCollections[0].id;

        act(() => {
          setActiveMCPCollection(collectionId);
        });

        const newServers: MCPServer[] = [
          { id: "1", name: "New Server", url: "http://new.com", enabled: true },
        ];

        act(() => {
          updateMCPCollection(collectionId, { servers: newServers });
        });

        expect(useChatStore.getState().settings.mcpServers).toHaveLength(1);
        expect(useChatStore.getState().settings.mcpServers[0].name).toBe(
          "New Server",
        );
      });
    });

    describe("deleteMCPCollection", () => {
      it("removes collection", () => {
        const { addMCPCollection, deleteMCPCollection } =
          useChatStore.getState();

        act(() => {
          addMCPCollection("To Delete");
        });

        const collectionId =
          useChatStore.getState().settings.mcpCollections[0].id;

        act(() => {
          deleteMCPCollection(collectionId);
        });

        expect(useChatStore.getState().settings.mcpCollections).toHaveLength(0);
      });

      it("switches active collection when deleting active", () => {
        const {
          addMCPCollection,
          setActiveMCPCollection,
          deleteMCPCollection,
        } = useChatStore.getState();

        act(() => {
          addMCPCollection("Collection 1");
          addMCPCollection("Collection 2");
        });

        const collections = useChatStore.getState().settings.mcpCollections;

        act(() => {
          setActiveMCPCollection(collections[0].id);
          deleteMCPCollection(collections[0].id);
        });

        expect(useChatStore.getState().settings.activeMcpCollectionId).toBe(
          collections[1].id,
        );
      });
    });

    describe("setActiveMCPCollection", () => {
      it("sets active collection and syncs servers", () => {
        const { addMCPCollection, setActiveMCPCollection } =
          useChatStore.getState();
        const servers: MCPServer[] = [
          { id: "1", name: "Server 1", url: "http://s1.com", enabled: true },
        ];

        act(() => {
          addMCPCollection("With Servers", servers);
        });

        const collectionId =
          useChatStore.getState().settings.mcpCollections[0].id;

        act(() => {
          setActiveMCPCollection(collectionId);
        });

        expect(useChatStore.getState().settings.activeMcpCollectionId).toBe(
          collectionId,
        );
        expect(useChatStore.getState().settings.mcpServers).toHaveLength(1);
      });

      it("clears servers when setting null", () => {
        const { addMCPCollection, setActiveMCPCollection, addMCPServer } =
          useChatStore.getState();

        act(() => {
          addMCPCollection("Test");
          setActiveMCPCollection(
            useChatStore.getState().settings.mcpCollections[0].id,
          );
          addMCPServer({
            name: "Server",
            url: "http://test.com",
            enabled: true,
          });
          setActiveMCPCollection(null);
        });

        expect(
          useChatStore.getState().settings.activeMcpCollectionId,
        ).toBeNull();
      });
    });
  });

  describe("loadFromStorage", () => {
    it("loads chats from AsyncStorage", async () => {
      const mockChats: Chat[] = [
        {
          id: "chat1",
          title: "Saved Chat",
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === "@ai_agent_chats")
          return Promise.resolve(JSON.stringify(mockChats));
        if (key === "@ai_agent_current_chat") return Promise.resolve("chat1");
        return Promise.resolve(null);
      });

      await useChatStore.getState().loadFromStorage();

      expect(useChatStore.getState().chats).toHaveLength(1);
      expect(useChatStore.getState().currentChatId).toBe("chat1");
    });

    it("creates new chat if no saved chats", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

      await useChatStore.getState().loadFromStorage();

      expect(useChatStore.getState().chats).toHaveLength(1);
    });

    it("loads settings from AsyncStorage", async () => {
      const mockSettings = {
        theme: "dark",
        mcpEnabled: true,
        endpoint: {
          model: "gpt-4",
        },
      };

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === "@ai_agent_settings")
          return Promise.resolve(JSON.stringify(mockSettings));
        return Promise.resolve(null);
      });

      await useChatStore.getState().loadFromStorage();

      expect(useChatStore.getState().settings.theme).toBe("dark");
      expect(useChatStore.getState().settings.mcpEnabled).toBe(true);
      expect(useChatStore.getState().settings.endpoint.model).toBe("gpt-4");
    });

    it("handles storage errors gracefully", async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
        new Error("Storage error"),
      );

      await useChatStore.getState().loadFromStorage();

      // Should create a new chat as fallback
      expect(useChatStore.getState().chats.length).toBeGreaterThanOrEqual(1);
    });

    it("selects first chat if current chat id is invalid", async () => {
      const mockChats: Chat[] = [
        {
          id: "chat1",
          title: "Chat 1",
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === "@ai_agent_chats")
          return Promise.resolve(JSON.stringify(mockChats));
        if (key === "@ai_agent_current_chat")
          return Promise.resolve("invalid-id");
        return Promise.resolve(null);
      });

      await useChatStore.getState().loadFromStorage();

      expect(useChatStore.getState().currentChatId).toBe("chat1");
    });

    it("ensures collections are created from legacy settings", async () => {
      const mockSettings = {
        mcpServers: [
          { id: "s1", name: "Server", url: "http://test.com", enabled: true },
        ],
        mcpCollections: [],
      };

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === "@ai_agent_settings")
          return Promise.resolve(JSON.stringify(mockSettings));
        return Promise.resolve(null);
      });

      await useChatStore.getState().loadFromStorage();

      // Should create default collection with existing servers
      expect(useChatStore.getState().settings.mcpCollections).toHaveLength(1);
      expect(useChatStore.getState().settings.mcpCollections[0].name).toBe(
        "Default",
      );
    });

    it("resets invalid activeMcpCollectionId to first collection", async () => {
      const mockSettings = {
        mcpCollections: [{ id: "col1", name: "Collection 1", servers: [] }],
        activeMcpCollectionId: "non-existent-id",
      };

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === "@ai_agent_settings")
          return Promise.resolve(JSON.stringify(mockSettings));
        return Promise.resolve(null);
      });

      await useChatStore.getState().loadFromStorage();

      // Should reset to first collection
      expect(useChatStore.getState().settings.activeMcpCollectionId).toBe(
        "col1",
      );
    });

    it("handles settings with valid activeMcpCollectionId", async () => {
      const mockSettings = {
        mcpCollections: [
          { id: "col1", name: "Collection 1", servers: [] },
          { id: "col2", name: "Collection 2", servers: [] },
        ],
        activeMcpCollectionId: "col2",
      };

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === "@ai_agent_settings")
          return Promise.resolve(JSON.stringify(mockSettings));
        return Promise.resolve(null);
      });

      await useChatStore.getState().loadFromStorage();

      // Should keep the valid active collection
      expect(useChatStore.getState().settings.activeMcpCollectionId).toBe(
        "col2",
      );
    });
  });
});
