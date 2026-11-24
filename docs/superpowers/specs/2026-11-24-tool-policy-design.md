# Tool dispatch policy (#199)

## Decision

Use one run-local dispatch policy for built-in and MCP tool adapters. Keep the trusted risk registry separate from the MCP discovery/latency cache: only application-supplied rules classify an exact target as read_only, mutating or denied. No rule means denied. Built-in image generation cannot be downgraded to read-only. Model output, descriptions, server annotations and skill text never supply authorization.

Bind MCP identity to tool name and the configured server, including id/URL/token/enabled; bind image generation to its provider/URL/credentials/model/folder configuration. Snapshot trusted rules, approval handler, timeout and cancellation signal once at the logical chat request entry, before diagnostic observers run; fallback attempts cannot acquire authority from later caller configuration edits. Parse strict JSON-object arguments, snapshot and freeze the exact call, then revalidate live identity and arguments after any approval await. Execute only the snapshot that was approved.

Mutation approval is a fresh frozen request with opaque run/call IDs, exact arguments, sanitized tool identity and a bounded deadline. The trusted handler must explicitly approve that exact request object. Missing handler, rejection, exception, cancellation, expiry, copied or reused request, or changed target/arguments deny. Timeout/cancellation also release a waiting call; late approvals are inert. Grants are consumed before adapter invocation and cannot cross calls or runs. Close the policy scope when the run exits.

The common gate sits immediately before adapters and the existing conservative replay latch. Denial never invokes the adapter or marks a possible side effect. Authorized calls retain the latch before MCP initialization/image generation; unknown results still block replay. Policy denial contains fixed text; the existing MCP trace produces denied/not_dispatched diagnostics, never arguments, identities, URLs, secrets or exception payloads.

## Integration and limits

API callers may pass trusted `toolPolicy` options; they are never read from prompts/server output or persisted in the offline queue. Each AgentCore invocation creates and closes its own approval scope from the captured logical-request configuration; a fallback cannot reuse approvals or broaden the captured registry. Each offline flush captures fresh caller configuration before queue callbacks; each item receives a separate approval scope and fresh grants. The existing UI has no tool confirmation handler, so autonomous tools remain closed by default. Direct image-mode UI calls use a guarded wrapper and also remain closed without a handler. The app-owned prompt catalogue request uses an explicit read-only rule only for the fixed catalogue URL and `search_prompts`; an ID match at another URL is not trusted.

Raw transport helpers remain internal building blocks for trusted application code, not an authorization API for model output. This is not a sandbox for arbitrary code execution or a mechanism to undo a request already sent. Cancellation during dispatch cannot revoke completed side effects. No new UI dialogs, dependencies, persisted approvals or permission settings in this slice.

Alternatives rejected: trusting discovered readOnly annotations, generic boolean approval or approval cached by tool name would allow untrusted grants or cross-call reuse. A global policy scope could mix concurrent runs. A full UI permission editor is outside this issue; fail closed until a real approval path is supplied.

## Verification

TDD with fictitious tools and mocked transports: read-only, explicit/unknown denial, approval, missing handler, expiry, cancellation, argument/identity changes, stale/cross-run grants, concurrent pending approvals and unknown result. Exercise `sendChatMessage`, builtin and MCP dispatch; preserve #198 fallback, tracing and replay regressions with explicitly authorized test fixtures. Run `npm run check:required`, independent review, native hooks and remote PR checks. No live MCP or provider connections.

## Reading policy diagnostics

An MCP `operation_finished` with `denied` / `not_dispatched` means the execution adapter was not called; discovery may already have run. After an authorized dispatch, malformed/lost responses retain `unknown` / `attempted` and the replay guard. Built-in image execution still has no transport trace; a policy denial is returned as fixed text, never as an execution event. Approval requests are private input for a trusted confirmation handler, not telemetry: they contain exact arguments and must not be logged. Their opaque IDs are scoped to authorization, distinct from diagnostic trace IDs. No policy, grant, callback or deadline is stored in the offline queue; queue execution needs fresh trusted configuration and confirmation.
