import { createRuntime } from "../service";

const config = {
  endpoint: {
    providerId: "custom",
    baseUrl: "https://fixture.invalid",
    apiKey: "secret-token",
    model: "fixture",
  },
} as const;
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
function setup(
  execute = jest.fn(async (_m, _e, chunk) => {
    chunk("answer");
  }),
) {
  const authenticate = jest.fn(async (auth: unknown) =>
    auth === "a" || auth === "b" ? { ownerId: auth } : null,
  );
  const configure = jest.fn(async () => config);
  const runtime = createRuntime({ execute, authenticate, configure });
  return {
    client: runtime.forSurface("cli"),
    web: runtime.forSurface("web"),
    execute,
    authenticate,
    configure,
  };
}
async function events(stream: AsyncIterable<unknown>) {
  const out = [];
  for await (const e of stream) out.push(e);
  return out;
}
it("streams one terminal event and isolates sessions and surfaces", async () => {
  const { client, web, execute } = setup();
  const session = await client.createSession("a");
  await expect(client.start("b", session, "hello")).rejects.toThrow(
    "Access denied",
  );
  await expect(web.start("a", session, "hello")).rejects.toThrow(
    "Access denied",
  );
  expect(execute).not.toHaveBeenCalled();
  const run = await client.start("a", session, "hello");
  expect(await events(client.stream("a", session, run))).toEqual([
    expect.objectContaining({ type: "started", runId: run }),
    expect.objectContaining({ type: "output", text: "answer" }),
    expect.objectContaining({ type: "finished", outcome: "completed" }),
  ]);
});
it("authenticates before resolving config or accepting operations", async () => {
  const { client, configure } = setup();
  await expect(client.createSession("bad")).rejects.toThrow("Access denied");
  expect(configure).not.toHaveBeenCalled();
  await expect(client.cancel("bad", "unknown", "unknown")).rejects.toThrow(
    "Access denied",
  );
});
it("cancels and disconnects only owned runs with no late output", async () => {
  const pending = gate();
  let signal: AbortSignal | undefined;
  const { client } = setup(
    jest.fn(async (_m, _e, chunk, _s, _enabled, options) => {
      signal = options.signal;
      await pending.promise;
      chunk("late");
    }),
  );
  const session = await client.createSession("a");
  const run = await client.start("a", session, "hello");
  await Promise.resolve();
  await expect(client.cancel("b", session, run)).rejects.toThrow(
    "Access denied",
  );
  await client.cancel("a", session, run);
  expect(signal?.aborted).toBe(true);
  pending.resolve();
  const result = await events(client.stream("a", session, run));
  expect(result).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ text: "late" })]),
  );
  expect(result.filter((e: any) => e.type === "finished")).toEqual([
    expect.objectContaining({ outcome: "cancelled" }),
  ]);
  await client.disconnect("a", session);
  await expect(client.start("a", session, "again")).rejects.toThrow(
    "Access denied",
  );
});
it("redacts configured secrets across updates and hides error details", async () => {
  const pending = gate();
  const { client } = setup(
    jest.fn(async (_m, _e, chunk) => {
      chunk("safe secret-");
      await pending.promise;
      chunk("safe secret-token https://fixture.invalid");
    }),
  );
  const session = await client.createSession("a");
  const run = await client.start("a", session, "hello");
  const stream = client.stream("a", session, run)[Symbol.asyncIterator]();
  await stream.next();
  pending.resolve();
  const out = [];
  for (;;) {
    const n = await stream.next();
    if (n.done) break;
    out.push(n.value);
  }
  expect(JSON.stringify(out)).not.toMatch(
    /secret-token|https:\/\/fixture.invalid/,
  );
  expect(out).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "output",
        text: "safe [redacted] [redacted]",
      }),
    ]),
  );
});

it("flushes withheld text only after successful completion", async () => {
  const pending = gate();
  let emit!: (s: string) => void;
  const { client } = setup(
    jest.fn(async (_m, _e, chunk) => {
      emit = chunk;
      await pending.promise;
    }),
  );
  const session = await client.createSession("a");
  const run = await client.start("a", session, "hello");
  await Promise.resolve();
  const iterator = client.stream("a", session, run)[Symbol.asyncIterator]();
  await iterator.next();
  emit("a sufficiently long safe answer that remains partial");
  const partial = await iterator.next();
  expect((partial.value as any).text).not.toBe(
    "a sufficiently long safe answer that remains partial",
  );
  pending.resolve();
  const rest = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    rest.push(next.value);
  }
  expect(rest).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "output",
        text: "a sufficiently long safe answer that remains partial",
      }),
    ]),
  );
});
it("does not flush an incomplete secret after cancellation", async () => {
  const pending = gate();
  const { client } = setup(
    jest.fn(async (_m, _e, chunk) => {
      chunk("secret-");
      await pending.promise;
    }),
  );
  const session = await client.createSession("a");
  const run = await client.start("a", session, "hello");
  await Promise.resolve();
  await client.cancel("a", session, run);
  pending.resolve();
  const out = await events(client.stream("a", session, run));
  expect(JSON.stringify(out)).not.toContain("secret-");
});

