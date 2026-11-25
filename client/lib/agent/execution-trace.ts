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
  | { type: "child_started" | "child_dispatched"; childId: string; depth: 1 }
  | {
      type: "child_finished";
      childId: string;
      depth: 1;
      outcome: "completed" | "failed" | "cancelled";
      dispatch: "not_dispatched" | "attempted";
      modelOutcome: BoundaryOutcome;
      durationMs: number;
    }
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
    child() {
      const childId = createTraceId();
      const childStart = Date.now();
      let done = false;
      let dispatched = false;
      let modelOutcome: BoundaryOutcome = "failed";
      emit({ type: "child_started", childId, depth: 1 });
      return {
        boundary: {
          dispatched() {
            if (done || dispatched) return;
            dispatched = true;
            modelOutcome = "unknown";
            emit({ type: "child_dispatched", childId, depth: 1 });
          },
          finish(outcome: BoundaryOutcome) {
            if (!done) modelOutcome = outcome;
          },
        },
        finish(outcome: "completed" | "failed" | "cancelled") {
          if (done) return;
          done = true;
          emit({
            type: "child_finished",
            childId,
            depth: 1,
            outcome,
            dispatch: dispatched ? "attempted" : "not_dispatched",
            modelOutcome,
            durationMs: elapsed(childStart),
          });
        },
      };
    },
    attempt(): AttemptTrace {
      const attemptId = createTraceId();
      const attemptStart = Date.now();
      let attemptFinished = false;
      const pending = new Set<() => void>();
      emit({ type: "attempt_started", attemptId });
      return {
        boundary(operation): BoundaryObserver {
          const operationId = createTraceId();
          const operationStart = Date.now();
          let operationFinished = false;
          let dispatched = false;
          const complete = (outcome: BoundaryOutcome) => {
            if (operationFinished) return;
            operationFinished = true;
            pending.delete(finalize);
            emit({
              type: "operation_finished",
              attemptId,
              operationId,
              operation,
              dispatch: dispatched ? "attempted" : "not_dispatched",
              outcome,
              durationMs: elapsed(operationStart),
            });
          };
          const finalize = () => complete(dispatched ? "unknown" : "failed");
          if (!attemptFinished) pending.add(finalize);
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
              complete(outcome);
            },
          };
        },
        finish(outcome) {
          if (attemptFinished) return;
          attemptFinished = true;
          for (const finalize of [...pending]) finalize();
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
