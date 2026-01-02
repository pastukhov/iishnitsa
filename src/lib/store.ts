import { create } from "zustand";
import { ProviderId } from "./providers";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: any;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface MCPServerCollection {
  id: string;
  name: string;
  servers: MCPServer[];
}

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  mcpEnabled: boolean;
  mcpServers: MCPServer[];
  mcpCollections: MCPServerCollection[];
  activeMcpCollectionId: string | null;
  providerId: ProviderId;
}

interface AppState {
  chats: Chat[];
  currentChatId: string | null;
  settings: Settings;
  initialized: boolean;

  initialize: () => Promise<void>;
  saveToStore: () => Promise<void>;

  getCurrentChat: () => Chat | null;
  createChat: () => string;
  deleteChat: (id: string) => void;
  selectChat: (id: string) => void;

  addMessage: (
    chatId: string,
    message: Omit<Message, "id" | "timestamp">,
  ) => void;
  updateMessage: (chatId: string, messageId: string, content: string) => void;

  updateSettings: (settings: Partial<Settings>) => void;
  addMCPServer: (server: Omit<MCPServer, "id">) => void;
  updateMCPServer: (id: string, updates: Partial<MCPServer>) => void;
  deleteMCPServer: (id: string) => void;
  addMCPCollection: (name: string, servers?: MCPServer[]) => void;
  updateMCPCollection: (id: string, updates: Partial<MCPServerCollection>) => void;
  deleteMCPCollection: (id: string) => void;
  setActiveMCPCollection: (id: string | null) => void;
  replaceMCPCollections: (
    collections: MCPServerCollection[],
    activeId?: string | null,
  ) => void;
}

const storageKeys = {
  chats: "iishnitsa.chats",
  currentChatId: "iishnitsa.currentChatId",
  settings: "iishnitsa.settings",
};

const hasLocalStorage =
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const loadFromStorage = async <T>(key: string, fallback: T): Promise<T> => {
  if (!hasLocalStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("Failed to read from storage:", error);
    return fallback;
  }
};

const saveToStorage = async (key: string, value: unknown): Promise<void> => {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("Failed to write to storage:", error);
  }
};

const defaultSettings: Settings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  systemPrompt: "You are a helpful AI assistant.",
  mcpEnabled: false,
  mcpServers: [],
  mcpCollections: [],
  activeMcpCollectionId: null,
  providerId: "openai",
};

const ensureCollections = (settings: Settings): Settings => {
  const collections =
    settings.mcpCollections && settings.mcpCollections.length > 0
      ? settings.mcpCollections
      : [
          {
            id: crypto.randomUUID(),
            name: "Default",
            servers: settings.mcpServers || [],
          },
        ];

  const activeCollectionId =
    settings.activeMcpCollectionId &&
    collections.some((c) => c.id === settings.activeMcpCollectionId)
      ? settings.activeMcpCollectionId
      : collections[0]?.id || null;

  const activeCollection = activeCollectionId
    ? collections.find((c) => c.id === activeCollectionId) || null
    : null;

  return {
    ...settings,
    mcpCollections: collections,
    activeMcpCollectionId: activeCollectionId,
    mcpServers: activeCollection ? activeCollection.servers : settings.mcpServers,
  };
};

const updateActiveCollectionServers = (
  settings: Settings,
  servers: MCPServer[],
): Settings => {
  if (!settings.activeMcpCollectionId) {
    return { ...settings, mcpServers: servers };
  }

  return {
    ...settings,
    mcpServers: servers,
    mcpCollections: settings.mcpCollections.map((collection) =>
      collection.id === settings.activeMcpCollectionId
        ? { ...collection, servers }
        : collection,
    ),
  };
};

