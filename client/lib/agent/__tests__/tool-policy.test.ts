import {
  createToolExecutionPolicy,
  snapshotToolPolicyOptions,
  ToolPolicyDeniedError,
  type ToolTarget,
  type ToolApprovalRequest,
  type ToolApproval,
} from "../tool-policy";

const target: ToolTarget = {
  kind: "mcp",
  name: "change_item",
  server: {
    id: "server",
    name: "Display",
    url: "https://tools.invalid/mcp",
    token: "credential-secret",
    enabled: true,
  },
};
const builtin: ToolTarget = {
  kind: "builtin",
  name: "generate_image",
  endpoint: {
    providerId: "custom",
    baseUrl: "https://images.invalid/v1",
    apiKey: "credential-secret",
    model: "image-model",
  },
};
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function approve(request: ToolApprovalRequest): ToolApproval {
  return { decision: "approve", request };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  jest.useRealTimers();
});

it("allows a classified read-only call using frozen snapshots", async () => {
  const args = { nested: { value: "payload-secret" } };
  const adapter = jest.fn(async (actualTarget, actualArgs) => {
    expect(actualTarget).toEqual(target);
    expect(actualTarget).not.toBe(target);
    expect(Object.isFrozen(actualTarget.server)).toBe(true);
    expect(Object.isFrozen(actualArgs.nested)).toBe(true);
    return "receipt";
  });
  const requestApproval = jest.fn();
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "read_only" }],
    requestApproval,
  });
  await expect(policy.execute(target, args, adapter)).resolves.toBe("receipt");
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(requestApproval).not.toHaveBeenCalled();
});

it.each(["unknown", "denied", "disabled", "other-url", "other-token"])(
  "denies %s before approval and adapter",
  async (kind) => {
    const actual = copy(target);
    if (actual.kind === "mcp") {
      if (kind === "disabled") actual.server.enabled = false;
      if (kind === "other-url") actual.server.url = "https://other.invalid/mcp";
      if (kind === "other-token") actual.server.token = "other-secret";
    }
    const adapter = jest.fn();
    const requestApproval = jest.fn(approve);
    const policy = createToolExecutionPolicy({
      registry:
        kind === "unknown"
          ? []
          : [{ target, risk: kind === "denied" ? "denied" : "read_only" }],
      requestApproval,
    });
    await expect(policy.execute(actual, {}, adapter)).rejects.toBeInstanceOf(
      ToolPolicyDeniedError,
    );
    expect(adapter).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
  },
);

it("requires exact current approval for mutation and exposes only safe identity", async () => {
  const args = { item: "payload-secret", nested: [1, { ok: true }] };
  const requestApproval = jest.fn((request: ToolApprovalRequest) => {
    expect(request.arguments).toEqual(args);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.arguments.nested)).toBe(true);
    expect(Object.isFrozen(request.tool)).toBe(true);
    expect(request.tool).toEqual({
      kind: "mcp",
      name: "change_item",
      serverId: "server",
    });
    expect(JSON.stringify(request)).not.toMatch(
      /credential-secret|tools\.invalid/,
    );
    return approve(request);
  });
  const adapter = jest.fn(async () => "done");
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "mutating" }],
    requestApproval,
  });
  await expect(policy.execute(target, args, adapter)).resolves.toBe("done");
  expect(adapter).toHaveBeenCalledTimes(1);
});

it.each(["absent", "null", "throw", "copy", "wrong-decision"])(
  "fails closed for approval handler %s",
  async (kind) => {
    const adapter = jest.fn();
    const requestApproval =
      kind === "absent"
        ? undefined
        : (request: ToolApprovalRequest) => {
            if (kind === "throw") throw new Error("handler-secret");
            if (kind === "null") return null;
            if (kind === "wrong-decision")
              return { decision: "deny", request } as any;
            return approve(copy(request));
          };
    const policy = createToolExecutionPolicy({
      registry: [{ target, risk: "mutating" }],
      requestApproval,
    });
    await expect(policy.execute(target, {}, adapter)).rejects.toThrow(
      "Tool execution denied",
    );
    expect(adapter).not.toHaveBeenCalled();
  },
);

