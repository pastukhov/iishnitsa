# Scoped memory and recovery

Memory requires an explicitly selected account namespace in Settings and an active chat. A namespace is a local label, not authentication. Use distinct labels for distinct accounts; no endpoint, credentials or legacy record selects one automatically. With the label empty, chat does not read or save memory. Settings lists/searches the current scope and offers scoped export, clear and backup export. Export uses the native share sheet only after an explicit action.

The supported programmatic entry is `sendChatMessage(..., { memoryScope: { accountId, chatId }, memorySettings, onMemoryError })`. `flushQueuedChatMessages` accepts the same scope; entries from another scope remain queued. Old queue entries without scope never inherit a selected account. `onMemoryError` receives only `memory_write_failed`; a successful answer is not replayed after a save failure.

`MemoryStore` in `client/lib/agent/memory.ts` provides scoped `listMemories`, `searchMemories`, `getRelevantMemories`, `exportMemories`, `deleteMemory`, `clear`, `purgeExpired`, `exportBackup`, and `restoreBackup`. New entries require provenance `{ source: "explicit" | "summary" | "import", sourceId }`. IDs are idempotent within a scope when the same semantic content is retried; conflicting content rejects. Content is reference data in a user-role JSON block, never an instruction or approval authority. Activated SKILL.md runs continue to exclude memory and queue persistence.

## Legacy data

The old `@ai_agent_memory` value is a bare array with no account or chat identity. Reading it reveals no active memory. `migrateLegacy()` or the first mutation stores the exact old bytes at `@ai_agent_memory_legacy_backup` before replacing the primary key with a version-2 envelope. The original array is quarantined in that envelope; no automatic adoption is available. Corrupt, unknown or out-of-limit data is left untouched and operations fail closed. A migration write failure can be retried without duplicating records or replacing an inconsistent backup.

For deliberate management, `exportLegacy()` returns the exact original JSON, or null if there is no legacy data. This API is not invoked by chat or automatically shared. There is no legacy export/adoption UI in this change. Do not paste this export into a chat merely to recover it.

`rollbackMigration()` restores exact original bytes only immediately after explicit migration, while revision is zero and no scoped records have been written. It rejects after any mutation; it must not discard newly created records. Export relevant scoped data and the legacy backup before any separate manual recovery of a later state. Do not downgrade an app against the new envelope without such recovery. No migration has been run on a user's device during development.

## Retention and deletion

Retention defaults to 30 days and permits positive TTLs up to 365 days. Reads exclude expired records but never write or purge storage. `purgeExpired(scope)` explicitly removes expired records in that scope. Scoped export includes expired records for recovery. Limits are 4096 content characters, 128-character identifiers, 256-character search, 100 search results and 1000 stored scoped entries; capacity rejects new writes rather than silently evicting data. Legacy records remain quarantined regardless of age.

Each destructive operation that actually removes entries first saves the complete affected scope, including expired entries. Only the latest backup per scope is retained: export it before another destructive operation. No-op deletion leaves the existing backup untouched. `restoreBackup(scope)` preserves timestamps, TTL and provenance and rejects any intervening mutation, even in another scope. This conservative revision guard prevents resurrection over later decisions. A failed primary write leaves the original primary data; a backup can still be exported for manual recovery.

Clear/delete removes entries from active storage, but intentionally retains the explicit recovery backup and legacy quarantine. It is not secure erasure of all historical copies. Exported copies are outside the app's retention control.

All operations share a serial executor and reload storage, including independent MemoryStore/AgentCore instances. This guarantees concurrency within one JavaScript runtime. Cross-process or cross-device writers are not supported. Settings drops stale read/export results after scope changes; native share-sheet rendering and device persistence were not exercised in cloud tests.

## Verification

Run `npm test -- --runInBand client/lib/agent/__tests__/memory.test.ts client/lib/__tests__/memory-scope.test.ts` for fake-storage migration, failures/retries, concurrent loads/read/write/delete, scope/expiry/backup isolation and the real chat entry point. `npm run check:required` includes these and the existing lifecycle, fallback, tool-policy and SKILL.md regressions. Tests use fictitious records and mocked transports, without live MCP calls or device data.

User-configured memory limits are normalized to whole numbers in 1–100 during settings load/update and at the agent boundary (including old queued requests). Finite values are floored and clamped; malformed/non-finite values use the default 8. Settings caps accepted positive input at 100. The low-level MemoryStore query API still rejects out-of-range limits. No stored memory records are modified by preference normalization.
