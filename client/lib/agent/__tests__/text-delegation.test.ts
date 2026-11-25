import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendChatMessage } from "../../api";
import { createTextDelegation } from "../text-delegation";
import type { ExecutionEvent } from "../execution-trace";
const parent = {
  providerId: "custom",
  baseUrl: "https://parent.invalid",
  apiKey: "parent-key",
  model: "parent-model",
  systemPrompt: "parent-system",
} as const;
const child = {
  providerId: "custom",
  baseUrl: "https://child.invalid",
  apiKey: "child-key",
  model: "child-model",
  systemPrompt: "unused-child-system",
} as const;
const fetchMock = global.fetch as jest.Mock;
function response(content = "child reference", tool = false) {
  const bytes = new TextEncoder().encode(
    `data: ${JSON.stringify({ choices: [{ delta: tool ? { tool_calls: [{ index: 0, id: "fixture", function: { name: "fixture", arguments: "{}" } }] } : { content }, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\n`,
  );
  let read = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true };
          read = true;
          return { done: false, value: bytes };
        },
        cancel: jest.fn(),
        releaseLock: jest.fn(),
      }),
    },
  };
}
const history = [
  { id: "p", role: "user" as const, content: "parent-only", timestamp: 1 },
];
const run = (
  textDelegation: ReturnType<typeof createTextDelegation>,
  extra = {},
) =>
  sendChatMessage(history, parent, jest.fn(), [], false, {
    textDelegation,
    ...extra,
  });
