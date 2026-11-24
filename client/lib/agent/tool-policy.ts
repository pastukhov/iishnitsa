import type { EndpointConfig, MCPServer } from "@/lib/store";
import { createTraceId } from "./observability";

export type ToolTarget =
  | { kind: "builtin"; name: "generate_image"; endpoint: EndpointConfig }
  | { kind: "mcp"; name: string; server: MCPServer };
export interface TrustedToolEntry {
  target: ToolTarget;
  risk: "read_only" | "mutating" | "denied";
}
export interface ToolApprovalRequest {
  readonly runId: string;
  readonly callId: string;
  readonly tool: Readonly<{
    kind: ToolTarget["kind"];
    name: string;
    serverId?: string;
  }>;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly expiresAt: number;
}
export interface ToolApproval {
  decision: "approve";
  request: ToolApprovalRequest;
}
export interface ToolPolicyOptions {
  registry: readonly TrustedToolEntry[];
  requestApproval?: (
    request: ToolApprovalRequest,
  ) => Promise<ToolApproval | null> | ToolApproval | null;
  approvalTimeoutMs?: number;
  signal?: AbortSignal;
}
export class ToolPolicyDeniedError extends Error {
  constructor() {
    super("Tool execution denied");
    this.name = "ToolPolicyDeniedError";
  }
}

