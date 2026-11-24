# Logical runs and execution boundaries (#198)

The current API has one endpoint and offline queue recovery, not an existing multi-endpoint fallback. The authorized extension is one optional `fallbackEndpoint` supplied explicitly by the caller. UI and persisted queue payloads do not acquire fallback settings. Existing calls retain their recovery policy.

## Approach

Keep a local logical trace in `sendChatMessage`, with opaque run, attempt and operation IDs, ordered frozen metadata and an idempotent final outcome. Pass a per-attempt context down to AgentCore and actual LLM/MCP transports. A global context risks mixing concurrent requests; instrumenting only AgentCore would mislabel preparation as dispatch. Existing AgentCore lifecycle remains a separate per-execution state machine.

Fallback is allowed once, only for typed LLM HTTP 429/502/503/504 responses, before any chunk, attachment or conservative tool-attempt latch. Other errors (including transport uncertainty, cancellation, authentication, validation and parser failures) cannot select another endpoint. Use the fallback endpoint's own provider/URL/credentials without merging primary configuration. Original queue eligibility and payload remain unchanged; a successful enqueue is `queued`, not `completed`.

Operations report dispatch independently of outcome: not_dispatched or attempted, and completed/failed/unknown/denied. Serialization and MCP initialization precede dispatch. A lost or unusable response after sending is unknown. A returned failure does not imply no side effects. Unknown tool/server is denied before dispatch. The existing early replay latch stays unchanged, even when initialization later prevents dispatch.

Events allow only generated IDs, sequence, elapsed time, fixed event kinds/operation/outcomes. No endpoint/server/tool names, URLs, arguments, responses, credentials or error text. Observers cannot alter execution through exceptions. No persistence, dependencies or default logging. Built-in image generation is outside the LLM/MCP transport instrumentation scope; its existing replay latch still prevents fallback.

Rollback by reverting the change; no migration. Real services and mobile UI are not needed for tests: exercise the actual API/core/driver/MCP stack with fake endpoints and mocked fetch.

## Reading diagnostics

Subscribe with API option `onExecutionEvent`; events are not logged automatically. `run_started`/`run_finished` describe the caller-visible invocation, including a `queued` outcome for offline acceptance. `attempt_started`/`attempt_finished` separate the selected endpoints without exposing their configuration. `operation_started` is preparation, not proof of dispatch; only `operation_dispatched` means transport invocation. `operation_finished` contains independent dispatch and outcome fields and a nonnegative duration. Sequence is authoritative for ordering; timestamps use the local clock.

Memory-summary LLM requests belong to the same attempt. Built-in image generation has no new transport events in this slice. A legacy parser can return without a verifiable complete response; in that case the logical invocation can complete while the operation outcome is unknown. No telemetry outcome changes parser, queue, or replay decisions. Reinitialization failures and local denials can be not_dispatched while the conservative replay latch still blocks retry. HTTP/JSON-RPC failures after dispatch do not prove absence of side effects.

Validation: `npm test -- --runInBand client/lib/__tests__/execution-trace.test.ts client/lib/__tests__/transport-boundaries.test.ts client/lib/agent/__tests__/execution-trace.test.ts`, then `npm run check:required`. Fixtures use fake custom endpoints and mocked transport, with the production API/core/driver/MCP implementations. No live credentials or external requests are required.
