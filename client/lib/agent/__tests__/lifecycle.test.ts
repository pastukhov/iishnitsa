import { createAgentLifecycle, type AgentLifecycleEvent } from "../lifecycle";

describe("Agent lifecycle", () => {
  it("orders frozen metadata and ignores duplicate terminals and late states", () => {
    const times = [20, 19, 21];
    const events: AgentLifecycleEvent[] = [];
    const lifecycle = createAgentLifecycle({
      now: () => times.shift()!,
      createTraceId: () => "test-trace",
    });
    lifecycle.subscribe((event) => events.push(event));

    lifecycle.start();
    lifecycle.start();
    lifecycle.enter("ACT");
    lifecycle.finish("completed");
    lifecycle.finish("failed");
    lifecycle.enter("THINK");

    expect(events).toEqual([
      {
        type: "run_started",
        traceId: "test-trace",
        sequence: 1,
        timestampMs: 20,
      },
      {
        type: "state_entered",
        state: "ACT",
        traceId: "test-trace",
        sequence: 2,
        timestampMs: 19,
      },
      {
        type: "run_finished",
        outcome: "completed",
        traceId: "test-trace",
        sequence: 3,
        timestampMs: 21,
      },
    ]);
    expect(events.every(Object.isFrozen)).toBe(true);
  });

  it("isolates sync failures and honors unsubscribe", () => {
    const lifecycle = createAgentLifecycle();
    const observer = jest.fn();
    const throwing = jest.fn(() => {
      throw new Error("subscriber-secret");
    });
    const unsubscribeThrowing = lifecycle.subscribe(throwing);
    const unsubscribeObserver = lifecycle.subscribe(observer);

    lifecycle.start();
    unsubscribeThrowing();
    lifecycle.enter("ACT");
    unsubscribeObserver();
    lifecycle.finish("failed");

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledTimes(2);
  });
});
