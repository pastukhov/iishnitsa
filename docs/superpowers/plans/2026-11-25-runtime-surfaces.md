# Runtime Surfaces Implementation Plan

> **For agentic workers:** Use TDD task-by-task and independent review. User authorized autonomous reversible implementation.

**Goal:** Complete #202 only with one executor, mobile/CLI parity, authenticated thin adapters.
**Architecture:** Retain sendChatMessage orchestration; add cancellation and portable native boundaries, then owner-bound runtime sessions.
**Tech Stack:** TypeScript, existing tsx/Jest, injected fetch/storage/auth; no dependencies or live services.
**Spec:** ../specs/2026-11-25-runtime-surfaces-design.md

## Constraints and review focus

No auth derived from memory namespace; auth before any operation. Preserve unknown tool outcomes, fallback eligibility, queue policy and skill/memory isolation. Never send private errors/config to streams. No process-global configurable services. Bound inputs/buffers/concurrency and revoke on disconnect. Test abort races at actual dispatch, wrong owner/surface/revocation, forgotten consumers, split secrets and Node import without Jest mocks.

- [x] Stage 1 TDD: portable native defaults/per-instance storage; AbortSignal through API/core/driver/MCP; actual CLI process uses production executor; same mocked scenario as mobile. Files: api, core, openai-driver, mcp-client, context-manager, memory/offline storage, runtime cancellation, CLI adapter/script and parity tests.
- [x] Stage 2 TDD: authenticated runtime createSession/start/stream/cancel/run/disconnect, bounded owner-isolated records, trusted host config and fixed errors. Files: client/lib/runtime/service.ts and contracts/tests.
- [x] Stage 3 TDD: thin injected web/Telegram adapters delegate same contract; auth/owner/conversation, cancellation/disconnect and privacy contract tests. No listeners or live accounts.
- [x] Full check:required, full coverage/diff estimate, independent whole-diff review and docs for composition/limitations. Document new tests in AGENTS.
- [ ] Native feature commit/push/hooks; exact-head PR files/commits/CI/CodeQL/Codecov/new GitHub review, correct confirmed blockers. No manual merge/protection changes.

## Verification evidence

Actual CLI subprocess parity, timeout cancellation and SIGINT pass without native Jest mocks; Node MCP initialization uses a fake transport. Full check:required and full coverage pass with 930 tests / 46 suites. Local strict covered-library diff estimate: 392/406 (96.55%), counting partially covered branch lines as uncovered. Web/Telegram adapters have 100% coverage. Independent review corrected Node MCP metadata, late memory writes after cancelled reads, and orphan operation events; new regressions failed before fixes. Final review found no remaining blocker. No live service, user storage or deployed/native UI verification was performed.