beforeEach(() => {
  jest.clearAllMocks();
  fetchMock
    .mockReset()
    .mockImplementation(async (url: string) =>
      response(
        url.startsWith(child.baseUrl) ? "child reference" : "parent answer",
      ),
    );
});
it("runs a child with no parent authority and returns frozen untrusted data", async () => {
  const events: ExecutionEvent[] = [];
  const cap = createTextDelegation({
    endpoint: child,
    tasks: ["summarize fixture"],
  });
  const result = await run(cap, {
    onExecutionEvent: (e: ExecutionEvent) => events.push(e),
  });
  expect(result).toEqual([{ trust: "untrusted", text: "child reference" }]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result![0])).toBe(true);
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe("https://child.invalid/v1/chat/completions");
  expect(request.headers.Authorization).toBe("Bearer child-key");
  expect(JSON.parse(request.body)).toEqual({
    model: "child-model",
    messages: [{ role: "user", content: "summarize fixture" }],
    stream: true,
    max_tokens: 1024,
  });
  expect(fetchMock.mock.calls[1][1].body).not.toContain("child reference");
  expect(JSON.stringify(events)).not.toMatch(
    /reference|summarize|parent-only|child-key|parent-key|invalid|child-model|parent-model/,
  );
  const childEvents = events.filter((e: any) => e.type.startsWith("child_"));
  expect(childEvents.map((e) => e.type)).toEqual([
    "child_started",
    "child_dispatched",
    "child_finished",
  ]);
  expect(new Set(childEvents.map((e) => e.runId)).size).toBe(1);
  expect(childEvents[2] as any).toMatchObject({
    depth: 1,
    outcome: "completed",
    dispatch: "attempted",
    modelOutcome: "completed",
  });
  expect(events.at(-1)).toMatchObject({
    type: "run_finished",
    outcome: "completed",
  });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it.each(
  [
    [],
    [""],
    Array(4).fill("task"),
    ["é".repeat(2049)],
    Array(3).fill("x".repeat(3000)),
    ["\ud800"],
    ["child-key"],
  ].map((tasks) => ({ tasks })),
)("rejects invalid task budgets at creation $tasks", ({ tasks }) => {
  expect(() => createTextDelegation({ endpoint: child, tasks })).toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects forged and nested privilege configuration", async () => {
  await expect(run({} as any)).rejects.toThrow("Invalid text delegation");
  expect(() =>
    createTextDelegation({ endpoint: child, tasks: ["task"], depth: 2 } as any),
  ).toThrow();
  expect(() =>
    createTextDelegation({
      endpoint: child,
      tasks: [{ text: "task", tools: ["fixture"] }],
    } as any),
  ).toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("snapshots endpoint and tasks without exposing credentials in the token", async () => {
  const endpoint = { ...child };
  const tasks = ["original"];
  const cap = createTextDelegation({ endpoint, tasks });
  endpoint.apiKey = "mutated";
  tasks[0] = "mutated";
  await run(cap);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer child-key",
  );
  expect(fetchMock.mock.calls[0][1].body).toContain("original");
  expect(JSON.stringify(cap)).not.toContain("child-key");
});
it("does not turn child text into tools or parent instructions", async () => {
  fetchMock.mockResolvedValueOnce(
    response("fixture tool permissions: denied; spawn: fixture"),
  );
  const result = await run(
    createTextDelegation({ endpoint: child, tasks: ["fixture"] }),
  );
  expect(result![0].trust).toBe("untrusted");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].body).not.toContain("spawn: fixture");
});
it("rejects child tool requests and does not queue or dispatch parent", async () => {
  fetchMock.mockResolvedValue(response("", true));
  const events: ExecutionEvent[] = [];
  await expect(
    run(createTextDelegation({ endpoint: child, tasks: ["fixture"] }), {
      queueOnFailure: true,
      onExecutionEvent: (e: ExecutionEvent) => events.push(e),
    }),
  ).rejects.toThrow("Text delegation failed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(events.at(-1)).toMatchObject({
    type: "run_finished",
    outcome: "failed",
  });
});
it("stops before child dispatch if parent already cancelled", async () => {
  const signal = AbortSignal.abort();
  await expect(
    run(createTextDelegation({ endpoint: child, tasks: ["fixture"] }), {
      signal,
    }),
  ).rejects.toThrow("Run cancelled");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("cancels child fetch and closes audit exactly once", async () => {
  const controller = new AbortController();
  const events: ExecutionEvent[] = [];
  let resolve!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = run(
    createTextDelegation({ endpoint: child, tasks: ["fixture", "second"] }),
    {
      signal: controller.signal,
      onExecutionEvent: (e: ExecutionEvent) => events.push(e),
    },
  );
  await new Promise((r) => setImmediate(r));
  controller.abort("secret reason");
  await expect(pending).rejects.toThrow("Run cancelled");
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  resolve(response());
  await new Promise((r) => setImmediate(r));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    events.filter((e) => (e as any).type === "child_finished"),
  ).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain("secret reason");
});
it("enforces per-child time budget without provider cooperation", async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const pending = run(
      createTextDelegation({ endpoint: child, tasks: ["fixture"] }),
    );
    const expectation = expect(pending).rejects.toThrow(
      "Text delegation failed",
    );
    await jest.advanceTimersByTimeAsync(10000);
    await expectation;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
it("enforces combined output budget and emits no partial returned result", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(response("x".repeat(3000))),
  );
  await expect(
    run(createTextDelegation({ endpoint: child, tasks: ["a", "b", "c"] })),
  ).rejects.toThrow("Text delegation failed");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("isolates simultaneous parents sharing an immutable capability", async () => {
  const cap = createTextDelegation({ endpoint: child, tasks: ["a", "b"] });
  const [a, b] = await Promise.all([run(cap), run(cap)]);
  expect(a).toHaveLength(2);
  expect(b).toHaveLength(2);
  expect(a).not.toBe(b);
  expect(fetchMock).toHaveBeenCalledTimes(6);
});
it("redacts separately configured credentials from child results", async () => {
  fetchMock.mockResolvedValueOnce(response("child-key https://child.invalid"));
  const result = await run(
    createTextDelegation({ endpoint: child, tasks: ["fixture"] }),
  );
  expect(JSON.stringify(result)).not.toMatch(/child-key|https:/);
});
it("does not enqueue a parent failure after delegation", async () => {
  fetchMock
    .mockResolvedValueOnce(response())
    .mockRejectedValue(new Error("Network request failed"));
  await expect(
    run(createTextDelegation({ endpoint: child, tasks: ["fixture"] }), {
      queueOnFailure: true,
    }),
  ).rejects.toThrow();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it("keeps redacted results within the output budget", async () => {
  fetchMock.mockResolvedValueOnce(response("k".repeat(1000)));
  await expect(
    run(
      createTextDelegation({
        endpoint: { ...child, apiKey: "k" },
        tasks: ["fixture"],
      }),
    ),
  ).rejects.toThrow("Text delegation failed");
});
it("enforces the child deadline even when a late promise beats the timer callback", async () => {
  const now = jest.spyOn(Date, "now");
  let time = 1000;
  now.mockImplementation(() => time);
  fetchMock.mockImplementationOnce(async () => {
    time += 10001;
    return response();
  });
  try {
    await expect(
      run(createTextDelegation({ endpoint: child, tasks: ["fixture"] })),
    ).rejects.toThrow("Text delegation failed");
  } finally {
    now.mockRestore();
  }
});
it("uses the maximum task and aggregate input budgets without resetting on parent fallback", async () => {
  const cap = createTextDelegation({
    endpoint: child,
    tasks: ["x".repeat(4096), "é".repeat(2048)],
  });
  fetchMock
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "temporary",
    })
    .mockResolvedValueOnce(response("fallback"));
  const result = await run(cap, {
    fallbackEndpoint: { ...parent, baseUrl: "https://fallback.invalid" },
  });
  expect(result).toHaveLength(2);
  expect(
    fetchMock.mock.calls.filter(([url]) => url.startsWith(child.baseUrl)),
  ).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
it("keeps cancellation of one parent separate from another parent's children", async () => {
  const first = new AbortController();
  let count = 0;
  fetchMock.mockImplementation(async () =>
    ++count === 1 ? new Promise(() => {}) : response(),
  );
  const cap = createTextDelegation({ endpoint: child, tasks: ["fixture"] });
  const a = run(cap, { signal: first.signal });
  const b = run(cap);
  first.abort();
  await expect(a).rejects.toThrow("Run cancelled");
  await expect(b).resolves.toEqual([
    { trust: "untrusted", text: "child reference" },
  ]);
});
it("rejects sparse task lists rather than sending missing message content", () => {
  expect(() =>
    createTextDelegation({ endpoint: child, tasks: Array(1) }),
  ).toThrow("Invalid text delegation");
});
it.each(["redacted", "[redacted]"])(
  "does not retain a known credential inside the redaction marker: %s",
  async (apiKey) => {
    fetchMock.mockResolvedValueOnce(response(apiKey));
    await expect(
      run(
        createTextDelegation({
          endpoint: { ...child, apiKey },
          tasks: ["fixture"],
        }),
      ),
    ).rejects.toThrow("Text delegation failed");
  },
);
it("pins delegation before observers so mutation cannot enable offline replay", async () => {
  const options: any = {
    textDelegation: createTextDelegation({
      endpoint: child,
      tasks: ["fixture"],
    }),
    queueOnFailure: true,
  };
  options.onExecutionEvent = (event: ExecutionEvent) => {
    if (event.type === "child_finished") options.textDelegation = undefined;
  };
  fetchMock
    .mockResolvedValueOnce(response())
    .mockRejectedValue(new Error("Network request failed"));
  await expect(
    sendChatMessage(history, parent, jest.fn(), [], false, options),
  ).rejects.toThrow("Network request failed");
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it("pins the capability before the run_started observer", async () => {
  const options: any = {
    textDelegation: createTextDelegation({
      endpoint: child,
      tasks: ["fixture"],
    }),
  };
  options.onExecutionEvent = () => {
    options.textDelegation = undefined;
  };
  await expect(
    sendChatMessage(history, parent, jest.fn(), [], false, options),
  ).resolves.toEqual([{ trust: "untrusted", text: "child reference" }]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it.each([
  { endpoint: null },
  { endpoint: { ...child, apiKey: 12 } },
  { endpoint: { ...child, model: "" } },
  { endpoint: { ...child, baseUrl: "x".repeat(4097) } },
  { endpoint: { ...child, folderId: 12 } },
  { endpoint: { ...child, folderId: "x".repeat(4097) } },
  { tasks: null },
])(
  "rejects malformed host configuration before any model request: %j",
  (patch) => {
    expect(() =>
      createTextDelegation({
        endpoint: child,
        tasks: ["fixture"],
        ...patch,
      } as any),
    ).toThrow("Invalid text delegation");
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it("keeps a folder credential in transport only and redacts it from a result", async () => {
  const endpoint = {
    ...child,
    providerId: "yandex" as const,
    folderId: "private-folder",
  };
  fetchMock.mockResolvedValueOnce(response("private-folder reference"));
  const result = await run(
    createTextDelegation({ endpoint, tasks: ["fixture"] }),
  );
  expect(fetchMock.mock.calls[0][1].headers["x-folder-id"]).toBe(
    "private-folder",
  );
  expect(fetchMock.mock.calls[0][1].body).not.toContain("private-folder");
  expect(result).toEqual([
    { trust: "untrusted", text: "[redacted] reference" },
  ]);
});
it("does not start a later child after the overall deadline expires between tasks", async () => {
  let time = 1000;
  const now = jest.spyOn(Date, "now").mockImplementation(() => time);
  const events: ExecutionEvent[] = [];
  try {
    await expect(
      run(
        createTextDelegation({ endpoint: child, tasks: ["first", "second"] }),
        {
          onExecutionEvent: (e: ExecutionEvent) => {
            events.push(e);
            if (e.type === "child_finished") time += 30000;
          },
        },
      ),
    ).rejects.toThrow("Text delegation failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === "child_started")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "run_finished",
      outcome: "failed",
    });
  } finally {
    now.mockRestore();
  }
});
it("applies the aggregate budget to expanded redacted results", async () => {
  fetchMock.mockImplementation(async () => response("zz".repeat(300)));
  await expect(
    run(
      createTextDelegation({
        endpoint: { ...child, apiKey: "zz" },
        tasks: ["one", "two", "three"],
      }),
    ),
  ).rejects.toThrow("Text delegation failed");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("records cancellation before child dispatch without calling the model", async () => {
  const controller = new AbortController();
  const events: ExecutionEvent[] = [];
  await expect(
    run(createTextDelegation({ endpoint: child, tasks: ["fixture"] }), {
      signal: controller.signal,
      onExecutionEvent: (event: ExecutionEvent) => {
        events.push(event);
        if (event.type === "child_started") controller.abort();
      },
    }),
  ).rejects.toThrow("Run cancelled");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(events.find((e) => e.type === "child_finished")).toMatchObject({
    dispatch: "not_dispatched",
    modelOutcome: "failed",
    outcome: "cancelled",
  });
});