// Canonical JSON snapshots reject executable/accessor data rather than invoking it.
function snapshot(
  value: unknown,
  omitUndefined = false,
  ancestors = new Set<object>(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || ancestors.has(value))
    throw new ToolPolicyDeniedError();
  if (Object.getOwnPropertySymbols(value).length)
    throw new ToolPolicyDeniedError();
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    throw new ToolPolicyDeniedError();
  ancestors.add(value);
  try {
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors)
      .filter((key) => !(array && key === "length"))
      .sort();
    if (array && keys.length !== value.length)
      throw new ToolPolicyDeniedError();
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new ToolPolicyDeniedError();
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
        throw new ToolPolicyDeniedError();
      if (omitUndefined && descriptor.value === undefined) continue;
      Object.defineProperty(result, key, {
        value: snapshot(descriptor.value, omitUndefined, ancestors),
        enumerable: true,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function httpUrl(value: unknown): boolean {
  if (!nonempty(value)) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
function targetSnapshot(target: ToolTarget): ToolTarget {
  const value = snapshot(target, true);
  if (!object(value) || !nonempty(value.name))
    throw new ToolPolicyDeniedError();
  if (value.kind === "mcp") {
    const server = value.server;
    if (
      !object(server) ||
      !nonempty(server.id) ||
      typeof server.name !== "string" ||
      !httpUrl(server.url) ||
      server.enabled !== true ||
      (server.token !== undefined && typeof server.token !== "string")
    )
      throw new ToolPolicyDeniedError();
  } else if (value.kind === "builtin" && value.name === "generate_image") {
    const endpoint = value.endpoint;
    if (
      !object(endpoint) ||
      !nonempty(endpoint.providerId) ||
      typeof endpoint.baseUrl !== "string" ||
      typeof endpoint.apiKey !== "string" ||
      typeof endpoint.model !== "string" ||
      (endpoint.folderId !== undefined && typeof endpoint.folderId !== "string")
    )
      throw new ToolPolicyDeniedError();
    if (endpoint.providerId === "custom" && !httpUrl(endpoint.baseUrl))
      throw new ToolPolicyDeniedError();
  } else throw new ToolPolicyDeniedError();
  return value as unknown as ToolTarget;
}
function argumentSnapshot(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const value = snapshot(args);
  if (!object(value)) throw new ToolPolicyDeniedError();
  return value;
}

/** Capture trusted configuration once for a logical request, before observers run. */
export function snapshotToolPolicyOptions(
  options?: ToolPolicyOptions,
): ToolPolicyOptions | undefined {
  if (!options) return undefined;
  const registry: TrustedToolEntry[] = [];
  for (const entry of options.registry ?? []) {
    try {
      const target = targetSnapshot(entry.target);
      const risk = ["read_only", "mutating", "denied"].includes(entry.risk)
        ? entry.risk
        : "denied";
      registry.push(Object.freeze({ target, risk }));
    } catch {
      /* Invalid configuration grants no authority. */
    }
  }
  return Object.freeze({
    registry: Object.freeze(registry),
    requestApproval: options.requestApproval,
    approvalTimeoutMs: options.approvalTimeoutMs,
    signal: options.signal,
  });
}

export function createToolExecutionPolicy(options?: ToolPolicyOptions) {
  const registry = new Map<string, TrustedToolEntry["risk"]>();
  for (const entry of options?.registry ?? []) {
    try {
      const key = JSON.stringify(targetSnapshot(entry.target));
      const risk = ["read_only", "mutating", "denied"].includes(entry.risk)
        ? entry.risk
        : "denied";
      // Conflicting/duplicate declarations do not broaden authority.
      registry.set(key, registry.has(key) ? "denied" : risk);
    } catch {
      /* Invalid trusted configuration grants no authority. */
    }
  }
  const requestApproval = options?.requestApproval;
  const signal = options?.signal;
  const suppliedTimeout = options?.approvalTimeoutMs ?? 30_000;
  const timeoutMs =
    Number.isFinite(suppliedTimeout) && suppliedTimeout > 0
      ? Math.min(suppliedTimeout, 60_000)
      : 0;
  const runId = createTraceId();
  let closed = false;
  const pending = new Set<() => void>();
  const denied = () => {
    throw new ToolPolicyDeniedError();
  };

  const requestGrant = (
    request: ToolApprovalRequest,
  ): Promise<ToolApproval | null> =>
    new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => settle(null);
      const settle = (grant: ToolApproval | null) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        pending.delete(cancel);
        signal?.removeEventListener("abort", cancel);
        resolve(grant);
      };
      pending.add(cancel);
      signal?.addEventListener("abort", cancel, { once: true });
      if (closed || signal?.aborted || !requestApproval || timeoutMs === 0) {
        settle(null);
        return;
      }
      timer = setTimeout(cancel, timeoutMs);
      try {
        Promise.resolve(requestApproval(request)).then(settle, cancel);
      } catch {
        cancel();
      }
    });

  return {
    async execute<T>(
      target: ToolTarget,
      args: Record<string, unknown>,
      adapter: (
        target: ToolTarget,
        args: Record<string, unknown>,
      ) => Promise<T>,
    ): Promise<T> {
      if (closed || signal?.aborted) return denied();
      let capturedTarget: ToolTarget;
      let capturedArgs: Record<string, unknown>;
      try {
        capturedTarget = targetSnapshot(target);
        capturedArgs = argumentSnapshot(args);
      } catch {
        return denied();
      }
      const targetKey = JSON.stringify(capturedTarget);
      const argsKey = JSON.stringify(capturedArgs);
      const risk = registry.get(targetKey);
      if (!risk || risk === "denied") return denied();
      if (risk === "mutating" || capturedTarget.kind === "builtin") {
        const request: ToolApprovalRequest = Object.freeze({
          runId,
          callId: createTraceId(),
          tool: Object.freeze(
            capturedTarget.kind === "mcp"
              ? {
                  kind: capturedTarget.kind,
                  name: capturedTarget.name,
                  serverId: capturedTarget.server.id,
                }
              : { kind: capturedTarget.kind, name: capturedTarget.name },
          ),
          arguments: capturedArgs,
          expiresAt: Date.now() + timeoutMs,
        });
        const grant = await requestGrant(request);
        // Exact object identity is the one-shot capability; copied or stale grants fail.
        try {
          if (
            !grant ||
            grant.decision !== "approve" ||
            grant.request !== request ||
            Date.now() >= request.expiresAt
          )
            return denied();
        } catch {
          return denied();
        }
      }
      if (closed || signal?.aborted) return denied();
      try {
        if (
          JSON.stringify(targetSnapshot(target)) !== targetKey ||
          JSON.stringify(argumentSnapshot(args)) !== argsKey
        )
          return denied();
      } catch {
        return denied();
      }
      // No await between authorization consumption and the adapter invocation.
      return await adapter(capturedTarget, capturedArgs);
    },
    close() {
      closed = true;
      for (const cancel of [...pending]) cancel();
    },
  };
}
