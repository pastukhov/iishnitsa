import { jsonResponse as json } from "./fixtures/http-response";
import {
  verify,
  EvalInvariantError,
  type Observation,
  type EvalCase,
} from "./fixtures/harness-oracle";
import fs from "node:fs";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendChatMessage } from "../api";
import { AgentCore } from "../agent/core";
import { OpenAICompatibleDriver } from "../agent/openai-driver";
import { MCPClient, clearClientCache } from "../mcp-client";
import type { ExecutionEvent } from "../agent/execution-trace";
import type { EndpointConfig, MCPServer, Message } from "../store";
import type { LLMUsage } from "../agent/types";

let verifiedOracles = 0;
let verifiedGuards = 0;
let completedReport: string | undefined;
const valid: Observation = {
  dispatches: 1,
  attempts: 1,
  terminals: 1,
  failed: false,
  operationOutcomes: ["completed"],
  outputs: ["answer"],
  runIds: ["one"],
  storageWrites: 0,
  transportViolations: 0,
  perRunIds: [["one"]],
  perRunTerminals: [1],
  runOutcomes: ["completed"],
  operations: [
    { operation: "llm", dispatch: "attempted", outcome: "completed" },
  ],
};
it.each([
  ["mcp_once", { ...valid, dispatches: 2 }, "mcp_dispatch_once"],
  ["malformed", { ...valid, dispatches: 0 }, "malformed_rejected"],
  [
    "parallel",
    {
      ...valid,
      dispatches: 0,
      attempts: 2,
      terminals: 2,
      outputs: ["answer-a", "answer-a"],
      runIds: ["one", "two"],
    },
    "parallel_output_isolation",
  ],
] as const)(
  "oracle rejects %s regression",
  (scenario, observation, invariant) => {
    expect(() => verify(scenario, observation)).toThrow(
      new EvalInvariantError(invariant),
    );
    verifiedOracles++;
  },
);

const endpoint: EndpointConfig = {
  providerId: "custom",
  baseUrl: "https://eval-primary.invalid/v1",
  apiKey: "eval-private-key",
  model: "fixture",
};
const fallback: EndpointConfig = {
  ...endpoint,
  baseUrl: "https://eval-fallback.invalid/v1",
  apiKey: "eval-private-fallback-key",
};
const server: MCPServer = {
  id: "eval",
  name: "fixture",
  url: "https://eval-mcp.invalid",
  token: "eval-private-token",
  enabled: true,
};
const transport = global.fetch as jest.Mock;
const originalDriver = OpenAICompatibleDriver.prototype.streamChat;
const originalTool = MCPClient.prototype.callTool;
const originalRun = AgentCore.prototype.runChat;
type Mutation =
  | "duplicate_dispatch"
  | "accept_bad_sse"
  | "cross_session"
  | "complete_incomplete"
  | "retry_primary"
  | "remove_storage";
const cases: EvalCase[] = [
  "sse_usage",
  "usage_unknown",
  "usage_partial",
  "mcp_once",
  "mcp_denied",
  "fallback",
  "mcp_unknown",
  "cancel_before_dispatch",
  "cancel",
  "malformed",
  "incomplete",
  "incomplete_tool",
  "parallel",
];
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const delta = (content: string) => frame({ choices: [{ delta: { content } }] });
const toolFrame = () =>
  frame({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call",
              type: "function",
              function: { name: "eval__inspect", arguments: "{}" },
            },
          ],
        },
      },
    ],
  });
