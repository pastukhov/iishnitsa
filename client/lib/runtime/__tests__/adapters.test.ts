import { createRuntime, type ChatExecutor } from "../service";
import {
  createWebAdapter,
  createTelegramAdapter,
  type AdapterResponse,
  type AdapterFailure,
} from "../adapters";
const error: AdapterFailure = { type: "error", code: "request_failed" };
function setup(surface: "web" | "telegram", waiting = false) {
  const signals: AbortSignal[] = [];
  const outputs: ((text: string) => void)[] = [];
  const execute = jest.fn(
    async (_messages, _endpoint, onChunk, _servers, _enabled, options) => {
      signals.push(options.signal);
      outputs.push(onChunk);
      if (waiting)
        await new Promise<void>((resolve) =>
          options.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      else {
        onChunk("answer");
      }
    },
  ) as jest.MockedFunction<ChatExecutor>;
  const authenticate = jest.fn(async (auth: unknown) =>
    typeof auth === "string" && ["alice", "bob"].includes(auth)
      ? { ownerId: auth }
      : null,
  );
  const runtime = createRuntime({
    execute,
    authenticate,
    configure: async () => ({
      endpoint: {
        providerId: "custom",
        baseUrl: "https://private.invalid",
        apiKey: "private-key",
        model: "fake",
      },
    }),
  });
  type Context = {
    credential: string;
    actorId: string;
    conversationId: string;
    valid: boolean;
  };
  const context: Context = {
    credential: "alice",
    actorId: "a",
    conversationId: "private:a",
    valid: true,
  };
  const adapter =
    surface === "web"
      ? createWebAdapter(
          runtime.forSurface("web"),
          (c: Context) => c.credential,
        )
      : createTelegramAdapter(runtime.forSurface("telegram"), (c: Context) =>
          c.valid
            ? {
                actorId: c.actorId,
                conversationId: c.conversationId,
                credential: c.credential,
              }
            : null,
        );
  return { adapter, context, signals, outputs, execute, authenticate };
}
async function session(set: ReturnType<typeof setup>) {
  const response = await set.adapter.handle(set.context, { type: "create" });
  expect(response.type).toBe("session");
  return (response as { sessionId: string }).sessionId;
}
async function events(response: AdapterResponse) {
  expect(response.type).toBe("stream");
  if (response.type !== "stream") throw Error("expected stream");
  const result = [];
  for await (const event of response.events) result.push(event);
  return result;
}
it.each(["web", "telegram"] as const)(
  "%s delegates common commands to one real runtime",
  async (surface) => {
    const set = setup(surface);
    const sessionId = await session(set);
    const started = await set.adapter.handle(set.context, {
      type: "start",
      sessionId,
      text: "hello",
    });
    expect(started.type).toBe("run");
    const runId = (started as { runId: string }).runId;
    const output = await events(
      await set.adapter.handle(set.context, {
        type: "stream",
        sessionId,
        runId,
      }),
    );
    expect(output).toEqual(
      expect.arrayContaining([
        { type: "output", runId, text: "answer" },
        { type: "finished", runId, outcome: "completed" },
      ]),
    );
    expect(set.execute).toHaveBeenCalledTimes(1);
    const run = await events(
      await set.adapter.handle(set.context, {
        type: "run",
        sessionId,
        text: "second",
      }),
    );
    expect(run.at(-1)).toMatchObject({
      type: "finished",
      outcome: "completed",
    });
    expect(
      await set.adapter.handle(set.context, { type: "disconnect", sessionId }),
    ).toEqual({ type: "ok" });
    expect(
      await set.adapter.handle(set.context, {
        type: "start",
        sessionId,
        text: "late",
      }),
    ).toEqual(error);
  },
);
it.each(["web", "telegram"] as const)(
  "%s denies payload configuration, malformed commands and unknown sessions",
  async (surface) => {
    const set = setup(surface);
    const sessionId = await session(set);
    for (const command of [
      null,
      {},
      [],
      { type: "create", credential: "bob" },
      { type: "start", sessionId, text: "x", endpoint: {} },
      { type: "cancel", sessionId, runId: "missing", permissions: [] },
      { type: "start", sessionId, text: 42 },
      { type: "other" },
      { type: "disconnect", sessionId: "missing" },
    ])
      expect(await set.adapter.handle(set.context, command)).toEqual(error);
    expect(set.execute).not.toHaveBeenCalled();
    expect(
      await events(
        await set.adapter.handle(set.context, {
          type: "run",
          sessionId,
          text: "x".repeat(8193),
        }),
      ),
    ).toEqual([error]);
  },
);
it.each(["web", "telegram"] as const)(
  "%s unauthorized operations cannot cancel another owner's run",
  async (surface) => {
    const set = setup(surface, true);
    const sessionId = await session(set);
    const start = await set.adapter.handle(set.context, {
      type: "start",
      sessionId,
      text: "hello",
    });
    const runId = (start as { runId: string }).runId;
    const stranger = { ...set.context, credential: "bob", actorId: "b" };
    expect(
      await set.adapter.handle(stranger, { type: "cancel", sessionId, runId }),
    ).toEqual(error);
    expect(
      await set.adapter.handle(stranger, { type: "disconnect", sessionId }),
    ).toEqual(error);
    const response = await set.adapter.handle(stranger, {
      type: "stream",
      sessionId,
      runId,
    });
    if (response.type === "stream")
      expect(await events(response)).toEqual([error]);
    else expect(response).toEqual(error);
    expect(set.signals[0].aborted).toBe(false);
    expect(
      await set.adapter.handle(set.context, {
        type: "cancel",
        sessionId,
        runId,
      }),
    ).toEqual({ type: "ok" });
    expect(
      (
        await events(
          await set.adapter.handle(set.context, {
            type: "stream",
            sessionId,
            runId,
          }),
        )
      ).at(-1),
    ).toMatchObject({ outcome: "cancelled" });
    await set.adapter.handle(set.context, { type: "disconnect", sessionId });
  },
);
it.each(["web", "telegram"] as const)(
  "%s stream consumer disconnect cancels only its owned run",
  async (surface) => {
    const set = setup(surface, true);
    const sessionId = await session(set);
    const response = await set.adapter.handle(set.context, {
      type: "run",
      sessionId,
      text: "hello",
    });
    if (response.type !== "stream") throw Error("expectedstream");
    const iterator = response.events[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "started" });
    await iterator.return?.();
    expect(set.signals[0].aborted).toBe(true);
    await set.adapter.handle(set.context, { type: "disconnect", sessionId });
  },
);
it("binds Telegram sessions to verified actor AND conversation, not command fields", async () => {
  const set = setup("telegram");
  const sessionId = await session(set);
  for (const context of [
    { ...set.context, conversationId: "group:a" },
    { ...set.context, actorId: "different" },
    { ...set.context, valid: false },
  ])
    expect(
      await set.adapter.handle(context, {
        type: "start",
        sessionId,
        text: "hello",
      }),
    ).toEqual(error);
  expect(
    await set.adapter.handle(set.context, {
      type: "start",
      sessionId,
      text: "hello",
      actorId: "a",
      conversationId: "private:a",
    }),
  ).toEqual(error);
  expect(set.execute).not.toHaveBeenCalled();
  await set.adapter.handle(set.context, { type: "disconnect", sessionId });
});
it("rechecks Telegram verifier during streaming and cleans up after revocation", async () => {
  const set = setup("telegram", true);
  const sessionId = await session(set);
  const response = await set.adapter.handle(set.context, {
    type: "run",
    sessionId,
    text: "hello",
  });
  if (response.type !== "stream") throw Error("expectedstream");
  const iterator = response.events[Symbol.asyncIterator]();
  await iterator.next();
  set.context.valid = false;
  // Wake the runtime, then the adapter must reverify before exposing the event.
  set.outputs[0]("safe output ".repeat(10));
  expect((await iterator.next()).value).toEqual(error);
  await iterator.return?.();
  expect(set.signals[0].aborted).toBe(true);
  set.context.valid = true;
  await set.adapter.handle(set.context, { type: "disconnect", sessionId });
});
it("hides verifier and runtime failures behind one fixed error", async () => {
  const set = setup("telegram");
  const runtime = createRuntime({
    execute: set.execute,
    authenticate: async () => {
      throw Error("private-token");
    },
    configure: async () => {
      throw Error("private-url");
    },
  });
  const web = createWebAdapter(runtime.forSurface("web"), () => "alice");
  expect(await web.handle({}, { type: "create" })).toEqual(error);
  const telegram = createTelegramAdapter(runtime.forSurface("telegram"), () => {
    throw Error("private-token");
  });
  expect(await telegram.handle({}, { type: "create" })).toEqual(error);
});

