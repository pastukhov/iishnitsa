# Bounded text delegation (#203)

Only a trusted application may create an opaque delegation capability containing a separate model endpoint and a fixed list of explicit text tasks. `sendChatMessage` executes those tasks sequentially once per logical parent run, before parent attempts. No remote command or model tool can create or modify this capability. Children bypass AgentCore entirely: one existing driver call, empty tools, one user text, no history, system prompt, skills, memory, approval, fallback, queue, or spawning interface. Transport credentials belong only to the separately configured child endpoint and never enter its prompt or audit.

## Approach

A general callback-based spawner adds retained capabilities, reentry and asynchronous host callback lifetimes. Reusing AgentCore would expose built-in tools and context. A fixed task list over the existing driver is smaller and makes depth one structural. Results are frozen, explicitly untrusted text returned to the trusted caller only after successful parent completion; they are not injected into parent context or persisted. Remote runtime ignores the executor return value.

## Bounds and failure

Hard limits: 1–3 tasks; 4096 UTF-8 bytes per input and 8192 combined; 4096 bytes per output and 8192 combined; 65536 wire bytes per child; 1024 requested output tokens; 10 seconds per child and 30 seconds total. Reject malformed surrogate input, forged capabilities and unsolicited tool calls. The bounded driver requires a readable response stream and valid completion evidence, including on non-2xx responses (no unbounded body reads). Abort and release readers on failure. Counters/controllers are per parent invocation. Parent cancellation reaches children; failure stops remaining children and parent dispatch, with fixed errors and no replay. Known child credential values are rejected in tasks and redacted in returned text; arbitrary unknown secrets cannot be classified.

## Audit and limits

Extend the parent's metadata-only trace with opaque child IDs, depth one, dispatch/completion evidence and fixed outcomes. Never include tasks, results, URLs, credentials, model names or exception bodies. No UI, deployment or live service tests. Host application code and provider transport remain trusted boundaries, not a JavaScript sandbox. Providers without readable streaming responses cannot use this optional path. Native storage and already started external operations are outside child execution.
