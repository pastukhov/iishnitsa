import AsyncStorage from "@react-native-async-storage/async-storage";
import { EndpointConfig, MCPServer, Message } from "@/lib/store";
import { MemorySettings } from "@/lib/agent/memory";

export interface QueuedChatPayload {
  chatId?: string | null;
  messages: Message[];
  endpoint: EndpointConfig;
  mcpServers: MCPServer[];
  mcpEnabled: boolean;
  systemPrompt?: string;
  chatPrompt?: string;
  memorySettings?: MemorySettings;
}

export interface QueuedChatRequest {
  id: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  payload: QueuedChatPayload;
}

const QUEUE_KEY = "@ai_agent_offline_queue";

// These gates protect one JS runtime; AsyncStorage has no cross-process lock.
function createSerialExecutor() {
  let tail: Promise<unknown> = Promise.resolve();
  return function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    // A failed operation still rejects its caller without blocking later work.
    tail = result.catch(() => {});
    return result;
  };
}

const withQueueStorage = createSerialExecutor();
const withQueueFlush = createSerialExecutor();

function generateId(): string {
  return `queue_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function loadQueue(): Promise<QueuedChatRequest[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persistQueue(queue: QueuedChatRequest[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueChatRequest(
  payload: QueuedChatPayload,
): Promise<QueuedChatRequest> {
  return withQueueStorage(async () => {
    const queue = await loadQueue();
    const entry: QueuedChatRequest = {
      id: generateId(),
      createdAt: Date.now(),
      attempts: 0,
      payload,
    };
    queue.push(entry);
    await persistQueue(queue);
    return entry;
  });
}

export async function getQueuedChatRequests(): Promise<QueuedChatRequest[]> {
  return withQueueStorage(loadQueue);
}

export async function flushQueuedChatRequests(options: {
  handler: (payload: QueuedChatPayload) => Promise<void>;
  filter?: (item: QueuedChatRequest) => boolean;
  maxItems?: number;
  shouldRetry?: (error: unknown) => boolean;
}): Promise<{ processed: number; failed: number; remaining: number }> {
  return withQueueFlush(async () => {
    const queue = await withQueueStorage(loadQueue);
    let processed = 0;
    let failed = 0;

    for (const item of queue) {
      if (options.filter && !options.filter(item)) continue;
      if (options.maxItems && processed >= options.maxItems) continue;

      let retry: QueuedChatRequest | undefined;
      try {
        // Do not hold the storage gate while waiting for network or MCP work.
        await options.handler(item.payload);
        processed += 1;
      } catch (error: any) {
        failed += 1;
        if (!options.shouldRetry || options.shouldRetry(error)) {
          retry = {
            ...item,
            attempts: item.attempts + 1,
            lastError: error?.message || "Failed to process request",
          };
        }
      }

      // Commit each outcome against the latest queue, preserving new enqueues.
      await withQueueStorage(async () => {
        const current = await loadQueue();
        await persistQueue(
          current.flatMap((entry) =>
            entry.id !== item.id ? [entry] : retry ? [retry] : [],
          ),
        );
      });
    }

    const remaining = await withQueueStorage(loadQueue);
    return { processed, failed, remaining: remaining.length };
  });
}
