# Text Delegation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans with TDD and independent final review.

**Goal:** One-level, bounded, host-initiated text subtasks within a parent chat run.
**Architecture:** Opaque immutable task capability, bounded existing model driver, API integration and metadata-only child audit. Return untrusted results without context promotion.
**Tech Stack:** TypeScript, Jest, existing fetch/AbortSignal and runtime.
**Spec:** docs/superpowers/specs/2026-11-25-text-delegation-design.md

## Global Constraints

No tools, recursive spawn, memory, skills, child approvals, inherited prompts/history, queue/fallback or remote privilege configuration. Use fake transports only; preserve #198–202. Limits are specified in the design and cannot be raised by callers.

## Review Focus

- Bounds must apply before parser buffering, including HTTP errors and large chunks.
- Cancellation and unknown outcomes must not turn into completion or replay.
- Concurrent parents must not share counters/results or transport credentials.
- Capability mutation/forgery and child text cannot become authority.
- Child results must not reach parent messages, memory, queue or remote streams.

## Task 1: Bounded text transport

- [x] Add failing real-driver tests for bounded stream, unsolicited tool calls, byte/output caps, incomplete responses and cancellation.
- [x] Implement optional `textOnly` driver mode with fixed limits; ordinary calls unchanged.
- [x] Run targeted tests and existing transport suite.

## Task 2: Delegation and parent integration

- [x] Add failing real `sendChatMessage` tests for capability validation, isolation, budgets, audit and cancellation.
- [x] Add `createTextDelegation` factory and internal runner; integrate before attempts; return frozen untrusted results only on parent success.
- [x] Add child trace methods and fixed error outcomes; prevent queue replay when delegation is configured.
- [x] Verify concurrent reuse, fallback-on-parent only, expiry, and no data promotion through real runtime/adapter entry.

## Task 3: Documentation, review and publication

- [x] Document supported host entry and streaming limits; update AGENTS test command.
- [x] Run check:required, coverage/diff coverage and independent review; fix confirmed findings with regression tests.
- [ ] Commit/push natively with hooks; verify exact PR head/files, CI, CodeQL, Codecov and new GitHub review. No manual merge; stop before #204.