it.each(["web", "telegram"] as const)(
  "%s does not expose stream events after its connection credential changes",
  async (surface) => {
    const set = setup(surface, true);
    const sessionId = await session(set);
    const response = await set.adapter.handle(set.context, {
      type: "run",
      sessionId,
      text: "hello",
    });
    if (response.type !== "stream") throw Error("expected stream");
    const iterator = response.events[Symbol.asyncIterator]();
    await iterator.next();
    set.context.credential = "bob";
    set.outputs[0]("safe output ".repeat(10));
    expect((await iterator.next()).value).toEqual(error);
    expect(set.signals[0].aborted).toBe(true);
    await iterator.return?.();
    set.context.credential = "alice";
    await set.adapter.handle(set.context, { type: "disconnect", sessionId });
  },
);

it("rejects accessor, symbol, missing and invalid identifier command fields without executing getters", async () => {
  const set = setup("web");
  const sessionId = await session(set);
  const getter = jest.fn(() => "create");
  for (const command of [
    Object.defineProperty({}, "type", { enumerable: true, get: getter }),
    { type: "create", [Symbol("hidden")]: true },
    { type: "start", sessionId },
    { type: "stream", sessionId, runId: "" },
    { type: "cancel", sessionId, runId: "x".repeat(129) },
    { type: "start", sessionId: "", text: "hello" },
  ])
    expect(await set.adapter.handle(set.context, command)).toEqual(error);
  expect(getter).not.toHaveBeenCalled();
  await set.adapter.handle(set.context, { type: "disconnect", sessionId });
});
it("rejects invalid verified Telegram identity fields", async () => {
  const set = setup("telegram");
  expect(
    await set.adapter.handle(
      { ...set.context, actorId: "" },
      { type: "create" },
    ),
  ).toEqual(error);
  expect(
    await set.adapter.handle(
      { ...set.context, conversationId: "" },
      { type: "create" },
    ),
  ).toEqual(error);
  expect(set.authenticate).not.toHaveBeenCalled();
});
it.each(["credential", "conversation"] as const)(
  "checks Telegram %s again after an awaited stream event",
  async (field) => {
    const set = setup("telegram", true);
    const sessionId = await session(set);
    const response = await set.adapter.handle(set.context, {
      type: "run",
      sessionId,
      text: "hello",
    });
    if (response.type !== "stream") throw Error("expected stream");
    const iterator = response.events[Symbol.asyncIterator]();
    await iterator.next();
    const next = iterator.next();
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (field === "credential") set.context.credential = "bob";
    else set.context.conversationId = "group:b";
    set.outputs[0]("safe output ".repeat(10));
    expect((await next).value).toEqual(error);
    expect(set.signals[0].aborted).toBe(true);
    await iterator.return?.();
    set.context.credential = "alice";
    set.context.conversationId = "private:a";
    await set.adapter.handle(set.context, { type: "disconnect", sessionId });
  },
);

it.each(["web", "telegram"] as const)(
  "%s explicit host disconnect releases a blocked stream read",
  async (surface) => {
    const set = setup(surface, true);
    const sessionId = await session(set);
    const response = await set.adapter.handle(set.context, {
      type: "run",
      sessionId,
      text: "hello",
    });
    if (response.type !== "stream") throw Error("expected stream");
    const iterator = response.events[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      await set.adapter.handle(set.context, {
        type: "disconnect",
        sessionId,
      }),
    ).toEqual({ type: "ok" });
    expect(set.signals[0].aborted).toBe(true);
    expect((await pending).value).toEqual(error);
    await iterator.return?.();
  },
);
