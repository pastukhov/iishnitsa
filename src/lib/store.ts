import { create } from "zustand";

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

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  mcpEnabled: boolean;
  mcpServers: MCPServer[];
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

      set({
        chats: chats || [],
        currentChatId: currentChatId || null,
        settings: settings
          ? { ...defaultSettings, ...settings }
          : defaultSettings,
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
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    }));
    get().saveToStore();
  },

  addMCPServer: (server: Omit<MCPServer, "id">) => {
    const id = crypto.randomUUID();
    set((state) => ({
      settings: {
        ...state.settings,
        mcpServers: [...state.settings.mcpServers, { ...server, id }],
      },
    }));
    get().saveToStore();
  },

  updateMCPServer: (id: string, updates: Partial<MCPServer>) => {
    set((state) => ({
      settings: {
        ...state.settings,
        mcpServers: state.settings.mcpServers.map((s) =>
          s.id === id ? { ...s, ...updates } : s,
        ),
      },
    }));
    get().saveToStore();
  },

  deleteMCPServer: (id: string) => {
    set((state) => ({
      settings: {
        ...state.settings,
        mcpServers: state.settings.mcpServers.filter((s) => s.id !== id),
      },
    }));
    get().saveToStore();
  },
}));
