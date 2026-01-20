import { createTraceId, logAgentEvent } from "../observability";

describe("observability", () => {
  it("creates trace ids", () => {
    const traceId = createTraceId();
    expect(traceId).toMatch(/^trace_/);
  });

  it("logs via console level", () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    logAgentEvent("info", "test_event", { foo: "bar" });

    expect(infoSpy).toHaveBeenCalledWith("agent_trace", {
      event: "test_event",
      foo: "bar",
    });

    infoSpy.mockRestore();
  });

  it("falls back to console.log when level is missing", () => {
    const originalInfo = console.info;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    (console as any).info = undefined;

    logAgentEvent("info", "fallback_event", { value: 1 });

    expect(logSpy).toHaveBeenCalledWith("agent_trace", {
      event: "fallback_event",
      value: 1,
    });

    (console as any).info = originalInfo;
    logSpy.mockRestore();
  });
});
