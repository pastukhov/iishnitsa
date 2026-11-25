import { createExecutionTrace } from "../execution-trace";

describe("execution traces", () => {
  it("keeps local identities and one frozen final event despite observer failures", () => {
    const events: any[] = [];
    const trace = createExecutionTrace((event) => {
      events.push(event);
      throw new Error("subscriber-secret");
    });
    const attempt = trace.attempt();
    const operation = attempt.boundary("mcp");
    operation.dispatched();
    operation.finish("unknown");
    operation.finish("completed");
    attempt.finish("failed");
    attempt.finish("completed");
    trace.finish("failed");
    trace.finish("completed");
    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "attempt_started",
      "operation_started",
      "operation_dispatched",
      "operation_finished",
      "attempt_finished",
      "run_finished",
    ]);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.every(Object.isFrozen)).toBe(true);
    expect(new Set(events.map((e) => e.runId)).size).toBe(1);
    expect(events[4]).toMatchObject({
      dispatch: "attempted",
      outcome: "unknown",
      operation: "mcp",
    });
    expect(events[4].durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(events)).not.toContain("secret");
    const other: any[] = [];
    createExecutionTrace((e) => other.push(e)).finish("completed");
    expect(other[0].runId).not.toBe(events[0].runId);
  });

  it("records denial without an execution and ignores operations after finalization", () => {
    const events: any[] = [];
    const trace = createExecutionTrace((e) => events.push(e));
    const attempt = trace.attempt();
    const boundary = attempt.boundary("mcp");
    boundary.finish("denied");
    boundary.dispatched();
    attempt.finish("completed");
    trace.finish("completed");
    attempt.boundary("llm").dispatched();
    expect(events.filter((e) => e.type === "operation_dispatched")).toEqual([]);
    expect(events.filter((e) => e.type === "operation_finished")).toEqual([
      expect.objectContaining({
        dispatch: "not_dispatched",
        outcome: "denied",
      }),
    ]);
    expect(events.at(-1).type).toBe("run_finished");
  });
});

test("a terminal observer cannot reenter finish to produce another final event", () => {
  const events: any[] = [];
  const trace = createExecutionTrace((event) => {
    events.push(event);
    if (event.type === "run_finished") trace.finish("failed");
  });
  trace.finish("completed");
  expect(events.filter((e) => e.type === "run_finished")).toHaveLength(1);
});

test("attempt finalization closes pending operations before its terminal event and ignores late evidence", () => {
  const events: any[] = [];
  const trace = createExecutionTrace((event) => events.push(event));
  const attempt = trace.attempt();
  const waiting = attempt.boundary("mcp");
  const sent = attempt.boundary("llm");
  sent.dispatched();
  attempt.finish("failed");
  waiting.dispatched();
  waiting.finish("completed");
  sent.finish("completed");
  trace.finish("failed");
  expect(events.filter((event) => event.type === "operation_finished")).toEqual(
    [
      expect.objectContaining({
        operation: "mcp",
        dispatch: "not_dispatched",
        outcome: "failed",
      }),
      expect.objectContaining({
        operation: "llm",
        dispatch: "attempted",
        outcome: "unknown",
      }),
    ],
  );
  expect(events.slice(-4).map((event) => event.type)).toEqual([
    "operation_finished",
    "operation_finished",
    "attempt_finished",
    "run_finished",
  ]);
});

test("operation finalization observers cannot duplicate or reopen attempt boundaries", () => {
  const events: any[] = [];
  let attempt: ReturnType<ReturnType<typeof createExecutionTrace>["attempt"]>;
  const trace = createExecutionTrace((event) => {
    events.push(event);
    if (event.type === "operation_finished") {
      attempt.finish("completed");
      attempt.boundary("llm").dispatched();
    }
  });
  attempt = trace.attempt();
  attempt.boundary("mcp");
  attempt.finish("failed");
  trace.finish("failed");
  expect(
    events.filter((event) => event.type === "operation_started"),
  ).toHaveLength(1);
  expect(
    events.filter((event) => event.type === "operation_finished"),
  ).toHaveLength(1);
  expect(
    events.filter((event) => event.type === "attempt_finished"),
  ).toHaveLength(1);
});
