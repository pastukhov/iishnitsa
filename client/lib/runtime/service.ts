import type { sendChatMessage } from "../api";
import type { EndpointConfig, MCPServer, Message } from "../store";
import { snapshotToolPolicyOptions } from "../agent/tool-policy";

export type RuntimeSurface = "mobile" | "cli" | "web" | "telegram";
export type ChatExecutor = typeof sendChatMessage;
type ChatOptions = NonNullable<Parameters<ChatExecutor>[5]>;
export interface SessionConfig {
  endpoint: EndpointConfig;
  messages?: Message[];
  mcpServers?: MCPServer[];
  mcpEnabled?: boolean;
  options?: Omit<
    ChatOptions,
    | "signal"
    | "queueOnFailure"
    | "onQueued"
    | "onExecutionEvent"
    | "onAttachment"
    | "onDecision"
    | "onMemoryError"
  >;
  secrets?: string[];
}
export type RuntimeEvent =
  | { type: "started"; runId: string }
  | { type: "output"; runId: string; text: string }
  | {
      type: "finished";
      runId: string;
      outcome: "completed" | "failed" | "cancelled";
    };
export interface RuntimeClient {
  createSession(auth: unknown): Promise<string>;
  start(auth: unknown, sessionId: string, text: string): Promise<string>;
  stream(
    auth: unknown,
    sessionId: string,
    runId: string,
  ): AsyncIterable<RuntimeEvent>;
  cancel(auth: unknown, sessionId: string, runId: string): Promise<void>;
  disconnect(auth: unknown, sessionId: string): Promise<void>;
  run(
    auth: unknown,
    sessionId: string,
    text: string,
  ): AsyncIterable<RuntimeEvent>;
}
export class RuntimeAccessError extends Error {
  constructor() {
    super("Access denied");
    this.name = "RuntimeAccessError";
  }
}
export class RuntimeInputError extends Error {
  constructor() {
    super("Invalid runtime request");
    this.name = "RuntimeInputError";
  }
}
interface Run {
  id: string;
  controller: AbortController;
  output: string;
  version: number;
  outcome?: "completed" | "failed" | "cancelled";
  consuming: boolean;
  wake?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}
interface Session {
  owner: string;
  surface: RuntimeSurface;
  config: SessionConfig;
  secrets: string[];
  runs: Map<string, Run>;
}
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !/[\u0000-\u001f\u007f]/.test(value);
const deny = (): never => {
  throw new RuntimeAccessError();
};
function capture(config: SessionConfig): SessionConfig {
  return {
    ...config,
    endpoint: { ...config.endpoint },
    messages: config.messages?.map((message) => ({
      ...message,
      attachments: message.attachments?.map((a) => ({ ...a })),
    })),
    mcpServers: config.mcpServers?.map((server) => ({ ...server })),
    secrets: config.secrets?.slice(),
    options: config.options
      ? {
          ...config.options,
          fallbackEndpoint: config.options.fallbackEndpoint
            ? { ...config.options.fallbackEndpoint }
            : undefined,
          memoryScope: config.options.memoryScope
            ? { ...config.options.memoryScope }
            : undefined,
          memorySettings: config.options.memorySettings
            ? { ...config.options.memorySettings }
            : undefined,
          toolPolicy: snapshotToolPolicyOptions(config.options.toolPolicy),
          skillContext: config.options.skillContext
            ? { ...config.options.skillContext }
            : undefined,
        }
      : undefined,
  };
}
function credentials(config: SessionConfig): string[] {
  const values = new Set(config.secrets ?? []);
  const visited = new WeakSet<object>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (
        ["apiKey", "token", "baseUrl", "url", "folderId"].includes(key) &&
        typeof entry === "string" &&
        entry
      )
        values.add(entry);
      else if (key !== "memoryStore" && key !== "signal") walk(entry);
    }
  };
  walk(config);
  if ([...values].some((v) => typeof v !== "string" || v.length > 4096))
    throw new RuntimeInputError();
  return [...values].filter(Boolean).sort((a, b) => b.length - a.length);
}
function safeOutput(text: string, secrets: string[], final: boolean): string {
  let end = final
    ? text.length
    : Math.max(
        0,
        text.length - Math.max(0, ...secrets.map((s) => s.length - 1)),
      );
  if (!final)
    for (const secret of secrets) {
      let start = text.indexOf(secret);
      while (start >= 0) {
        if (start < end && start + secret.length > end) end = start;
        start = text.indexOf(secret, start + 1);
      }
    }
  let result = text.slice(0, end);
  for (const secret of secrets)
    result = result.split(secret).join("[redacted]");
  return result;
}

