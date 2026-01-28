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
}

export async function getQueuedChatRequests(): Promise<QueuedChatRequest[]> {
  return await loadQueue();
}

export async function flushQueuedChatRequests(options: {
  handler: (payload: QueuedChatPayload) => Promise<void>;
  filter?: (item: QueuedChatRequest) => boolean;
  maxItems?: number;
}): Promise<{ processed: number; failed: number; remaining: number }> {
  const queue = await loadQueue();
  const remaining: QueuedChatRequest[] = [];
  let processed = 0;
  let failed = 0;

  for (const item of queue) {
    if (options.filter && !options.filter(item)) {
      remaining.push(item);
      continue;
    }
    if (options.maxItems && processed >= options.maxItems) {
      remaining.push(item);
      continue;
    }
    try {
      await options.handler(item.payload);
      processed += 1;
    } catch (error: any) {
      failed += 1;
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastError: error?.message || "Failed to process request",
      });
    }
  }

  await persistQueue(remaining);
  return { processed, failed, remaining: remaining.length };
}
