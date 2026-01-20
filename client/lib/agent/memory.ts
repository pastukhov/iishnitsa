import AsyncStorage from "@react-native-async-storage/async-storage";

export type MemoryType = "user" | "task" | "fact" | "system";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  createdAt: number;
  lastAccessedAt: number;
  ttlMs?: number;
}

const MEMORY_KEY = "@ai_agent_memory";

function isExpired(entry: MemoryEntry): boolean {
  if (!entry.ttlMs) return false;
  return Date.now() - entry.createdAt > entry.ttlMs;
}

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export class MemoryStore {
  private cache: MemoryEntry[] = [];
  private loaded = false;

  private async loadIfNeeded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(MEMORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.cache = parsed;
        }
      }
    } catch (error) {
      console.warn("Failed to load memory store:", error);
    }
    this.loaded = true;
    await this.purgeExpired();
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(this.cache));
    } catch (error) {
      console.warn("Failed to persist memory store:", error);
    }
  }

  async addMemory(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt"> & {
      id?: string;
    },
  ): Promise<MemoryEntry> {
    await this.loadIfNeeded();
    const now = Date.now();
    const memory: MemoryEntry = {
      id: entry.id || generateId(),
      type: entry.type,
      content: entry.content,
      importance: entry.importance,
      ttlMs: entry.ttlMs,
      createdAt: now,
      lastAccessedAt: now,
    };
    this.cache.push(memory);
    await this.persist();
    return memory;
  }

  async getRelevantMemories(options?: {
    limit?: number;
    minImportance?: number;
    types?: MemoryType[];
  }): Promise<MemoryEntry[]> {
    await this.loadIfNeeded();
    await this.purgeExpired();
    const limit = options?.limit ?? 8;
    const minImportance = options?.minImportance ?? 0;

    const filtered = this.cache.filter((entry) => {
      if (entry.importance < minImportance) return false;
      if (options?.types && !options.types.includes(entry.type)) return false;
      return true;
    });

    const sorted = filtered.sort((a, b) => {
      if (b.importance !== a.importance) {
        return b.importance - a.importance;
      }
      return b.lastAccessedAt - a.lastAccessedAt;
    });

    const now = Date.now();
    const selected = sorted.slice(0, limit).map((entry) => ({
      ...entry,
      lastAccessedAt: now,
    }));

    if (selected.length > 0) {
      const selectedIds = new Set(selected.map((entry) => entry.id));
      this.cache = this.cache.map((entry) =>
        selectedIds.has(entry.id) ? { ...entry, lastAccessedAt: now } : entry,
      );
      await this.persist();
    }

    return selected;
  }

  async purgeExpired(): Promise<void> {
    const before = this.cache.length;
    this.cache = this.cache.filter((entry) => !isExpired(entry));
    if (this.cache.length !== before) {
      await this.persist();
    }
  }

  async clear(): Promise<void> {
    this.cache = [];
    await this.persist();
  }
}