it("cannot classify built-in image generation as read-only", async () => {
  const adapter = jest.fn(async () => "image");
  const policy = createToolExecutionPolicy({
    registry: [{ target: builtin, risk: "read_only" }],
  });
  await expect(
    policy.execute(builtin, { prompt: "private" }, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  expect(adapter).not.toHaveBeenCalled();
  const allowed = createToolExecutionPolicy({
    registry: [{ target: builtin, risk: "read_only" }],
    requestApproval: approve,
  });
  await expect(
    allowed.execute(builtin, { prompt: "private" }, adapter),
  ).resolves.toBe("image");
});

it("does not reuse a grant for a second call or another run", async () => {
  let saved: ToolApproval | undefined;
  const requestApproval = (request: ToolApprovalRequest) =>
    (saved ??= approve(request));
  const adapter = jest.fn(async () => "done");
  const options = {
    registry: [{ target, risk: "mutating" as const }],
    requestApproval,
  };
  const first = createToolExecutionPolicy(options);
  await first.execute(target, {}, adapter);
  await expect(first.execute(target, {}, adapter)).rejects.toBeInstanceOf(
    ToolPolicyDeniedError,
  );
  await expect(
    createToolExecutionPolicy(options).execute(target, {}, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  expect(adapter).toHaveBeenCalledTimes(1);
});

it.each(["target", "arguments"])(
  "denies if %s changes during approval",
  async (kind) => {
    const actual = copy(target);
    const args = { value: 1 };
    const approval = deferred<ToolApproval>();
    let request!: ToolApprovalRequest;
    const policy = createToolExecutionPolicy({
      registry: [{ target, risk: "mutating" }],
      requestApproval: (value) => {
        request = value;
        return approval.promise;
      },
    });
    const adapter = jest.fn();
    const result = policy.execute(actual, args, adapter);
    if (kind === "target" && actual.kind === "mcp")
      actual.server.token = "new-secret";
    else args.value = 2;
    approval.resolve(approve(request));
    await expect(result).rejects.toBeInstanceOf(ToolPolicyDeniedError);
    expect(adapter).not.toHaveBeenCalled();
  },
);

it("freezes registry authority against external reassignment", async () => {
  const registered = copy(target);
  const registry = [{ target: registered, risk: "mutating" as const }];
  const policy = createToolExecutionPolicy({
    registry,
    requestApproval: approve,
  });
  if (registered.kind === "mcp")
    registered.server.url = "https://replacement.invalid";
  const adapter = jest.fn();
  await expect(policy.execute(registered, {}, adapter)).rejects.toBeInstanceOf(
    ToolPolicyDeniedError,
  );
  expect(adapter).not.toHaveBeenCalled();
});

it.each(["timeout", "abort", "close"])(
  "ignores late approval after %s",
  async (kind) => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const approval = deferred<ToolApproval>();
    let request!: ToolApprovalRequest;
    const policy = createToolExecutionPolicy({
      registry: [{ target, risk: "mutating" }],
      approvalTimeoutMs: 20,
      signal: controller.signal,
      requestApproval: (value) => {
        request = value;
        return approval.promise;
      },
    });
    const adapter = jest.fn();
    const result = policy.execute(target, {}, adapter);
    const rejected = expect(result).rejects.toBeInstanceOf(
      ToolPolicyDeniedError,
    );
    expect(request).toBeDefined();
    if (kind === "timeout") await jest.advanceTimersByTimeAsync(21);
    else if (kind === "abort") controller.abort();
    else policy.close();
    await rejected;
    approval.resolve(approve(request));
    await Promise.resolve();
    expect(adapter).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  },
);

it("isolates simultaneous approvals resolved in reverse order", async () => {
  const approvals: {
    request: ToolApprovalRequest;
    waiting: ReturnType<typeof deferred<ToolApproval>>;
  }[] = [];
  const requestApproval = (request: ToolApprovalRequest) => {
    const waiting = deferred<ToolApproval>();
    approvals.push({ request, waiting });
    return waiting.promise;
  };
  const options = {
    registry: [{ target, risk: "mutating" as const }],
    requestApproval,
  };
  const adapter = jest.fn(async (_target, args) => args.value);
  const a = createToolExecutionPolicy(options).execute(
    target,
    { value: "a" },
    adapter,
  );
  const b = createToolExecutionPolicy(options).execute(
    target,
    { value: "b" },
    adapter,
  );
  void a.catch(() => {});
  void b.catch(() => {});
  expect(approvals).toHaveLength(2);
  expect(approvals[0].request.runId).not.toBe(approvals[1].request.runId);
  approvals[1].waiting.resolve(approve(approvals[1].request));
  await expect(b).resolves.toBe("b");
  expect(adapter).toHaveBeenCalledTimes(1);
  approvals[0].waiting.resolve(approve(approvals[0].request));
  await expect(a).resolves.toBe("a");
});

it("fails closed when reading a malformed approval result throws", async () => {
  const adapter = jest.fn();
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "mutating" }],
    requestApproval: (request) =>
      Object.defineProperty({ request }, "decision", {
        get() {
          throw new Error("approval-secret");
        },
      }) as ToolApproval,
  });
  await expect(policy.execute(target, {}, adapter)).rejects.toThrow(
    "Tool execution denied",
  );
  expect(adapter).not.toHaveBeenCalled();
});