export const useStore = create<AppState>((set, get) => ({
  chats: [],
  currentChatId: null,
  settings: defaultSettings,
  initialized: false,

  initialize: async () => {
    try {
      const chats = await loadFromStorage<Chat[]>(storageKeys.chats, []);
      const currentChatId = await loadFromStorage<string | null>(
        storageKeys.currentChatId,
        null,
      );
      const settings = await loadFromStorage<Settings | null>(
        storageKeys.settings,
        null,
      );

      const mergedSettings = settings
        ? { ...defaultSettings, ...settings }
        : defaultSettings;

      set({
        chats: chats || [],
        currentChatId: currentChatId || null,
        settings: ensureCollections(mergedSettings),
        initialized: true,
      });
    } catch (error) {
      console.error("Failed to initialize store:", error);
      set({ initialized: true });
    }
  },

  saveToStore: async () => {
    const { chats, currentChatId, settings } = get();
    await saveToStorage(storageKeys.chats, chats);
    await saveToStorage(storageKeys.currentChatId, currentChatId);
    await saveToStorage(storageKeys.settings, settings);
  },

  getCurrentChat: () => {
    const { chats, currentChatId } = get();
    return chats.find((c) => c.id === currentChatId) || null;
  },

  createChat: () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const newChat: Chat = {
      id,
      title: "New Chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      chats: [newChat, ...state.chats],
      currentChatId: id,
    }));

    get().saveToStore();
    return id;
  },

  deleteChat: (id: string) => {
    set((state) => {
      const newChats = state.chats.filter((c) => c.id !== id);
      const newCurrentId =
        state.currentChatId === id
          ? newChats[0]?.id || null
          : state.currentChatId;
      return { chats: newChats, currentChatId: newCurrentId };
    });
    get().saveToStore();
  },

  selectChat: (id: string) => {
    set({ currentChatId: id });
    get().saveToStore();
  },

  addMessage: (chatId: string, message: Omit<Message, "id" | "timestamp">) => {
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const fullMessage: Message = { ...message, id, timestamp };

    set((state) => ({
      chats: state.chats.map((chat) => {
        if (chat.id !== chatId) return chat;
        const title =
          chat.messages.length === 0 && message.role === "user"
            ? message.content.slice(0, 30) +
              (message.content.length > 30 ? "..." : "")
            : chat.title;
        return {
          ...chat,
          title,
          messages: [...chat.messages, fullMessage],
          updatedAt: timestamp,
        };
      }),
    }));
    get().saveToStore();
  },

  updateMessage: (chatId: string, messageId: string, content: string) => {
    set((state) => ({
      chats: state.chats.map((chat) => {
        if (chat.id !== chatId) return chat;
        return {
          ...chat,
          messages: chat.messages.map((m) =>
            m.id === messageId ? { ...m, content } : m,
          ),
          updatedAt: Date.now(),
        };
      }),
    }));
    get().saveToStore();
  },

  updateSettings: (newSettings: Partial<Settings>) => {
    set((state) => {
      const updated = { ...state.settings, ...newSettings };
      if (newSettings.mcpServers) {
        return {
          settings: updateActiveCollectionServers(
            updated,
            newSettings.mcpServers,
          ),
        };
      }
      return { settings: updated };
    });
    get().saveToStore();
  },

  addMCPServer: (server: Omit<MCPServer, "id">) => {
    const id = crypto.randomUUID();
    set((state) => ({
      settings: updateActiveCollectionServers(state.settings, [
        ...state.settings.mcpServers,
        { ...server, id },
      ]),
    }));
    get().saveToStore();
  },

  updateMCPServer: (id: string, updates: Partial<MCPServer>) => {
    set((state) => ({
      settings: updateActiveCollectionServers(
        state.settings,
        state.settings.mcpServers.map((s) =>
          s.id === id ? { ...s, ...updates } : s,
        ),
      ),
    }));
    get().saveToStore();
  },

  deleteMCPServer: (id: string) => {
    set((state) => ({
      settings: updateActiveCollectionServers(
        state.settings,
        state.settings.mcpServers.filter((s) => s.id !== id),
      ),
    }));
    get().saveToStore();
  },

  addMCPCollection: (name: string, servers?: MCPServer[]) => {
    const id = crypto.randomUUID();
    set((state) => ({
      settings: {
        ...state.settings,
        mcpCollections: [
          ...state.settings.mcpCollections,
          { id, name, servers: servers || state.settings.mcpServers },
        ],
      },
    }));
    get().saveToStore();
  },

  updateMCPCollection: (id: string, updates: Partial<MCPServerCollection>) => {
    set((state) => ({
      settings: {
        ...state.settings,
        mcpCollections: state.settings.mcpCollections.map((collection) =>
          collection.id === id ? { ...collection, ...updates } : collection,
        ),
      },
    }));
    get().saveToStore();
  },

  deleteMCPCollection: (id: string) => {
    set((state) => {
      const remaining = state.settings.mcpCollections.filter(
        (collection) => collection.id !== id,
      );
      const activeId =
        state.settings.activeMcpCollectionId === id
          ? remaining[0]?.id || null
          : state.settings.activeMcpCollectionId;
      const activeCollection = activeId
        ? remaining.find((collection) => collection.id === activeId) || null
        : null;

      return {
        settings: {
          ...state.settings,
          mcpCollections: remaining,
          activeMcpCollectionId: activeId,
          mcpServers: activeCollection
            ? activeCollection.servers
            : state.settings.mcpServers,
        },
      };
    });
    get().saveToStore();
  },

  setActiveMCPCollection: (id: string | null) => {
    set((state) => {
      const activeCollection = id
        ? state.settings.mcpCollections.find((collection) => collection.id === id) ||
          null
        : null;

      return {
        settings: {
          ...state.settings,
          activeMcpCollectionId: id,
          mcpServers: activeCollection
            ? activeCollection.servers
            : state.settings.mcpServers,
        },
      };
    });
    get().saveToStore();
  },

  replaceMCPCollections: (
    collections: MCPServerCollection[],
    activeId?: string | null,
  ) => {
    set((state) => {
      const resolvedActiveId =
        activeId && collections.some((c) => c.id === activeId)
          ? activeId
          : collections[0]?.id || null;
      const activeCollection = resolvedActiveId
        ? collections.find((c) => c.id === resolvedActiveId) || null
        : null;

      return {
        settings: {
          ...state.settings,
          mcpCollections: collections,
          activeMcpCollectionId: resolvedActiveId,
          mcpServers: activeCollection
            ? activeCollection.servers
            : state.settings.mcpServers,
        },
      };
    });
    get().saveToStore();
  },
}));
