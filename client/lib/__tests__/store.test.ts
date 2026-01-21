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
      mcpEnabled: false,
      theme: "system",
      memoryEnabled: true,
      memoryAutoSave: true,
      memoryAutoSummary: false,
      memoryLimit: 8,
      memoryMinImportance: 0.5,
      memorySummaryTtlDays: 30,
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

  describe("MCP YAML import/export", () => {
    describe("exportMCPServersYAML", () => {
      it("exports servers as YAML without tokens", () => {
        const { addMCPServer, updateMCPServer, exportMCPServersYAML } =
          useChatStore.getState();

        act(() => {
          addMCPServer({
            name: "Server 1",
            url: "http://s1.com",
            enabled: true,
            token: "secret-token",
          });
        });

        const yaml = useChatStore.getState().exportMCPServersYAML();

        expect(yaml).toContain("servers:");
        expect(yaml).toContain("name: Server 1");
        expect(yaml).toContain("url: http://s1.com");
        expect(yaml).toContain("enabled: true");
        expect(yaml).not.toContain("secret-token");
        expect(yaml).not.toContain("token:");
        expect(yaml).not.toContain("id:");
      });

      it("exports empty servers list", () => {
        const yaml = useChatStore.getState().exportMCPServersYAML();
        expect(yaml).toContain("servers:");
      });

      it("exports multiple servers", () => {
        const { addMCPServer, exportMCPServersYAML } = useChatStore.getState();

        act(() => {
          addMCPServer({
            name: "Server 1",
            url: "http://s1.com",
            enabled: true,
          });
          addMCPServer({
            name: "Server 2",
            url: "http://s2.com",
            enabled: false,
          });
        });

        const yaml = useChatStore.getState().exportMCPServersYAML();

        expect(yaml).toContain("Server 1");
        expect(yaml).toContain("Server 2");
        expect(yaml).toContain("http://s1.com");
        expect(yaml).toContain("http://s2.com");
      });
    });

    describe("importMCPServersYAML", () => {
      it("imports servers from YAML", () => {
        const { importMCPServersYAML } = useChatStore.getState();
        const yaml = `servers:
  - name: Imported Server
    url: http://imported.com
    enabled: true`;

        act(() => {
          importMCPServersYAML(yaml);
        });

        const servers = useChatStore.getState().settings.mcpServers;
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe("Imported Server");
        expect(servers[0].url).toBe("http://imported.com");
        expect(servers[0].enabled).toBe(true);
        expect(servers[0].id).toBeDefined();
      });

      it("replaces existing servers on import", () => {
        const { addMCPServer, importMCPServersYAML } = useChatStore.getState();

        act(() => {
          addMCPServer({
            name: "Old Server",
            url: "http://old.com",
            enabled: true,
          });
        });

        const yaml = `servers:
  - name: New Server
    url: http://new.com`;

        act(() => {
          importMCPServersYAML(yaml);
        });

        const servers = useChatStore.getState().settings.mcpServers;
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe("New Server");
      });

      it("defaults enabled to true if not specified", () => {
        const { importMCPServersYAML } = useChatStore.getState();
        const yaml = `servers:
  - name: Server
    url: http://test.com`;

        act(() => {
          importMCPServersYAML(yaml);
        });

        expect(useChatStore.getState().settings.mcpServers[0].enabled).toBe(
          true,
        );
      });

      it("preserves existing id if provided", () => {
        const { importMCPServersYAML } = useChatStore.getState();
        const yaml = `servers:
  - id: custom-id
    name: Server
    url: http://test.com`;

        act(() => {
          importMCPServersYAML(yaml);
        });

        expect(useChatStore.getState().settings.mcpServers[0].id).toBe(
          "custom-id",
        );
      });

      it("throws error for invalid YAML format", () => {
        const { importMCPServersYAML } = useChatStore.getState();

        expect(() => {
          importMCPServersYAML("name: just a name");
        }).toThrow("Invalid YAML: expected { servers: [...] }");
      });

      it("throws error when servers is not an array", () => {
        const { importMCPServersYAML } = useChatStore.getState();

        expect(() => {
          importMCPServersYAML("servers: not-an-array");
        }).toThrow("Invalid YAML: expected { servers: [...] }");
      });

      it("persists to AsyncStorage", () => {
        const { importMCPServersYAML } = useChatStore.getState();
        const yaml = `servers:
  - name: Server
    url: http://test.com`;

        act(() => {
          importMCPServersYAML(yaml);
        });

        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
          "@ai_agent_settings",
          expect.stringContaining("mcpServers"),
        );
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

    it("migrates legacy settings with collections", async () => {
      const mockSettings = {
        mcpServers: [
          { id: "s1", name: "Server", url: "http://test.com", enabled: true },
        ],
        mcpCollections: [{ id: "col1", name: "Old Collection", servers: [] }],
        activeMcpCollectionId: "col1",
      };

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === "@ai_agent_settings")
          return Promise.resolve(JSON.stringify(mockSettings));
        return Promise.resolve(null);
      });

      await useChatStore.getState().loadFromStorage();

      // Should have servers but no collections (migrated away)
      const settings = useChatStore.getState().settings;
      expect(settings.mcpServers).toHaveLength(1);
      expect(
        (settings as Record<string, unknown>).mcpCollections,
      ).toBeUndefined();
      expect(
        (settings as Record<string, unknown>).activeMcpCollectionId,
      ).toBeUndefined();
    });
  });
});
