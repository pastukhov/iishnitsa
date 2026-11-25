# Scoped MemoryStore Implementation Plan

> **For agentic workers:** Use TDD and independent review before publication.

**Goal:** Implement #201 only: scoped memory with provenance, search/retention/export/delete and recoverable migration.
**Architecture:** Evolve the same storage key to a versioned envelope; serialize all storage operations without caches, preserve unscoped legacy data, and bind agent/UI access to explicit scope.
**Tech Stack:** TypeScript, AsyncStorage, existing Jest mocks; no dependencies.
**Spec:** ../specs/2026-11-25-memory-scope-design.md

## Constraints and review focus

Never infer legacy ownership. Preserve exact backup before migration/destruction. Verify independent first loads, interleaved read/write/delete, storage errors and revision conflicts. No system-role memory promotion; preserve #198–200 boundaries. No live data/device migration and no #202.

- [x] Store RED/GREEN: scope/provenance validation, serialized mutations, pure scoped retrieval/search/expiry/export/delete, real legacy fixture backup/migration/retry/rollback, revision-checked scoped recovery.
- [x] Agent/API RED/GREEN: immutable per-run scope, user-role reference context, explicit/summary provenance, safe persistence-error callback, queue scope matching, real sendChatMessage and skill/replay regressions.
- [x] UI integration: explicit account namespace and current chat scope, scoped search/export/clear, remove unsafe undo and prevent stale scope views; legacy export remains an explicit management API.
- [x] Full coverage and strict diff estimate; independent review corrected no-op removal backup loss. Migration and recovery documented in docs/memory-storage.md. Final required checks and native hooks run before publication.
- [ ] Native hooks/push; verify auto PR exact head/files and mandatory CI plus codecov/patch separately. Never manual merge or change protection.

## Local evidence

Store regression suite: 76 cases, 100% statements/branches/functions/lines. Initial entry-point tests: 8 failures then green after integration. No-op backup review: six failures before correction, all pass after. Full coverage run: 814 tests / 37 suites; strict changed covered-library line estimate 183/187 (97.86%), counting partial branch lines as uncovered. Screens are outside the existing coverage collection; no device/share-sheet validation or live-data migration claimed. Native gates and remote CI are recorded in the PR.

Final independent review: no remaining #201 blocker after the backup fix and persisted message-ID correction. Existing same-chat UI request overlap during model resolution is not a per-request ownership guarantee; storage transactions and account/chat isolation are independently verified. Final check:required and full coverage both passed (814 tests).
