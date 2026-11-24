import { createTraceId } from "./observability";

export type BoundaryOutcome = "completed" | "failed" | "unknown" | "denied";
export type RunOutcome = "completed" | "failed" | "queued";
export interface BoundaryObserver {
  dispatched(): void;
  finish(outcome: BoundaryOutcome): void;
}
type Operation = "llm" | "mcp";
type AttemptOutcome = "completed" | "failed";
type Details =
  | { type: "run_started" }
  | { type: "run_finished"; outcome: RunOutcome; durationMs: number }
  | { type: "attempt_started"; attemptId: string }
  | {
      type: "attempt_finished";
      attemptId: string;
      outcome: AttemptOutcome;
      durationMs: number;
    }
  | {
      type: "operation_started" | "operation_dispatched";
      attemptId: string;
      operationId: string;
      operation: Operation;
    }
  | {
      type: "operation_finished";
      attemptId: string;
      operationId: string;
      operation: Operation;
      dispatch: "not_dispatched" | "attempted";
      outcome: BoundaryOutcome;
      durationMs: number;
    };
export type ExecutionEvent = Readonly<
  Details & { runId: string; sequence: number; timestampMs: number }
>;
export type ExecutionSubscriber = (event: ExecutionEvent) => void;
export interface AttemptTrace {
  boundary(operation: Operation): BoundaryObserver;
  finish(outcome: AttemptOutcome): void;
}

export function createExecutionTrace(subscriber?: ExecutionSubscriber) {
  const runId = createTraceId();
  const started = Date.now();
  let sequence = 0;
  let finished = false;
  const elapsed = (start: number) => Math.max(0, Date.now() - start);
  const emit = (details: Details, terminal = false) => {
    if (finished && !terminal) return;
    const event = Object.freeze({
      ...details,
      runId,
      sequence: ++sequence,
      timestampMs: Date.now(),
    });
    try {
      subscriber?.(event);
    } catch {
      /* Observability must not affect execution. */
    }
  };
  emit({ type: "run_started" });
  return {
    attempt(): AttemptTrace {
      const attemptId = createTraceId();
      const attemptStart = Date.now();
      let attemptFinished = false;
      emit({ type: "attempt_started", attemptId });
      return {
        boundary(operation): BoundaryObserver {
          const operationId = createTraceId();
          const operationStart = Date.now();
          let operationFinished = false;
          let dispatched = false;
          if (!attemptFinished)
            emit({
              type: "operation_started",
              attemptId,
              operationId,
              operation,
            });
          return {
            dispatched() {
              if (operationFinished || attemptFinished || dispatched) return;
              dispatched = true;
              emit({
                type: "operation_dispatched",
                attemptId,
                operationId,
                operation,
              });
            },
            finish(outcome) {
              if (operationFinished || attemptFinished) return;
              operationFinished = true;
              emit({
                type: "operation_finished",
                attemptId,
                operationId,
                operation,
                dispatch: dispatched ? "attempted" : "not_dispatched",
                outcome,
                durationMs: elapsed(operationStart),
              });
            },
          };
        },
        finish(outcome) {
          if (attemptFinished) return;
          attemptFinished = true;
          emit({
            type: "attempt_finished",
            attemptId,
            outcome,
            durationMs: elapsed(attemptStart),
          });
        },
      };
    },
    finish(outcome: RunOutcome) {
      if (finished) return;
      finished = true;
      emit(
        { type: "run_finished", outcome, durationMs: elapsed(started) },
        true,
      );
    },
  };
}
