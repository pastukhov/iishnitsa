# Attempt tracing implementation plan

> **For agentic workers:** use test-first implementation with independent review before publication.

**Goal:** Correlate optional endpoint fallback and truthful transport boundaries for #198.
**Architecture:** Invocation-local logical trace, per-attempt observer, transport dispatch/outcome metadata. One explicit optional fallback with conservative typed HTTP eligibility.
**Tech Stack:** TypeScript and existing Jest; no dependencies.
**Spec:** ../specs/2026-11-24-attempt-tracing-design.md

## Constraints and review focus

Preserve original queue/replay latch. Never retry unknown tool outcomes, partial output, cancellation or auth/validation errors. Keep credentials per endpoint, events allowlisted and concurrent contexts separate. Preparation is not dispatch. Queue acceptance is not model success.

## Tasks

- [x] Write failing trace tests for terminal idempotence, ordering, observer isolation and local identities; implement `createExecutionTrace(subscriber?)` in agent/execution-trace.ts with `attempt()`, `boundary(kind)`, `dispatched()` and `finish(outcome)` handles.
- [x] Write failing real transport tests for preparation failure, dispatch, unknown response and acknowledged failure; add optional `BoundaryObserver` to openai-driver.ts and mcp-client.ts. Export typed `LLMResponseError` for HTTP eligibility without parsing raw text.
- [x] Write failing entry-point tests in execution-trace.test.ts for two attempts/one outcome, both errors, blocked fallback, queue, endpoint credential isolation, observer failure and overlapping runs. Thread trace through api.ts/core.ts; implement optional fallbackEndpoint with no UI or queue schema changes.
- [x] Run targeted suites then `EXPO_NO_TELEMETRY=1 npm run check:required`; document diagnostic semantics and run independent diff review.
- [ ] Native commit/push with all hooks, verify auto PR scope/head and CI. Never manually merge.

Validation before publication: 31 suites / 538 tests pass; independent review approved after regressions for incomplete SSE, uncorrelated MCP errors, reentrant finalization, summary tracing and diagnostic privacy. Native commit/push hooks and remote CI are publication gates.