export function createRuntime({
  execute,
  authenticate,
  configure,
  maxRunMs = 60000,
  randomUUID = () => globalThis.crypto.randomUUID(),
}: {
  execute: ChatExecutor;
  authenticate: (
    auth: unknown,
    surface: RuntimeSurface,
  ) => Promise<{ ownerId: string } | null>;
  configure: (
    owner: Readonly<{ ownerId: string }>,
    sessionId: string,
    surface: RuntimeSurface,
  ) => Promise<SessionConfig>;
  maxRunMs?: number;
  /** Host-supplied cryptographic UUID source when Web Crypto is unavailable. */
  randomUUID?: () => string;
}): { forSurface(surface: RuntimeSurface): RuntimeClient } {
  if (!Number.isFinite(maxRunMs) || maxRunMs < 1 || maxRunMs > 300000)
    throw new RuntimeInputError();
  const sessions = new Map<string, Session>();
  const activeId = (value: string) =>
    sessions.has(value) ||
    [...sessions.values()].some((session) => session.runs.has(value));
  const id = () => {
    let value: string;
    try {
      value = randomUUID();
    } catch {
      throw new RuntimeInputError();
    }
    if (!validId(value) || activeId(value)) throw new RuntimeInputError();
    return value;
  };
  const identity = async (auth: unknown, surface: RuntimeSurface) => {
    try {
      const principal = await authenticate(auth, surface);
      if (principal && validId(principal.ownerId)) return principal.ownerId;
    } catch {
      /* Fixed error only. */
    }
    return deny();
  };
  const sessionFor = async (
    auth: unknown,
    surface: RuntimeSurface,
    sessionId: string,
  ) => {
    const owner = await identity(auth, surface);
    const session = sessions.get(sessionId);
    if (!session || session.owner !== owner || session.surface !== surface)
      return deny();
    return session;
  };
  const finish = (run: Run, outcome: NonNullable<Run["outcome"]>) => {
    if (run.outcome) return;
    run.outcome = outcome;
    run.version++;
    clearTimeout(run.timer);
    run.wake?.();
  };
  const cancel = (run: Run) => {
    if (!run.outcome) {
      run.controller.abort();
      finish(run, "cancelled");
    }
  };
  return {
    forSurface(surface) {
      if (!["mobile", "cli", "web", "telegram"].includes(surface))
        throw new RuntimeInputError();
      const client: RuntimeClient = {
        async createSession(auth) {
          const owner = await identity(auth, surface);
          if (sessions.size >= 32) throw new RuntimeInputError();
          const sessionId = id();
          let config: SessionConfig;
          try {
            config = capture(
              await configure(
                Object.freeze({ ownerId: owner }),
                sessionId,
                surface,
              ),
            );
          } catch {
            throw new RuntimeInputError();
          }
          // Re-authenticate after an asynchronous host lookup before allocating state.
          if ((await identity(auth, surface)) !== owner) return deny();
          if (sessions.size >= 32 || activeId(sessionId))
            throw new RuntimeInputError();
          sessions.set(sessionId, {
            owner,
            surface,
            config,
            secrets: credentials(config),
            runs: new Map(),
          });
          return sessionId;
        },
        async start(auth, sessionId, text) {
          const session = await sessionFor(auth, surface, sessionId);
          if (sessions.get(sessionId) !== session) return deny();
          if (
            typeof text !== "string" ||
            !text.trim() ||
            text.length > 8192 ||
            session.runs.size >= 4
          )
            throw new RuntimeInputError();
          const run: Run = {
            id: id(),
            controller: new AbortController(),
            output: "",
            version: 0,
            consuming: false,
          };
          session.runs.set(run.id, run);
          run.timer = setTimeout(() => cancel(run), maxRunMs);
          const config = session.config;
          Promise.resolve()
            .then(async () => {
              if (
                run.controller.signal.aborted ||
                sessions.get(sessionId) !== session
              )
                return;
              await execute(
                [
                  ...(config.messages ?? []),
                  {
                    id: run.id,
                    role: "user",
                    content: text,
                    timestamp: new Date().toISOString(),
                  },
                ],
                config.endpoint,
                (output) => {
                  if (run.outcome || run.controller.signal.aborted) return;
                  if (typeof output !== "string" || output.length > 65536) {
                    run.controller.abort();
                    finish(run, "failed");
                    return;
                  }
                  run.output = output;
                  run.version++;
                  run.wake?.();
                },
                config.mcpServers,
                config.mcpEnabled,
                {
                  ...config.options,
                  signal: run.controller.signal,
                  queueOnFailure: false,
                  // Streams expose output and fixed outcomes, not attachments or private metadata.
                  onExecutionEvent: undefined,
                  onAttachment: undefined,
                  onDecision: undefined,
                  onMemoryError: undefined,
                  onQueued: undefined,
                },
              );
              finish(
                run,
                run.controller.signal.aborted ? "cancelled" : "completed",
              );
            })
            .catch(() =>
              finish(
                run,
                run.controller.signal.aborted ? "cancelled" : "failed",
              ),
            );
          return run.id;
        },
        async *stream(auth, sessionId, runId) {
          const session = await sessionFor(auth, surface, sessionId);
          if (sessions.get(sessionId) !== session) return deny();
          const run = session.runs.get(runId);
          if (!run || run.consuming) return deny();
          run.consuming = true;
          try {
            yield { type: "started", runId };
            let delivered = -1;
            for (;;) {
              await sessionFor(auth, surface, sessionId);
              if (sessions.get(sessionId) !== session) return deny();
              if (delivered !== run.version) {
                delivered = run.version;
                const text = safeOutput(
                  run.output,
                  session.secrets,
                  run.outcome === "completed",
                );
                if (text) {
                  yield { type: "output", runId, text };
                  continue;
                }
              }
              if (run.outcome) {
                yield { type: "finished", runId, outcome: run.outcome };
                return;
              }
              await new Promise<void>((resolve) => {
                run.wake = resolve;
              });
              run.wake = undefined;
            }
          } finally {
            cancel(run);
            run.output = "";
            session.runs.delete(runId);
          }
        },
        async cancel(auth, sessionId, runId) {
          const session = await sessionFor(auth, surface, sessionId);
          if (sessions.get(sessionId) !== session) return deny();
          const run = session.runs.get(runId);
          if (!run) return deny();
          cancel(run);
        },
        async disconnect(auth, sessionId) {
          const session = await sessionFor(auth, surface, sessionId);
          if (sessions.get(sessionId) !== session) return deny();
          sessions.delete(sessionId);
          for (const run of session.runs.values()) {
            cancel(run);
            run.output = "";
          }
          session.runs.clear();
        },
        async *run(auth, sessionId, text) {
          const runId = await client.start(auth, sessionId, text);
          yield* client.stream(auth, sessionId, runId);
        },
      };
      return client;
    },
  };
}