it("rechecks expiry after a synchronous handler returns", async () => {
  jest.useFakeTimers();
  const adapter = jest.fn();
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "mutating" }],
    approvalTimeoutMs: 20,
    requestApproval: (request) => {
      jest.setSystemTime(request.expiresAt);
      return approve(request);
    },
  });
  await expect(policy.execute(target, {}, adapter)).rejects.toBeInstanceOf(
    ToolPolicyDeniedError,
  );
  expect(adapter).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it("bounds an approval handler that never returns to sixty seconds", async () => {
  jest.useFakeTimers();
  const adapter = jest.fn();
  let request!: ToolApprovalRequest;
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "mutating" }],
    approvalTimeoutMs: 999_999,
    requestApproval: (value) => {
      request = value;
      return new Promise(() => {});
    },
  });
  const rejected = expect(
    policy.execute(target, {}, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  expect(request.expiresAt - Date.now()).toBe(60_000);
  await jest.advanceTimersByTimeAsync(60_000);
  await rejected;
  expect(adapter).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it.each(["closed", "aborted"])(
  "blocks even read-only execution when run is %s",
  async (state) => {
    const signal = new AbortController();
    const policy = createToolExecutionPolicy({
      registry: [{ target, risk: "read_only" }],
      signal: signal.signal,
    });
    if (state === "closed") policy.close();
    else signal.abort();
    const adapter = jest.fn();
    await expect(policy.execute(target, {}, adapter)).rejects.toBeInstanceOf(
      ToolPolicyDeniedError,
    );
    expect(adapter).not.toHaveBeenCalled();
  },
);

it("preserves unknown adapter errors and consumes approval before dispatch", async () => {
  const failure = new Error("response lost");
  let saved: ToolApproval | undefined;
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "mutating" }],
    requestApproval: (request) => (saved ??= approve(request)),
  });
  const adapter = jest.fn(async () => {
    throw failure;
  });
  await expect(policy.execute(target, {}, adapter)).rejects.toBe(failure);
  await expect(policy.execute(target, {}, adapter)).rejects.toBeInstanceOf(
    ToolPolicyDeniedError,
  );
  expect(adapter).toHaveBeenCalledTimes(1);
});

it.each([
  null,
  [],
  { value: undefined },
  { value: NaN },
  { value: new Date() },
  { value: () => 1 },
])("rejects non-JSON arguments %p", async (args) => {
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "read_only" }],
  });
  const adapter = jest.fn();
  await expect(
    policy.execute(target, args as any, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  expect(adapter).not.toHaveBeenCalled();
});

it("rejects cycles and getters without running them", async () => {
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "read_only" }],
  });
  const cycle: any = {};
  cycle.self = cycle;
  const getter = jest.fn(() => "value");
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get: getter,
  });
  const adapter = jest.fn();
  await expect(policy.execute(target, cycle, adapter)).rejects.toBeInstanceOf(
    ToolPolicyDeniedError,
  );
  await expect(
    policy.execute(target, accessor, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  expect(getter).not.toHaveBeenCalled();
  expect(adapter).not.toHaveBeenCalled();
});

