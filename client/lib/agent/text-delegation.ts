import type { EndpointConfig } from "../store";
import { combineRunSignals, throwIfCancelled } from "../runtime/cancellation";
import { OpenAICompatibleDriver } from "./openai-driver";
import type { createExecutionTrace } from "./execution-trace";

declare const capabilityBrand: unique symbol;
/** Only a trusted host factory can create this in-process capability. */
export interface TextDelegation {
  readonly [capabilityBrand]: true;
}
export interface UntrustedChildResult {
  readonly trust: "untrusted";
  readonly text: string;
}
type Config = {
  endpoint: EndpointConfig;
  tasks: readonly string[];
  secrets: readonly string[];
};
const capabilities = new WeakMap<TextDelegation, Config>();
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export class TextDelegationError extends Error {
  constructor() {
    super("Text delegation failed");
    this.name = "TextDelegationError";
  }
}
function invalid(): never {
  throw new Error("Invalid text delegation");
}
export function createTextDelegation(input: {
  endpoint: EndpointConfig;
  tasks: readonly string[];
}): TextDelegation {
  if (
    !input ||
    Object.keys(input).some((key) => !["endpoint", "tasks"].includes(key))
  )
    invalid();
  const source = input.endpoint;
  if (
    !source ||
    ![source.baseUrl, source.apiKey, source.model, source.providerId].every(
      (value) => typeof value === "string" && value.length <= 4096,
    ) ||
    !source.model ||
    (source.folderId !== undefined &&
      (typeof source.folderId !== "string" || source.folderId.length > 4096))
  )
    invalid();
  const endpoint = Object.freeze({
    providerId: source.providerId,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    model: source.model,
    ...(source.folderId !== undefined ? { folderId: source.folderId } : {}),
  });
  const secrets = Object.freeze(
    [endpoint.apiKey, endpoint.baseUrl, endpoint.folderId]
      .filter((v): v is string => !!v)
      .sort((a, b) => b.length - a.length),
  );
  if (
    !Array.isArray(input.tasks) ||
    input.tasks.length < 1 ||
    input.tasks.length > 3
  )
    invalid();
  let total = 0;
  const tasks = Object.freeze(
    Array.from(input.tasks, (task) => {
      if (
        typeof task !== "string" ||
        task.length > 4096 ||
        !task.trim() ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          task,
        ) ||
        bytes(task) > 4096 ||
        secrets.some((secret) => task.includes(secret))
      )
        invalid();
      total += bytes(task);
      if (total > 8192) invalid();
      return task;
    }),
  );
  const capability = Object.freeze({}) as TextDelegation;
  capabilities.set(capability, { endpoint, tasks, secrets });
  return capability;
}

/** Internal API boundary: never pass this capability or parent context to a child. */
export async function runTextDelegation(
  capability: TextDelegation,
  trace: ReturnType<typeof createExecutionTrace>,
  signal?: AbortSignal,
): Promise<readonly UntrustedChildResult[]> {
  const config = capabilities.get(capability);
  if (!config) invalid();
  const started = Date.now();
  const results: UntrustedChildResult[] = [];
  let outputBytes = 0;
  for (const task of config.tasks) {
    throwIfCancelled(signal);
    const childStarted = Date.now();
    const remaining = 30000 - (childStarted - started);
    if (remaining <= 0) throw new TextDelegationError();
    const child = trace.child();
    const deadline = new AbortController();
    const joined = combineRunSignals(signal, deadline.signal);
    const timer = setTimeout(
      () => deadline.abort(),
      Math.min(10000, remaining),
    );
    let outcome: "completed" | "failed" | "cancelled" = "failed";
    try {
      const response = await new OpenAICompatibleDriver().streamChat({
        endpoint: config.endpoint,
        messages: [{ role: "user", content: task }],
        tools: [],
        textOnly: true,
        signal: joined.signal,
        boundary: child.boundary,
        onChunk: () => {},
      });
      throwIfCancelled(joined.signal);
      if (Date.now() - started >= 30000 || Date.now() - childStarted >= 10000)
        throw new TextDelegationError();
      outputBytes += bytes(response.fullContent);
      if (outputBytes > 8192 || response.toolCalls.length)
        throw new TextDelegationError();
      let text = response.fullContent;
      for (const secret of config.secrets)
        text = text.split(secret).join("[redacted]");
      if (
        bytes(text) > 4096 ||
        config.secrets.some((secret) => text.includes(secret))
      )
        throw new TextDelegationError();
      // Redaction may expand short values, so reserve the larger retained size.
      outputBytes += Math.max(0, bytes(text) - bytes(response.fullContent));
      if (outputBytes > 8192) throw new TextDelegationError();
      results.push(Object.freeze({ trust: "untrusted", text }));
      outcome = "completed";
    } catch {
      if (signal?.aborted) {
        outcome = "cancelled";
        throwIfCancelled(signal);
      }
      throw new TextDelegationError();
    } finally {
      clearTimeout(timer);
      deadline.abort();
      joined.close();
      child.finish(outcome);
    }
  }
  return Object.freeze(results);
}
