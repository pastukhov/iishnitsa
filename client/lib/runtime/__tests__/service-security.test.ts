import {
  createRuntime,
  type ChatExecutor,
  type RuntimeEvent,
} from "../service";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const endpoint = {
  providerId: "custom" as const,
  baseUrl: "https://fixture.invalid",
  apiKey: "secret-token",
  model: "fixture",
};
async function collect(stream: AsyncIterable<RuntimeEvent>) {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

it("does not start an orphan execution when disconnect wins the authenticated session race", async () => {
  const execute = jest.fn<ReturnType<ChatExecutor>, Parameters<ChatExecutor>>(
    async () => {},
  );
  const client = createRuntime({
    execute,
    authenticate: async () => ({ ownerId: "owner" }),
    configure: async () => ({ endpoint }),
  }).forSurface("web");
  const session = await client.createSession("auth");
  const disconnected = client.disconnect("auth", session);
  const started = client.start("auth", session, "message");
  await disconnected;
  await expect(started).rejects.toThrow("Access denied");
  await Promise.resolve();
  expect(execute).not.toHaveBeenCalled();
});

it("rechecks revoked authentication between output and terminal delivery and cancels the run", async () => {
  let authorized = true;
  let signal: AbortSignal | undefined;
  const pending = deferred();
  const execute: ChatExecutor = async (
    _messages,
    _endpoint,
    chunk,
    _servers,
    _enabled,
    options,
  ) => {
    signal = options?.signal;
    chunk("public output ".repeat(8));
    await pending.promise;
  };
  const client = createRuntime({
    execute,
    authenticate: async () => (authorized ? { ownerId: "owner" } : null),
    configure: async () => ({ endpoint }),
  }).forSurface("web");
  const session = await client.createSession("auth");
  const run = await client.start("auth", session, "message");
  const stream = client.stream("auth", session, run)[Symbol.asyncIterator]();
  expect((await stream.next()).value?.type).toBe("started");
  expect((await stream.next()).value?.type).toBe("output");
  authorized = false;
  await expect(stream.next()).rejects.toThrow("Access denied");
  expect(signal?.aborted).toBe(true);
  pending.resolve();
});

it("cannot cancel another session's run even for the same owner", async () => {
  const pending = deferred();
  const signals: AbortSignal[] = [];
  const execute: ChatExecutor = async (
    _m,
    _e,
    _chunk,
    _s,
    _enabled,
    options,
  ) => {
    signals.push(options!.signal!);
    await pending.promise;
  };
  const client = createRuntime({
    execute,
    authenticate: async () => ({ ownerId: "owner" }),
    configure: async () => ({ endpoint }),
  }).forSurface("web");
  const first = await client.createSession("auth");
  const second = await client.createSession("auth");
  const run = await client.start("auth", first, "message");
  await expect(client.cancel("auth", second, run)).rejects.toThrow(
    "Access denied",
  );
  expect(signals[0].aborted).toBe(false);
  await client.cancel("auth", first, run);
  expect(signals[0].aborted).toBe(true);
  pending.resolve();
  const events = await collect(client.stream("auth", first, run));
  expect(events.filter((event) => event.type === "finished")).toEqual([
    expect.objectContaining({ outcome: "cancelled" }),
  ]);
});

it("rejects oversized input before execution and oversized output with one fixed failure", async () => {
  let signal: AbortSignal | undefined;
  const execute = jest.fn<ReturnType<ChatExecutor>, Parameters<ChatExecutor>>(
    async (_m, _e, chunk, _s, _enabled, options) => {
      signal = options?.signal;
      chunk("x".repeat(65537));
      chunk("late secret-token");
    },
  );
  const client = createRuntime({
    execute,
    authenticate: async () => ({ ownerId: "owner" }),
    configure: async () => ({ endpoint }),
  }).forSurface("web");
  const session = await client.createSession("auth");
  await expect(client.start("auth", session, "x".repeat(8193))).rejects.toThrow(
    "Invalid runtime request",
  );
  expect(execute).not.toHaveBeenCalled();
  const events = await collect(client.run("auth", session, "message"));
  expect(signal?.aborted).toBe(true);
  expect(events.filter((event) => event.type === "output")).toEqual([]);
  expect(events.filter((event) => event.type === "finished")).toEqual([
    expect.objectContaining({ outcome: "failed" }),
  ]);
});
