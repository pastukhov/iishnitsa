import { createTraceId } from "./observability";
import type { AgentState } from "./types";

type ActiveAgentState = Exclude<AgentState, "IDLE">;
type RunOutcome = "completed" | "failed";

type LifecycleDetails =
  | { type: "run_started" }
  | { type: "state_entered"; state: ActiveAgentState }
  | { type: "run_finished"; outcome: RunOutcome };

export type AgentLifecycleEvent = Readonly<
  LifecycleDetails & { traceId: string; sequence: number; timestampMs: number }
>;

/** Synchronous observer; schedule and handle any asynchronous work separately. */
export type AgentLifecycleSubscriber = (event: AgentLifecycleEvent) => void;

export interface AgentLifecycleOptions {
  now?: () => number;
  createTraceId?: () => string;
}

function safeRead<T>(read: () => T, fallback: () => T): T {
  try {
    return read();
  } catch {
    return fallback();
  }
}

export function createAgentLifecycle({
  now = Date.now,
  createTraceId: nextTraceId = createTraceId,
}: AgentLifecycleOptions = {}) {
  const traceId = safeRead(nextTraceId, createTraceId);
  const subscribers = new Set<AgentLifecycleSubscriber>();
  let phase: "idle" | "running" | "finished" = "idle";
  let sequence = 0;

  function emit(details: LifecycleDetails): void {
    const event: AgentLifecycleEvent = Object.freeze({
      ...details,
      traceId,
      sequence: ++sequence,
      timestampMs: safeRead(now, Date.now),
    });

    for (const subscriber of [...subscribers]) {
      try {
        subscriber(event);
      } catch {
        // Observers must not interrupt agent execution or expose their errors.
      }
    }
  }

  return {
    subscribe(subscriber: AgentLifecycleSubscriber): () => void {
      if (phase !== "finished") subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    start(): void {
      if (phase !== "idle") return;
      phase = "running";
      emit({ type: "run_started" });
    },
    enter(state: ActiveAgentState): void {
      if (phase === "running") emit({ type: "state_entered", state });
    },
    finish(outcome: RunOutcome): void {
      if (phase !== "running") return;
      phase = "finished";
      emit({ type: "run_finished", outcome });
      subscribers.clear();
    },
  };
}
