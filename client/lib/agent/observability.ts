export type AgentLogLevel = "info" | "warn" | "error";

export function createTraceId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `trace_${now}_${rand}`;
}

export function logAgentEvent(
  level: AgentLogLevel,
  event: string,
  payload: Record<string, any>,
): void {
  const logger = console[level] ?? console.log;
  logger("agent_trace", {
    event,
    ...payload,
  });
}
