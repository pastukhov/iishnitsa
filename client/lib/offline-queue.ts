import { throwIfCancelled } from "@/lib/runtime/cancellation";
import { nativeStorage } from "@/lib/runtime/storage";
import { EndpointConfig, MCPServer, Message } from "@/lib/store";
import { MemorySettings, type MemoryScope } from "@/lib/agent/memory";

export interface QueuedChatPayload {
  chatId?: string | null;
  messages: Message[];
  endpoint: EndpointConfig;
  mcpServers: MCPServer[];
  mcpEnabled: boolean;
  systemPrompt?: string;
  chatPrompt?: string;
  memorySettings?: MemorySettings;
  memoryScope?: MemoryScope;
}

export interface QueuedChatRequest {
  id: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  payload: QueuedChatPayload;
}

const QUEUE_KEY = "@ai_agent_offline_queue";
// Suppress replay in this runtime even if storage fails during cancellation cleanup.
// A failed durable cleanup cannot guarantee suppression after a process restart.
const cancelledQueueIds = new Set<string>();

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
  const raw = await nativeStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => !cancelledQueueIds.has(entry.id))
      : [];
  } catch {
    return [];
  }
}

async function persistQueue(queue: QueuedChatRequest[]): Promise<void> {
  const suppressed = new Set(cancelledQueueIds);
  await nativeStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(queue.filter((entry) => !suppressed.has(entry.id))),
  );
  // Successful durable cleanup supersedes these process-local tombstones.
  for (const id of suppressed) cancelledQueueIds.delete(id);
}

export async function enqueueChatRequest(
  payload: QueuedChatPayload,
  signal?: AbortSignal,
): Promise<QueuedChatRequest> {
  throwIfCancelled(signal);
  return withQueueStorage(async () => {
    throwIfCancelled(signal);
    const queue = await loadQueue();
    throwIfCancelled(signal);
    const entry: QueuedChatRequest = {
      id: generateId(),
      createdAt: Date.now(),
      attempts: 0,
      payload,
    };
    queue.push(entry);
    // setItem has no physical cancellation; keep the lock through rollback so
    // a concurrent flusher cannot see a newly cancelled request.
    try {
      throwIfCancelled(signal);
      await persistQueue(queue);
    } finally {
      if (signal?.aborted) {
        cancelledQueueIds.add(entry.id);
        try {
          await persistQueue(queue.filter((item) => item.id !== entry.id));
          cancelledQueueIds.delete(entry.id);
        } catch {
          console.warn(
            "Cancelled queue cleanup failed; restart may require manual queue cleanup",
          );
        }
        throwIfCancelled(signal);
      }
    }
    return entry;
  });
}

/** Cancel an accepted enqueue before replay; the caller owns this exact entry. */
export async function cancelQueuedChatRequest(id: string): Promise<void> {
  cancelledQueueIds.add(id);
  await withQueueStorage(async () => {
    try {
      await persistQueue(await loadQueue());
    } catch {
      console.warn(
        "Cancelled queue cleanup failed; restart may require manual queue cleanup",
      );
    }
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
        // Revalidate snapshots and begin dispatch under the storage gate. Release
        // it immediately after invocation, never while awaiting network/MCP work.
        const dispatched = await withQueueStorage(async () => {
          const current = await loadQueue();
          if (
            cancelledQueueIds.has(item.id) ||
            !current.some((entry) => entry.id === item.id)
          )
            return undefined;
          try {
            return { result: options.handler(item.payload) };
          } catch (error) {
            return { result: Promise.reject(error) };
          }
        });
        if (!dispatched) continue;
        // An already-invoked handler cannot be undone by later cancellation.
        await dispatched.result;
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
