# Harness Evaluation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One deterministic local report through the mobile execution boundary.

**Architecture:** A dedicated Jest invocation exercises real sendChatMessage, provider SSE parsing and MCP dispatch with synthetic transports. Test-only observers and fault probes produce a bounded metadata report without changing production APIs.

**Tech Stack:** Existing Jest, TypeScript, Node runner.

**Spec:** GitHub issue #205 and docs/harness-evaluation.md.

## Global Constraints

- No live services, real data, new clients, permission changes or production orchestration changes.
- Missing usage and cost remain unknown. Controlled latency is accounting validation, not a benchmark.
- Preserve policy, replay and session isolation; use existing fixtures where practical.

## Review Focus

- A failed run must not leave a stale successful report.
- Concurrent usage must attach to the correct call.
- Unknown stream/tool outcomes must not be relabelled successful.
- Fault probes must detect their intended invariant, not pass on arbitrary exceptions.
- Unexpected transport or storage activity must fail the evaluation.

## Task 1: Baseline and regression oracles

- [x] Write failing oracle tests for duplicate dispatch, stream integrity and isolation.
- [x] Add synthetic shared fixtures and scenarios through real mobile execution.
- [x] Capture actual parsed usage; assert deterministic clock accounting and side-effect absence.
- [x] Run baseline and bounded fault probes, requiring their specific violations.

## Task 2: Reproducible command and review

- [x] Add npm run eval:harness and metadata-only JSON report in ignored tmp directory.
- [x] Run twice and compare reports byte-for-byte; verify failure exits nonzero and removes stale report.
- [x] Document scenarios, command, trust boundaries and limitations; update AGENTS.
- [x] Run full required checks, coverage and independent review.
- [ ] Complete mandatory commit/push hooks.
- [ ] Verify exact PR head, separate CI/CodeQL/Codecov/review results and issue states; never manually merge or close #196.
