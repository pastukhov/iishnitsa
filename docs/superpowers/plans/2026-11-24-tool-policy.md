# Tool policy implementation plan

> **For agentic workers:** use test-first implementation and independent review before publication.

**Goal:** Enforce trusted risk and exact one-shot approvals at tool dispatch for #199.
**Architecture:** Snapshot trusted rules per run; one shared gate validates and authorizes immutable targets/arguments before either adapter and the existing replay latch.
**Tech Stack:** TypeScript/Jest, existing adapters, no dependencies.
**Spec:** ../specs/2026-11-24-tool-policy-design.md

## Constraints and review focus

Unknown/default UI is denied. Approval is not inferred from model/server/skill text. Exact target/account/arguments, cancellation, expiry, cross-run reuse and late approval must fail closed. Keep replay conservative after allowed dispatch and keep telemetry metadata-only.

## Tasks

- [x] RED/GREEN policy unit tests; implement tool-policy.ts with immutable trusted registry, bounded approval, cancellation, exact object grant and run close.
- [x] RED/GREEN entry-point tests; gate both AgentCore tool branches, thread optional trusted policy through API, and close run scopes. Preserve strict JSON arguments and adapter snapshots.
- [x] Guard direct image UI via wrapper; give fixed prompt catalogue query an explicit exact-target read-only rule. Test both closed and trusted paths with mocks.
- [x] Migrate existing execution/replay fixtures to explicit trusted authorization without weakening assertions; add denial metadata and unknown-outcome regressions.
- [ ] Run check:required and independent review; native commit/push hooks, verify auto PR exact head/files and CI. No manual merge or #200 work.

## Review and validation record

Policy and entry-point tests failed against the original unguarded dispatch before implementation. Independent review identified two issues that were fixed with regressions: post-dispatch SyntaxError must remain an execution failure/unknown outcome, and trusted configuration must be captured before observer callbacks can change it across fallback attempts or a queue flush. Direct UI and catalogue paths were reviewed separately; no remaining blocking findings were reported.

`EXPO_NO_TELEMETRY=1 npm run check:required` passed (lint, types, format, mocked providers and 34 test suites). EXPO_NO_TELEMETRY only prevents Expo analytics writes outside the sandbox; no checks or hooks are disabled. The final coverage run passed 605 tests in 34 suites (94.83% lines, 87.07% branches); the queue callback regression is included. Native commit/push hooks and remote CI remain the publication gates. No live provider/MCP or device UI confirmation was exercised: the current UI has no real confirmation handler and tool/image execution therefore remains closed.

## Coverage follow-up

PR #208 was automatically merged after required PR Checks succeeded, before the later Codecov patch result reported 81.92% against 88.53%. A test-only continuation from the new origin/main covers remaining meaningful validation and confirmation-race branches, invalid built-in image prompts and revised image responses. No gates, thresholds or production behavior are changed. The original head's Codecov result remains historical; follow-up coverage and CI must be reported separately.

Follow-up validation: 647 tests / 34 suites pass, including the full required command and coverage. The policy module reaches 100% statement/branch/function/line coverage. A local strict estimate of the original production patch (counting partially covered branch lines as misses) improves from 136/167 (81.44%) to 163/167 (97.60%); this is supporting local evidence, not a replacement for the hosted Codecov check. Independent test review reported no blockers.
