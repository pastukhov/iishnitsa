export type EvalCase =
  | "sse_usage"
  | "usage_unknown"
  | "usage_partial"
  | "mcp_once"
  | "mcp_denied"
  | "fallback"
  | "mcp_unknown"
  | "cancel"
  | "cancel_before_dispatch"
  | "malformed"
  | "incomplete"
  | "incomplete_tool"
  | "parallel";
export interface Observation {
  dispatches: number;
  attempts: number;
  terminals: number;
  failed: boolean;
  operationOutcomes: string[];
  outputs: string[];
  runIds: string[];
  storageWrites: number;
  transportViolations: number;
  perRunIds: string[][];
  perRunTerminals: number[];
  runOutcomes: string[];
  operations: { operation: string; dispatch: string; outcome: string }[];
}
export class EvalInvariantError extends Error {
  constructor(readonly invariant: string) {
    super(invariant);
    this.name = "EvalInvariantError";
  }
}
export function verify(scenario: EvalCase, o: Observation): void {
  const requireInvariant = (condition: boolean, code: string) => {
    if (!condition) throw new EvalInvariantError(code);
  };
  requireInvariant(o.transportViolations === 0, "registered_transport_only");
  requireInvariant(o.storageWrites === 0, "no_storage_writes");
  if (scenario === "cancel_before_dispatch") {
    requireInvariant(
      o.failed &&
        o.attempts === 0 &&
        o.terminals === 0 &&
        o.operationOutcomes.length === 0,
      "cancel_before_dispatch",
    );
    return;
  }
  requireInvariant(
    o.terminals === (scenario === "parallel" ? 2 : 1),
    "one_terminal_per_run",
  );
  requireInvariant(
    new Set(o.runIds).size === (scenario === "parallel" ? 2 : 1),
    "run_correlation",
  );
  requireInvariant(
    o.attempts === (scenario === "fallback" || scenario === "parallel" ? 2 : 1),
    "attempt_count",
  );
  if (scenario === "mcp_once")
    requireInvariant(o.dispatches === 1, "mcp_dispatch_once");
  else if (scenario === "mcp_unknown")
    requireInvariant(
      o.dispatches === 1 && o.failed && o.operationOutcomes.includes("unknown"),
      "unknown_mcp_no_replay",
    );
  else requireInvariant(o.dispatches === 0, "no_tool_dispatch");
  if (scenario === "malformed" || scenario === "incomplete_tool")
    requireInvariant(
      o.failed && o.operationOutcomes.includes("unknown"),
      scenario === "malformed"
        ? "malformed_rejected"
        : "incomplete_tool_rejected",
    );
  else if (scenario === "incomplete")
    requireInvariant(
      !o.failed && o.operationOutcomes.includes("unknown"),
      "incomplete_truthful_unknown",
    );
  else if (scenario === "cancel")
    requireInvariant(
      o.failed && o.operationOutcomes.includes("unknown"),
      "cancel_pending_reader",
    );
  else if (scenario === "parallel")
    requireInvariant(
      o.outputs.join("|") === "answer-a|answer-b",
      "parallel_output_isolation",
    );
  else if (scenario !== "mcp_unknown")
    requireInvariant(
      !o.failed &&
        o.outputs[0] === (scenario === "sse_usage" ? "answer😀" : "answer"),
      "expected_answer",
    );
  requireInvariant(
    o.perRunIds.length === (scenario === "parallel" ? 2 : 1) &&
      o.perRunIds.every((ids) => new Set(ids).size === 1) &&
      new Set(o.perRunIds.map((ids) => ids[0])).size === o.perRunIds.length,
    "per_callback_correlation",
  );
  requireInvariant(
    o.perRunTerminals.every((count) => count === 1),
    "per_callback_terminal",
  );
  const expectedOutcome = [
    "malformed",
    "incomplete_tool",
    "cancel",
    "mcp_unknown",
  ].includes(scenario)
    ? "failed"
    : "completed";
  requireInvariant(
    o.runOutcomes.every((outcome) => outcome === expectedOutcome),
    "run_outcome",
  );
  if (scenario === "mcp_denied")
    requireInvariant(
      o.operations.some(
        (operation) =>
          operation.operation === "mcp" &&
          operation.dispatch === "not_dispatched" &&
          operation.outcome === "denied",
      ),
      "policy_denial_boundary",
    );
  if (
    [
      "sse_usage",
      "usage_unknown",
      "usage_partial",
      "mcp_once",
      "parallel",
    ].includes(scenario)
  )
    requireInvariant(
      o.operations.every((operation) => operation.outcome === "completed"),
      "successful_operations_completed",
    );
}
