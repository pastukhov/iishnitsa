import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  enqueueChatRequest,
  cancelQueuedChatRequest,
  getQueuedChatRequests,
  flushQueuedChatRequests,
  type QueuedChatPayload,
} from "../../offline-queue";
import { sendChatMessage } from "../../api";
import { RunCancelledError } from "../cancellation";
const key = "@ai_agent_offline_queue";
const payload: QueuedChatPayload = {
  messages: [],
  endpoint: {
    providerId: "custom",
    baseUrl: "https://fake.invalid",
    apiKey: "fake",
    model: "fake",
  },
  mcpEnabled: false,
  mcpServers: [],
};
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  jest
    .mocked(AsyncStorage.getItem)
    .mockReset()
    .mockImplementation(async (k) => stored.get(k) ?? null);
  jest
    .mocked(AsyncStorage.setItem)
    .mockReset()
    .mockImplementation(async (k, v) => {
      stored.set(k, v);
    });
  (global.fetch as jest.Mock)
    .mockReset()
    .mockRejectedValue(new Error("Network request failed"));
});
function pauseRead() {
  let entered!: () => void;
  let release!: (value: null) => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => {
    entered();
    return new Promise<null>((resolve) => {
      release = resolve;
    });
  });
  return { started, release: () => release(null) };
}
it("does not enqueue after cancellation while waiting for the storage lock", async () => {
  const pause = pauseRead();
  const blocker = getQueuedChatRequests();
  await pause.started;
  const controller = new AbortController();
  const run = enqueueChatRequest(payload, controller.signal);
  controller.abort();
  pause.release();
  await blocker;
  await expect(run).rejects.toBeInstanceOf(RunCancelledError);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it("does not enqueue or notify after cancellation during the API fallback queue read", async () => {
  const pause = pauseRead();
  const controller = new AbortController();
  const onQueued = jest.fn();
  const run = sendChatMessage([], payload.endpoint, jest.fn(), [], false, {
    signal: controller.signal,
    queueOnFailure: true,
    onQueued,
    memorySettings: { enabled: false, autoSave: false, autoSummary: false },
  });
  await pause.started;
  controller.abort();
  pause.release();
  await expect(run).rejects.toBeInstanceOf(RunCancelledError);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(onQueued).not.toHaveBeenCalled();
});
it.each([false, true])(
  "removes an entry cancelled during persistence (cleanup failure=%s)",
  async (failCleanup) => {
    const prior = await enqueueChatRequest(payload);
    const controller = new AbortController();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (k, v) => {
      stored.set(k, v);
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    if (failCleanup)
      jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async () => {
        throw new Error("private-storage-error");
      });
    const onQueued = jest.fn();
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const run = sendChatMessage([], payload.endpoint, jest.fn(), [], false, {
        signal: controller.signal,
        queueOnFailure: true,
        onQueued,
        memorySettings: { enabled: false, autoSave: false, autoSummary: false },
      });
      await started;
      controller.abort();
      release();
      await expect(run).rejects.toBeInstanceOf(RunCancelledError);
      expect(onQueued).not.toHaveBeenCalled();
      expect((await getQueuedChatRequests()).map((e) => e.id)).toEqual([
        prior.id,
      ]);
      const handler = jest.fn().mockResolvedValue(undefined);
      await flushQueuedChatRequests({ handler });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "private-storage-error",
      );
      expect(JSON.parse(stored.get(key) ?? "[]")).toEqual([]);
    } finally {
      warning.mockRestore();
    }
  },
);
it("removes an accepted entry if onQueued cancels the request", async () => {
  const controller = new AbortController();
  const onQueued = jest.fn(() => controller.abort());
  await expect(
    sendChatMessage([], payload.endpoint, jest.fn(), [], false, {
      signal: controller.signal,
      queueOnFailure: true,
      onQueued,
      memorySettings: { enabled: false, autoSave: false, autoSummary: false },
    }),
  ).rejects.toBeInstanceOf(RunCancelledError);
  expect(onQueued).toHaveBeenCalledTimes(1);
  expect(await getQueuedChatRequests()).toEqual([]);
  const handler = jest.fn();
  await flushQueuedChatRequests({ handler });
  expect(handler).not.toHaveBeenCalled();
  expect(JSON.parse(stored.get(key) ?? "[]")).toEqual([]);
});
it("skips a cancelled entry from an already-loaded flush snapshot", async () => {
  const first = await enqueueChatRequest({ ...payload, chatId: "first" });
  const second = await enqueueChatRequest({ ...payload, chatId: "second" });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const handler = jest.fn(async (item) => {
    if (item.chatId === "first") {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
  });
  const run = flushQueuedChatRequests({ handler });
  await started;
  await cancelQueuedChatRequest(second.id);
  release();
  await run;
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(first.payload);
  expect(await getQueuedChatRequests()).toEqual([]);
});
