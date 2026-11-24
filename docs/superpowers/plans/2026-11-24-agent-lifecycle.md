# Agent lifecycle implementation plan

> **For agentic workers:** Use Superpowers test-driven development and execute this slice independently from the rest of #196.

**Goal:** Run AgentCore invocations independently and expose ordered, metadata-only lifecycle events.

**Architecture:** `lifecycle.ts` builds one ephemeral sequence per invocation using an injected clock and trace ID factory. `core.ts` owns local state, subscribes an optional callback, and emits terminal outcomes without changing execution.

**Tech stack:** TypeScript, Jest, Expo / React Native.

**Spec:** [Agent lifecycle design](../specs/2026-11-24-agent-lifecycle-design.md).

## Task 1: Per-invocation lifecycle and FSM state

- [ ] In `client/lib/agent/__tests__/core.test.ts`, overlap two runs while one waits in the driver. Finish the second first; verify each has its own event sequence and distinct streamed output. Check the full tool cycle separately with the existing fake MCP boundary. Add success/failure coverage for terminal-once, event order, preserved error instance even with a broken observer or clock, and absent sensitive data.
- [ ] In `client/lib/agent/__tests__/lifecycle.test.ts`, pin deterministic clock and trace, unsubscribe, observer failure isolation, and terminal idempotency.
- [ ] Run the two Jest suites and confirm failures for the missing behavior.
- [ ] In `client/lib/agent/lifecycle.ts`, implement `createAgentLifecycle(options?: AgentLifecycleOptions)` with `subscribe`, `start`, `enter`, and `finish`. Build every event from the closed metadata schema and increment sequence independently of wall-clock changes.
- [ ] In `client/lib/agent/core.ts`, replace instance FSM state with a local state, wire in `onLifecycleEvent`, and emit the terminal status while preserving existing failures.
- [ ] Run the new and adjacent SSE/replay/offline-queue suites; then run `npm run check:required`. Use the normal commit and push hooks.
