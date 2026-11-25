# Local mobile execution evaluation

Run from a checkout with dependencies already installed:

```sh
npm --offline --no-update-notifier run eval:harness
```

The command uses the installed Jest binary and writes `tmp/harness-eval.json`.
It exits nonzero if any baseline invariant or sensitivity probe fails. It removes
an earlier report before starting and removes the report on failure, so an old
successful result cannot masquerade as a new one. No dependency download is part
of this command. The scenarios also run in the normal required Jest suite.
The command also reuses the existing runtime security suite for authenticated
ownership and surface isolation; those assertions must pass before it succeeds.

## Boundary and interpretation

The evaluation calls `sendChatMessage`, the execution entry used by
`client/screens/ChatScreen.tsx`. It keeps the real agent, SSE parser, tool policy
and MCP client. Transport responses, native storage and clocks are synthetic.
Only fixed fixture requests are accepted; unknown transport activity fails.
No live provider, MCP server, Telegram, GCP or user storage is accessed.

Latency is measured with controlled clocks and fixed synthetic transport steps.
It verifies accounting and repeatability, not device speed or provider performance.
Token usage is captured from the real driver's parsed return value; the mobile
orchestrator currently does not expose usage to its caller. Missing usage remains
unknown, including individual missing fields. No prices are supplied, so cost is
unknown rather than zero. The report contains fixed scenario identifiers,
aggregate counters and outcomes, never prompts, replies, tool payloads, URLs,
credentials, raw errors or random run identifiers.

## Baseline and sensitivity

The baseline covers successful streamed output, available and missing usage,
exactly-once harmless MCP dispatch, policy denial before dispatch, eligible
fallback, no replay after uncertain MCP execution, cancellation, stream integrity
and overlapping run isolation. These scenarios exercise the existing execution
contracts, rather than introducing a second implementation of orchestration.

Bounded test-only fault probes establish that the oracles reject duplicate
dispatch, incorrect stream acceptance and mixed session results. Each probe must
produce its specific expected violation after the unchanged baseline passes;
an unrelated exception is not evidence that the oracle detected the defect.
Fault injection is confined to the test process and restored afterwards.

The fixed baseline cases are `sse_usage`, `usage_unknown`, `usage_partial`,
`mcp_once`, `mcp_denied`, `fallback`, `mcp_unknown`,
`cancel_before_dispatch`, `cancel`, `malformed`, `incomplete`,
`incomplete_tool` and `parallel`. The report records operation dispatch/outcome
pairs separately from logical-run outcomes. A request cancelled before entering
the orchestrator has no run events; cancellation during a dispatched read has
one failed logical-run terminal and an unknown transport outcome.

An incomplete text stream can have an `unknown` operation outcome under the
existing contract. This evaluation does not silently reclassify that outcome as
complete or claim that all partial text must throw. Malformed/incomplete tool
streams must never cause tool execution.

## Limits and roadmap reconciliation

This is a deterministic regression baseline, not an Android/iOS emulator test,
live-provider compatibility test, security certification or production cost
benchmark. Existing detailed policy, replay, runtime ownership, skills, memory
and delegation suites remain part of `npm run check:required`; the evaluation
does not replace those gates. No product client, permission or execution policy
is added by this change.

For roadmap #196, this report supplies the final evaluation slice (#205).
Previous slices retain their documented limits: injected remote adapters are not
deployed services, delegation is bounded text-only, and local learning produces
inactive drafts rather than changing behavior. The parent issue remains a
separate acceptance decision; this change does not close it.

| Parent acceptance area                                                | Existing evidence retained by required checks                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts, event ordering, unsubscribe and observer failure isolation | `docs/superpowers/specs/2026-11-24-agent-lifecycle-design.md`, `agent/__tests__/lifecycle.test.ts`                                                |
| Run/attempt correlation, one terminal and truthful dispatch outcomes  | `__tests__/execution-trace.test.ts`, `__tests__/transport-boundaries.test.ts`, this evaluation                                                    |
| Default-deny tool authority and replay safety                         | `__tests__/tool-policy-integration.test.ts`, `__tests__/tool-dispatch.test.ts`, `__tests__/mcp-replay.test.ts`, `__tests__/offline-queue.test.ts` |
| Scoped data and imported context                                      | `__tests__/skill-activation.test.ts`, `__tests__/memory-scope.test.ts`, `agent/__tests__/memory.test.ts`                                          |
| Authenticated runtime ownership and bounded delegation                | `runtime/__tests__/service-security.test.ts`, `runtime/__tests__/delegation.test.ts`                                                              |
| Mobile opt-in review-only learning                                    | `__tests__/local-suggestions.test.ts`, `components/__tests__/LocalSuggestionsPanel.test.tsx`                                                      |

Test paths above are relative to `client/lib/` except the component test, which
is relative to `client/`. These are coverage references, not a claim of device or
live-service verification. GitHub issue checkbox state is not modified by the
evaluation command.