it.each([
  ["symbol key", () => ({ [Symbol("hidden")]: "value" })],
  ["sparse array", () => ({ values: new Array(1) })],
  [
    "array extra property",
    () => ({ values: Object.assign([1], { extra: 2 }) }),
  ],
  [
    "array extra property replacing a hole",
    () => ({ values: Object.assign(new Array(1), { extra: 2 }) }),
  ],
  [
    "non-enumerable property",
    () => Object.defineProperty({}, "hidden", { value: 1 }),
  ],
] as const)(
  "rejects hidden or lossy JSON arguments: %s",
  async (_name, makeArgs) => {
    const adapter = jest.fn();
    const policy = createToolExecutionPolicy({
      registry: [{ target, risk: "read_only" }],
    });
    await expect(
      policy.execute(target, makeArgs(), adapter),
    ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
    expect(adapter).not.toHaveBeenCalled();
  },
);

it.each([
  null,
  { ...target, name: " " },
  { ...target, kind: "untrusted" },
  { ...target, server: null },
  ...[
    { id: " " },
    { name: 1 },
    { url: " " },
    { url: "invalid" },
    { url: "file:///private" },
    { token: 1 },
  ].map((fields) => ({
    ...target,
    server: {
      ...(target as Extract<ToolTarget, { kind: "mcp" }>).server,
      ...fields,
    },
  })),
  { ...builtin, name: "another_builtin" },
  { ...builtin, endpoint: null },
  ...[
    { providerId: " " },
    { baseUrl: 1 },
    { apiKey: null },
    { model: null },
    { folderId: 1 },
    { baseUrl: "invalid" },
  ].map((fields) => ({
    ...builtin,
    endpoint: {
      ...(builtin as Extract<ToolTarget, { kind: "builtin" }>).endpoint,
      ...fields,
    },
  })),
])("invalid target configuration grants no authority: %p", async (invalid) => {
  const adapter = jest.fn();
  const requestApproval = jest.fn(approve);
  const policy = createToolExecutionPolicy({
    registry: [{ target: invalid as ToolTarget, risk: "read_only" }],
    requestApproval,
  });
  await expect(
    policy.execute(invalid as ToolTarget, {}, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  await expect(policy.execute(target, {}, adapter)).rejects.toBeInstanceOf(
    ToolPolicyDeniedError,
  );
  expect(adapter).not.toHaveBeenCalled();
  expect(requestApproval).not.toHaveBeenCalled();
});

it.each(["duplicate", "conflicting", "unknown-risk"])(
  "fails closed for %s registry declarations",
  async (kind) => {
    const registry =
      kind === "unknown-risk"
        ? [{ target, risk: "unrecognized" as any }]
        : [
            { target, risk: "read_only" as const },
            {
              target: copy(target),
              risk:
                kind === "duplicate"
                  ? ("read_only" as const)
                  : ("mutating" as const),
            },
          ];
    const requestApproval = jest.fn(approve);
    const adapter = jest.fn();
    await expect(
      createToolExecutionPolicy({ registry, requestApproval }).execute(
        target,
        {},
        adapter,
      ),
    ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
    expect(adapter).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
  },
);

it.each([0, -1, NaN, Infinity])(
  "rejects invalid approval deadline %p without requesting a grant",
  async (approvalTimeoutMs) => {
    jest.useFakeTimers();
    const requestApproval = jest.fn(approve);
    const adapter = jest.fn();
    const policy = createToolExecutionPolicy({
      registry: [{ target, risk: "mutating" }],
      approvalTimeoutMs,
      requestApproval,
    });
    await expect(policy.execute(target, {}, adapter)).rejects.toBeInstanceOf(
      ToolPolicyDeniedError,
    );
    expect(adapter).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  },
);

it.each(["abort", "close"])(
  "rechecks %s after a grant settles and before adapter continuation",
  async (action) => {
    const controller = new AbortController();
    const adapter = jest.fn();
    const policy = createToolExecutionPolicy({
      registry: [{ target, risk: "mutating" }],
      signal: controller.signal,
      requestApproval: approve,
    });
    const result = policy.execute(target, {}, adapter);
    // The grant's Promise.then runs first; execute's await continuation remains queued.
    await Promise.resolve();
    if (action === "abort") controller.abort();
    else policy.close();
    await expect(result).rejects.toBeInstanceOf(ToolPolicyDeniedError);
    expect(adapter).not.toHaveBeenCalled();
  },
);

it("denies rejected asynchronous approval and releases its timer", async () => {
  jest.useFakeTimers();
  const adapter = jest.fn();
  const policy = createToolExecutionPolicy({
    registry: [{ target, risk: "mutating" }],
    requestApproval: async () => {
      throw new Error("private failure");
    },
  });
  await expect(policy.execute(target, {}, adapter)).rejects.toThrow(
    "Tool execution denied",
  );
  expect(adapter).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it("preserves JSON null and null-prototype arguments and omits unset optional target fields", async () => {
  const actual = copy(target) as Extract<ToolTarget, { kind: "mcp" }>;
  actual.server.token = undefined;
  const args = Object.assign(Object.create(null), {
    nullable: null,
    values: [false, 0, ""],
  });
  const adapter = jest.fn(async (_target, snapshotArgs) => snapshotArgs);
  const policy = createToolExecutionPolicy({
    registry: [{ target: actual, risk: "read_only" }],
  });
  await expect(policy.execute(actual, args, adapter)).resolves.toEqual(args);
  expect(adapter.mock.calls[0][0].server).not.toHaveProperty("token");
});

it("supports a known provider image endpoint with its optional folder bound into identity", async () => {
  const actual = copy(builtin) as Extract<ToolTarget, { kind: "builtin" }>;
  actual.endpoint.providerId = "openai";
  actual.endpoint.baseUrl = "";
  actual.endpoint.folderId = "folder";
  const adapter = jest.fn(async () => "image");
  const policy = createToolExecutionPolicy({
    registry: [{ target: actual, risk: "mutating" }],
    requestApproval: approve,
  });
  await expect(policy.execute(actual, {}, adapter)).resolves.toBe("image");
});

it("snapshots options without widening missing or invalid authority", async () => {
  expect(snapshotToolPolicyOptions()).toBeUndefined();
  expect(snapshotToolPolicyOptions(null as any)).toBeUndefined();
  expect(snapshotToolPolicyOptions({} as any)?.registry).toEqual([]);
  const requestApproval = jest.fn(approve);
  const controller = new AbortController();
  const options = {
    registry: [
      { target: null as any, risk: "read_only" as const },
      { target: copy(target), risk: "unexpected" as any },
    ],
    requestApproval,
    approvalTimeoutMs: 123,
    signal: controller.signal,
  };
  const captured = snapshotToolPolicyOptions(options)!;
  expect(captured.registry).toEqual([{ target, risk: "denied" }]);
  expect(Object.isFrozen(captured)).toBe(true);
  expect(Object.isFrozen(captured.registry)).toBe(true);
  expect(Object.isFrozen(captured.registry[0].target)).toBe(true);
  expect(captured.requestApproval).toBe(requestApproval);
  expect(captured.approvalTimeoutMs).toBe(123);
  expect(captured.signal).toBe(controller.signal);
  options.registry[1].risk = "read_only";
  const adapter = jest.fn();
  await expect(
    createToolExecutionPolicy(captured).execute(target, {}, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  await expect(
    createToolExecutionPolicy().execute(target, {}, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  await expect(
    createToolExecutionPolicy({} as any).execute(target, {}, adapter),
  ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
  expect(adapter).not.toHaveBeenCalled();
  expect(requestApproval).not.toHaveBeenCalled();
});

it("captures valid registry authority before caller configuration is reassigned", async () => {
  const registered = copy(target);
  const options = {
    registry: [{ target: registered, risk: "read_only" as const }],
  };
  const captured = snapshotToolPolicyOptions(options)!;
  if (registered.kind === "mcp")
    registered.server.url = "https://replacement.invalid/mcp";
  options.registry.length = 0;
  const adapter = jest.fn(async () => "original");
  const policy = createToolExecutionPolicy(captured);
  await expect(policy.execute(target, {}, adapter)).resolves.toBe("original");
  await expect(policy.execute(registered, {}, adapter)).rejects.toBeInstanceOf(
    ToolPolicyDeniedError,
  );
  expect(adapter).toHaveBeenCalledTimes(1);
});