interface UsageMeasurement {
  status: "known" | "partial" | "unknown";
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}
interface Measurement {
  scenario: EvalCase;
  status: "passed";
  metrics: {
    simulatedLatencyMs: number;
    firstOutputMs: number | null;
    llmDispatches: number;
    mcpDispatches: number;
    attempts: number;
    terminalEvents: number;
    storageWrites: number;
    transportViolations: number;
    runOutcomes: string[];
    operations: { operation: string; dispatch: string; outcome: string }[];
    usage: UsageMeasurement;
    calls: ({ request: number; invocation: number } & UsageMeasurement)[];
    cost: { status: "unknown"; reason: "no_price_configuration" };
  };
}
function usageFields(values: (LLMUsage | undefined)[]): UsageMeasurement {
  const sum = (key: keyof LLMUsage) =>
    values.length > 0 &&
    values.every(
      (value) =>
        typeof value?.[key] === "number" &&
        Number.isFinite(value[key]) &&
        value[key]! >= 0,
    )
      ? values.reduce((total, value) => total + value![key]!, 0)
      : null;
  const promptTokens = sum("promptTokens"),
    completionTokens = sum("completionTokens"),
    totalTokens = sum("totalTokens");
  const present = [promptTokens, completionTokens, totalTokens].filter(
    (value) => value !== null,
  ).length;
  return {
    status: present === 3 ? "known" : present === 0 ? "unknown" : "partial",
    promptTokens,
    completionTokens,
    totalTokens,
  };
}
async function exercise(
  scenario: EvalCase,
  mutation?: Mutation,
): Promise<{ observation: Observation; measurement: Measurement }> {
  clearClientCache();
  let clock = 1700000000000;
  const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
  const begin = clock;
  let firstOutput: number | null = null;
  let dispatches = 0;
  let llmDispatches = 0;
  let storageWrites = 0;
  let transportViolations = 0;
  const events: ExecutionEvent[] = [];
  const outputs: string[] = [];
  const usage: { request: number; invocation: number; value?: LLMUsage }[] = [];
  const perRunEvents: ExecutionEvent[][] = [[], []];
  const abort = new AbortController();
  const guardedWrites = [
    "setItem",
    "removeItem",
    "mergeItem",
    "clear",
    "multiSet",
    "multiRemove",
    "multiMerge",
  ]
    .map((name) => (AsyncStorage as unknown as Record<string, unknown>)[name])
    .filter((method): method is jest.Mock => typeof method === "function")
    .map((method) => {
      if (!jest.isMockFunction(method))
        throw new EvalInvariantError("native_storage_not_mocked");
      const previous = method.getMockImplementation();
      method.mockImplementation(async () => {
        storageWrites++;
        throw Error("storage disabled");
      });
      return () =>
        method.mockImplementation(previous ?? (async () => undefined));
    });
  const getItem = AsyncStorage.getItem as jest.Mock;
  getItem.mockImplementation(async () => null);
  const driver = jest
    .spyOn(OpenAICompatibleDriver.prototype, "streamChat")
    .mockImplementation(async function (input) {
      const record: { request: number; invocation: number; value?: LLMUsage } =
        {
          request: input.messages.some(
            (message) =>
              message.role === "user" && message.content === "session-b",
          )
            ? 1
            : 0,
          invocation: usage.length,
        };
      usage.push(record);
      try {
        if (mutation === "remove_storage")
          await AsyncStorage.removeItem("synthetic-eval-key");
        const actual =
          mutation === "retry_primary" ? { ...input, endpoint } : input;
        const result = await originalDriver.call(this, actual);
        record.value = result.usage;
        return result;
      } catch (error) {
        if (mutation === "accept_bad_sse")
          return { fullContent: "accepted", toolCalls: [] };
        throw error;
      }
    });
  const tool =
    mutation === "duplicate_dispatch"
      ? jest
          .spyOn(MCPClient.prototype, "callTool")
          .mockImplementation(async function (...args) {
            const first = await originalTool.apply(this, args);
            await originalTool.apply(this, args);
            return first;
          })
      : undefined;
  let firstInput: Parameters<AgentCore["runChat"]>[0] | undefined;
  const run =
    mutation === "cross_session"
      ? jest
          .spyOn(AgentCore.prototype, "runChat")
          .mockImplementation(function (input) {
            firstInput ??= input;
            return originalRun.call(this, {
              ...input,
              messages: firstInput.messages,
            });
          })
      : undefined;
  let releaseParallel!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    releaseParallel = resolve;
  });
  function sse(text: string, readCancelled = false): Response {
    const bytes = new TextEncoder().encode(text);
    let index = 0;
    // Single-byte chunks deliberately split fields, JSON and multibyte UTF-8.
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      body: {
        getReader: () => ({
          read: async () => {
            clock += 2;
            if (readCancelled) {
              abort.abort();
              return new Promise(() => {});
            }
            if (index === bytes.length) return { done: true, value: undefined };
            const value = bytes.slice(index, index + 1);
            index++;
            return { done: false, value };
          },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    } as unknown as Response;
  }
  transport.mockImplementation(async (url: string, init: RequestInit) => {
    clock += 5;
    if (init?.method !== "POST" || typeof init.body !== "string") {
      transportViolations++;
      throw new EvalInvariantError("unregistered_transport_request");
    }
    let request: any;
    try {
      request = JSON.parse(init.body);
    } catch {
      transportViolations++;
      throw new EvalInvariantError("unregistered_transport_request");
    }
    if (url === server.url) {
      if (request.method === "notifications/initialized") return json({});
      let result: unknown;
      if (request.method === "initialize")
        result = {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "fixture" },
          capabilities: {},
        };
      else if (request.method === "tools/list")
        result = {
          tools: [
            {
              name: "inspect",
              description: "synthetic read-only",
              inputSchema: { type: "object" },
            },
          ],
        };
      else if (request.method === "tools/call") {
        dispatches++;
        expect(request.params).toEqual({ name: "inspect", arguments: {} });
        if (scenario === "mcp_unknown") throw Error("Failed to fetch");
        result = { content: [{ type: "text", text: "synthetic result" }] };
      } else {
        transportViolations++;
        throw new EvalInvariantError("unregistered_transport_method");
      }
      return json({ jsonrpc: "2.0", id: request.id, result });
    }
    if (
      ![
        `${endpoint.baseUrl}/chat/completions`,
        `${fallback.baseUrl}/chat/completions`,
      ].includes(url)
    ) {
      transportViolations++;
      throw new EvalInvariantError("unregistered_transport_url");
    }
    llmDispatches++;
    const selected =
      scenario === "fallback" && llmDispatches === 2 ? fallback : endpoint;
    if (
      url !== `${selected.baseUrl}/chat/completions` ||
      (init.headers as Record<string, string>).Authorization !==
        `Bearer ${selected.apiKey}`
    ) {
      transportViolations++;
      throw new EvalInvariantError("wrong_endpoint_or_credentials");
    }
    if (scenario === "fallback" && llmDispatches === 1)
      return json({ error: { message: "synthetic failure" } }, 503);
    if (
      ["mcp_once", "mcp_denied", "mcp_unknown"].includes(scenario) &&
      llmDispatches === 1
    )
      return sse(toolFrame() + "data: [DONE]\n\n");
    if (scenario === "mcp_unknown")
      return json({ error: { message: "synthetic failure" } }, 503);
    if (scenario === "cancel") return sse("", true);
    if (scenario === "malformed")
      return sse(toolFrame() + "data: {broken}\n\n");
    if (scenario === "incomplete") return sse(delta("partial"));
    if (scenario === "incomplete_tool") return sse(toolFrame());
    if (scenario === "parallel") {
      if (llmDispatches === 2) releaseParallel();
      await bothStarted;
      const marker = request.messages.find(
        (message: { role: string }) => message.role === "user",
      ).content;
      return sse(
        delta(marker === "session-a" ? "answer-a" : "answer-b") +
          frame({
            choices: [],
            usage:
              marker === "session-a"
                ? { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
                : { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
          }) +
          "data: [DONE]\n\n",
      );
    }
    return sse(
      delta(scenario === "sse_usage" ? "answer😀" : "answer") +
        (scenario === "sse_usage"
          ? frame({
              choices: [],
              usage: {
                prompt_tokens: 5,
                completion_tokens: 3,
                total_tokens: 8,
              },
            })
          : scenario === "usage_partial"
            ? frame({ choices: [], usage: { prompt_tokens: 5 } })
            : "") +
        "data: [DONE]\n\n",
    );
  });
  const useMcp = [
    "mcp_once",
    "mcp_denied",
    "mcp_unknown",
    "malformed",
    "incomplete_tool",
  ].includes(scenario);
  const options = {
    signal: abort.signal,
    memorySettings: {
      enabled: false,
      autoSave: false,
      autoSummary: false,
      limit: 8,
      minImportance: 0,
    },
    queueOnFailure: true,
    fallbackEndpoint: fallback,

    toolPolicy: {
      registry:
        scenario === "mcp_denied"
          ? []
          : [
              {
                target: { kind: "mcp" as const, name: "inspect", server },
                risk: "read_only" as const,
              },
            ],
    },
  };
  const send = async (label: string, index: number) => {
    const messages: Message[] = [
      {
        id: `message-${index}`,
        role: "user",
        content: label,
        timestamp: "2000-01-01T00:00:00.000Z",
      },
    ];
    await sendChatMessage(
      messages,
      endpoint,
      (text) => {
        if (firstOutput === null) firstOutput = clock - begin;
        outputs[index] = text;
      },
      useMcp ? [server] : [],
      useMcp,
      {
        ...options,
        onExecutionEvent: (event: ExecutionEvent) => {
          const captured =
            mutation === "complete_incomplete" &&
            event.type === "operation_finished" &&
            event.outcome === "unknown"
              ? { ...event, outcome: "completed" as const }
              : event;
          events.push(captured);
          perRunEvents[index].push(captured);
        },
      },
    );
  };
  let failed = false;
  try {
    if (scenario === "cancel_before_dispatch") abort.abort();
    try {
      if (scenario === "parallel")
        await Promise.all([send("session-a", 0), send("session-b", 1)]);
      else await send("synthetic request", 0);
    } catch {
      failed = true;
    }
    const observation: Observation = {
      dispatches,
      attempts: events.filter((e) => e.type === "attempt_started").length,
      terminals: events.filter((e) => e.type === "run_finished").length,
      failed,
      operationOutcomes: events
        .filter((e) => e.type === "operation_finished")
        .map((e) => e.outcome),
      outputs,
      runIds: events.map((e) => e.runId),
      storageWrites,
      transportViolations,
      perRunIds: perRunEvents
        .filter((list) => list.length)
        .map((list) => list.map((event) => event.runId)),
      perRunTerminals: perRunEvents
        .filter((list) => list.length)
        .map(
          (list) =>
            list.filter((event) => event.type === "run_finished").length,
        ),
      runOutcomes: events
        .filter((event) => event.type === "run_finished")
        .map((event) => event.outcome),
      operations: events
        .filter((event) => event.type === "operation_finished")
        .map((event) => ({
          operation: event.operation,
          dispatch: event.dispatch,
          outcome: event.outcome,
        })),
    };
    const measurement: Measurement = {
      scenario,
      status: "passed",
      metrics: {
        simulatedLatencyMs: clock - begin,
        firstOutputMs: firstOutput,
        llmDispatches,
        mcpDispatches: dispatches,
        attempts: observation.attempts,
        terminalEvents: observation.terminals,
        storageWrites,
        transportViolations,
        runOutcomes: observation.runOutcomes,
        operations: observation.operations,
        usage: usageFields(usage.map((record) => record.value)),
        calls: usage.map((record) => ({
          request: record.request,
          invocation: record.invocation,
          ...usageFields([record.value]),
        })),
        cost: { status: "unknown", reason: "no_price_configuration" },
      },
    };
    return { observation, measurement };
  } finally {
    abort.abort();
    driver.mockRestore();
    tool?.mockRestore();
    run?.mockRestore();
    now.mockRestore();
    clearClientCache();
    transport.mockReset();
    for (const restore of guardedWrites) restore();
    getItem.mockReset().mockResolvedValue(null);
  }
}

it("evaluates the real mobile entry point and proves four bounded mutation probes", async () => {
  const scenarios: Measurement[] = [];
  for (const scenario of cases) {
    const { observation, measurement } = await exercise(scenario);
    verify(scenario, observation);
    scenarios.push(measurement);
  }
  expect(
    scenarios.find((row) => row.scenario === "sse_usage")!.metrics.usage,
  ).toEqual({
    status: "known",
    promptTokens: 5,
    completionTokens: 3,
    totalTokens: 8,
  });
  expect(
    scenarios.find((row) => row.scenario === "usage_unknown")!.metrics.usage,
  ).toEqual({
    status: "unknown",
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  });
  expect(
    scenarios.find((row) => row.scenario === "usage_partial")!.metrics.usage,
  ).toEqual({
    status: "partial",
    promptTokens: 5,
    completionTokens: null,
    totalTokens: null,
  });
  expect(
    scenarios.find((row) => row.scenario === "parallel")!.metrics.calls,
  ).toEqual([
    {
      request: 0,
      invocation: 0,
      status: "known",
      promptTokens: 2,
      completionTokens: 1,
      totalTokens: 3,
    },
    {
      request: 1,
      invocation: 1,
      status: "known",
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9,
    },
  ]);
  // Fake fetch advances 5 ms and each single-byte read/EOF advances 2 ms.
  // These fixed fixture expectations detect missing reads/dispatches or timing drift.
  const expectedTiming: Record<EvalCase, readonly [number, number | null]> = {
    sse_usage: [325, 117],
    usage_unknown: [139, 109],
    usage_partial: [239, 109],
    mcp_once: [480, 336],
    mcp_denied: [475, 336],
    fallback: [144, 114],
    mcp_unknown: [346, 336],
    cancel_before_dispatch: [0, null],
    cancel: [7, null],
    malformed: [338, null],
    incomplete: [113, 111],
    incomplete_tool: [308, null],
    parallel: [642, 226],
  };
  for (const row of scenarios) {
    expect([row.metrics.simulatedLatencyMs, row.metrics.firstOutputMs]).toEqual(
      expectedTiming[row.scenario],
    );
    expect(row.metrics.llmDispatches).toBe(
      row.scenario === "cancel_before_dispatch"
        ? 0
        : [
              "mcp_once",
              "mcp_denied",
              "mcp_unknown",
              "fallback",
              "parallel",
            ].includes(row.scenario)
          ? 2
          : 1,
    );
  }
  const mutationProbes = [];
  for (const [mutation, scenario, invariant] of [
    ["duplicate_dispatch", "mcp_once", "mcp_dispatch_once"],
    ["accept_bad_sse", "malformed", "malformed_rejected"],
    ["cross_session", "parallel", "parallel_output_isolation"],
    ["complete_incomplete", "incomplete", "incomplete_truthful_unknown"],
  ] as const) {
    const { observation } = await exercise(scenario, mutation);
    expect(() => verify(scenario, observation)).toThrow(
      new EvalInvariantError(invariant),
    );
    mutationProbes.push({ mutation, status: "detected", invariant });
  }
  const report = {
    schemaVersion: 1,
    status: "passed",
    scenarios,
    mutationProbes,
  };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  expect(serialized).not.toMatch(
    /eval-private|https:|synthetic request|answer😀|session-a/,
  );
  completedReport = serialized;
}, 20000);

it.each([
  ["retry_primary", "fallback", "registered_transport_only"],
  ["remove_storage", "usage_unknown", "no_storage_writes"],
] as const)(
  "guard detects %s even if the API catches its error",
  async (mutation, scenario, invariant) => {
    const { observation } = await exercise(scenario, mutation);
    expect(() => verify(scenario, observation)).toThrow(
      new EvalInvariantError(invariant),
    );
    verifiedGuards++;
  },
);
it.each([
  [{ ...valid, storageWrites: 1 }, "no_storage_writes"],
  [{ ...valid, transportViolations: 1 }, "registered_transport_only"],
] as const)(
  "oracle rejects independent side-effect violation %p",
  (observation, invariant) => {
    expect(() => verify("mcp_once", observation)).toThrow(
      new EvalInvariantError(invariant),
    );
    verifiedOracles++;
  },
);

afterAll(() => {
  if (
    process.env.HARNESS_EVAL_REPORT &&
    completedReport &&
    verifiedOracles === 5 &&
    verifiedGuards === 2
  )
    fs.writeFileSync(process.env.HARNESS_EVAL_REPORT, completedReport, "utf8");
});
