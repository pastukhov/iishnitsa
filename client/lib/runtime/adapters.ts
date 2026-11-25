import type { RuntimeClient, RuntimeEvent } from "./service";

export type AdapterFailure = { type: "error"; code: "request_failed" };
export type AdapterResponse =
  | AdapterFailure
  | { type: "session"; sessionId: string }
  | { type: "run"; runId: string }
  | { type: "ok" }
  | { type: "stream"; events: AsyncIterable<RuntimeEvent | AdapterFailure> };
export interface TelegramIdentity {
  actorId: string;
  conversationId: string;
  credential: unknown;
}
type Command =
  | { type: "create" }
  | { type: "start" | "run"; sessionId: string; text: string }
  | { type: "stream" | "cancel"; sessionId: string; runId: string }
  | { type: "disconnect"; sessionId: string };
const failure = (): AdapterFailure => ({
  type: "error",
  code: "request_failed",
});
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !/[\u0000-\u001f\u007f]/.test(value);
function parse(value: unknown): Command {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getOwnPropertySymbols(value).length
  )
    throw Error();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((d) => !d.enumerable || !("value" in d)))
    throw Error();
  const command = Object.fromEntries(
    Object.entries(descriptors).map(([key, d]) => [key, d.value]),
  );
  const fields: Record<string, string[]> = {
    create: ["type"],
    start: ["type", "sessionId", "text"],
    run: ["type", "sessionId", "text"],
    stream: ["type", "sessionId", "runId"],
    cancel: ["type", "sessionId", "runId"],
    disconnect: ["type", "sessionId"],
  };
  const expected =
    typeof command.type === "string" ? fields[command.type] : undefined;
  if (
    !Array.isArray(expected) ||
    Object.keys(command).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(command, key))
  )
    throw Error();
  if (command.type !== "create" && !validId(command.sessionId)) throw Error();
  if (
    (command.type === "stream" || command.type === "cancel") &&
    !validId(command.runId)
  )
    throw Error();
  if (
    (command.type === "start" || command.type === "run") &&
    typeof command.text !== "string"
  )
    throw Error();
  return command as Command;
}
interface Verified {
  credential: unknown;
  binding?: string;
}
function adapter<C>(
  client: RuntimeClient,
  verify: (context: C) => Promise<Verified>,
) {
  const sessions = new Map<string, string>();
  async function access(context: C, sessionId?: string): Promise<Verified> {
    const identity = await verify(context);
    if (
      identity.binding !== undefined &&
      sessionId !== undefined &&
      sessions.get(sessionId) !== identity.binding
    )
      throw Error();
    return identity;
  }
  async function* stream(
    context: C,
    sessionId: string,
    source: AsyncIterable<RuntimeEvent>,
    credential: unknown,
  ): AsyncIterable<RuntimeEvent | AdapterFailure> {
    const iterator = source[Symbol.asyncIterator]();
    try {
      for (;;) {
        if (
          !Object.is((await access(context, sessionId)).credential, credential)
        )
          throw Error();
        const next = await iterator.next();
        if (next.done) return;
        if (
          !Object.is((await access(context, sessionId)).credential, credential)
        )
          throw Error();
        yield next.value;
      }
    } catch {
      // Close the owned runtime iterator before exposing a failure.
    } finally {
      try {
        await iterator.return?.();
      } catch {
        /* Never expose transport or credential errors. */
      }
    }
    yield failure();
  }
  return {
    async handle(context: C, payload: unknown): Promise<AdapterResponse> {
      try {
        // Context is host-owned and independent of the untrusted command payload.
        const identity = await verify(context);
        const command = parse(payload);
        if (command.type === "create") {
          const sessionId = await client.createSession(identity.credential);
          if (identity.binding !== undefined)
            sessions.set(sessionId, identity.binding);
          return { type: "session", sessionId };
        }
        if (
          identity.binding !== undefined &&
          sessions.get(command.sessionId) !== identity.binding
        )
          throw Error();
        switch (command.type) {
          case "start":
            return {
              type: "run",
              runId: await client.start(
                identity.credential,
                command.sessionId,
                command.text,
              ),
            };
          case "stream":
            return {
              type: "stream",
              events: stream(
                context,
                command.sessionId,
                client.stream(
                  identity.credential,
                  command.sessionId,
                  command.runId,
                ),
                identity.credential,
              ),
            };
          case "run":
            return {
              type: "stream",
              events: stream(
                context,
                command.sessionId,
                client.run(
                  identity.credential,
                  command.sessionId,
                  command.text,
                ),
                identity.credential,
              ),
            };
          case "cancel":
            await client.cancel(
              identity.credential,
              command.sessionId,
              command.runId,
            );
            return { type: "ok" };
          case "disconnect":
            await client.disconnect(identity.credential, command.sessionId);
            sessions.delete(command.sessionId);
            return { type: "ok" };
        }
      } catch {
        return failure();
      }
    },
  };
}
/** Context and credential resolution are supplied by the authenticated web host. */
export function createWebAdapter<C>(
  client: RuntimeClient,
  credential: (context: C) => unknown | Promise<unknown>,
) {
  return adapter(client, async (context: C) => ({
    credential: await credential(context),
  }));
}
/** The verifier must validate both actor and conversation independently of payload fields. */
export function createTelegramAdapter<C>(
  client: RuntimeClient,
  verify: (
    context: C,
  ) => TelegramIdentity | null | Promise<TelegramIdentity | null>,
) {
  return adapter(client, async (context: C) => {
    const identity = await verify(context);
    if (
      !identity ||
      !validId(identity.actorId) ||
      !validId(identity.conversationId)
    )
      throw Error();
    return {
      credential: identity.credential,
      binding: JSON.stringify([identity.actorId, identity.conversationId]),
    };
  });
}
