import {
  createToolExecutionPolicy,
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
