# Agent lifecycle design

Implements [#197](https://github.com/pastukhov/iishnitsa/issues/197), first slice of [#196](https://github.com/pastukhov/iishnitsa/issues/196).

## Decision

Keep the state machine in AgentCore, but hold its current state in the individual invocation. Adopt a typed in-process lifecycle with synchronous, run-scoped subscribers, rather than attaching new callbacks to every transition or introducing a shared event emitter. Direct per-transition callbacks would duplicate failure handling; a shared emitter would require filtering and ownership for each listener. Events are ephemeral: only generated trace ID, sequence, timestamp, and a fixed event kind, state, or outcome.

One invocation of AgentCore targets one endpoint. Its lifecycle is not the enclosing user request that can retry across endpoints. A future outer trace may correlate distinct attempt traces; this slice does not change retry, fallback, or the MCP replay guard.

Subscribers receive a frozen event and cannot affect the result through synchronous exceptions. Never include user or provider content, tool arguments/results, free-form errors, URLs, or credentials. Runtime scope is the state machine and its final memory call; this does not make shared MemoryStore writes atomic. The terminal event reports the outcome visible to the caller and is emitted once after finalization. A swallowed memory persistence error remains swallowed; behavior does not change.

No dependencies, UI, network requests, storage changes, or default console logging. Existing callbacks remain as they are to minimize the blast radius, not as a general compatibility promise. The lifecycle is additive and can be rolled back by reverting the slice without migrating data.