it("rejects bad configuration/auth with fixed errors", async () => {
  const execute = jest.fn(async () => {});
  const throwing = createRuntime({
    execute,
    authenticate: async () => {
      throw Error("private-auth");
    },
    configure: async () => config,
  }).forSurface("web");
  await expect(throwing.createSession("credential")).rejects.toThrow(
    "Access denied",
  );
  const broken = createRuntime({
    execute,
    authenticate: async () => ({ ownerId: "owner" }),
    configure: async () => {
      throw Error("private-config");
    },
  }).forSurface("web");
  await expect(broken.createSession("credential")).rejects.toThrow(
    "Invalid runtime request",
  );
  const oversized = createRuntime({
    execute,
    authenticate: async () => ({ ownerId: "owner" }),
    configure: async () => ({ ...config, secrets: ["x".repeat(4097)] }),
  }).forSurface("web");
  await expect(oversized.createSession("credential")).rejects.toThrow(
    "Invalid runtime request",
  );
  expect(execute).not.toHaveBeenCalled();
});
it("rechecks identity after session configuration", async () => {
  let owner = "one";
  const runtime = createRuntime({
    execute: jest.fn(async () => {}),
    authenticate: async () => ({ ownerId: owner }),
    configure: async () => {
      owner = "two";
      return config;
    },
  });
  await expect(runtime.forSurface("web").createSession("auth")).rejects.toThrow(
    "Access denied",
  );
});
it("caps retained sessions and runs without accepting more work", async () => {
  const { client } = setup();
  const ids = [];
  for (let i = 0; i < 32; i++) ids.push(await client.createSession("a"));
  await expect(client.createSession("a")).rejects.toThrow(
    "Invalid runtime request",
  );
  for (let i = 0; i < 4; i++) await client.start("a", ids[0], "hello");
  await expect(client.start("a", ids[0], "hello")).rejects.toThrow(
    "Invalid runtime request",
  );
  for (const id of ids) await client.disconnect("a", id);
});
it("rejects unknown runs and double consumers without affecting the original", async () => {
  const { client } = setup();
  const session = await client.createSession("a");
  await expect(client.cancel("a", session, "missing")).rejects.toThrow(
    "Access denied",
  );
  await expect(events(client.stream("a", session, "missing"))).rejects.toThrow(
    "Access denied",
  );
  const run = await client.start("a", session, "hello");
  const first = client.stream("a", session, run)[Symbol.asyncIterator]();
  await first.next();
  await expect(events(client.stream("a", session, run))).rejects.toThrow(
    "Access denied",
  );
  await first.return?.();
  await client.disconnect("a", session);
});
it("bounds run lifetime even if the executor never settles", async () => {
  const client = createRuntime({
    execute: async () => new Promise(() => {}),
    authenticate: async () => ({ ownerId: "owner" }),
    configure: async () => config,
    maxRunMs: 1,
  }).forSurface("web");
  const session = await client.createSession("a");
  expect(await events(client.run("a", session, "hello"))).toEqual([
    expect.objectContaining({ type: "started" }),
    expect.objectContaining({ type: "finished", outcome: "cancelled" }),
  ]);
  await client.disconnect("a", session);
});
it.each([0, NaN, Infinity, 300001])(
  "rejects invalid run deadline %s",
  (maxRunMs) => {
    expect(() =>
      createRuntime({
        execute: jest.fn(),
        authenticate: jest.fn(),
        configure: jest.fn(),
        maxRunMs,
      }),
    ).toThrow("Invalid runtime request");
  },
);
it("captures host configuration and redacts multiple credential kinds", async () => {
  const mutable = {
    endpoint: { ...config.endpoint },
    mcpServers: [
      {
        id: "mcp",
        name: "fixture",
        url: "https://mcp.invalid",
        token: "mcp-token",
        enabled: true,
      },
    ],
    messages: [
      {
        id: "prior",
        role: "assistant" as const,
        content: "prior",
        timestamp: "fixture",
      },
    ],
    options: {
      fallbackEndpoint: { ...config.endpoint, apiKey: "fallback-key" },
    },
  };
  const execute = jest.fn(async (_m, _e, chunk) =>
    chunk("secret-token mcp-token fallback-key https://mcp.invalid"),
  );
  const runtime = createRuntime({
    execute,
    authenticate: async () => ({ ownerId: "owner" }),
    configure: async () => mutable,
  });
  expect(() => runtime.forSurface("invalid" as any)).toThrow(
    "Invalid runtime request",
  );
  const client = runtime.forSurface("mobile");
  const session = await client.createSession("a");
  mutable.endpoint.apiKey = "changed";
  mutable.messages[0].content = "changed";
  const out = await events(client.run("a", session, "hello"));
  expect(JSON.stringify(out)).not.toMatch(
    /secret-token|mcp-token|fallback-key|mcp.invalid/,
  );
  expect(execute.mock.calls[0][0][0].content).toBe("prior");
  expect(execute.mock.calls[0][1].apiKey).toBe("secret-token");
  await client.disconnect("a", session);
});
