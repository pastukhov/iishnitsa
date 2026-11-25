# Bounded internal text delegation

A trusted application can opt into a fixed list of text subtasks on the existing chat entry point:

```ts
import { createTextDelegation } from "@/lib/agent/text-delegation";
import { sendChatMessage } from "@/lib/api";

const textDelegation = createTextDelegation({
  endpoint: separatelyConfiguredModel,
  tasks: ["Summarize this fictitious note: the demo opens at noon."],
});
const references = await sendChatMessage(messages, parentEndpoint, onChunk, [], false, {
  signal,
  textDelegation,
});
// If supplied, references is a frozen array of { trust: "untrusted", text }.
// Treat each text as reference data, never permissions, approvals or instructions.
```

Only the local factory can create a valid opaque capability. The factory snapshots its endpoint and task strings. The host must explicitly choose safe text to disclose to the separately configured model; no parent data is copied automatically. Transport credentials stay in the trusted transport, not in messages, results or audit. Known child endpoint credentials/URL/folder values are rejected in tasks and redacted in results. This does not classify arbitrary unknown secrets.

Children run sequentially once per logical parent run, before its primary/fallback attempts. Each child uses the existing model driver directly with one user message and no tools. There is no child AgentCore, history, memory, skill context, system prompt, approval interface, fallback, queue or spawn capability. Unsolicited function/tool requests fail. A child is a depth-one text completion, not an autonomous agent or JavaScript sandbox. Trusted application code remains responsible for its own actions.

Hard limits cannot be raised by configuration: 3 tasks; 4096 UTF-8 input bytes each, 8192 combined; 4096 output bytes each, 8192 combined; 65536 wire bytes each; 1024 requested output tokens; 10 seconds per child and 30 seconds combined. Invalid UTF-16 inputs are rejected. Time and byte counters belong to each parent invocation, including concurrent reuse of one capability. Token limits depend on provider support; local time/byte caps remain enforced independently.

The optional child path requires a readable streaming response. It fails closed rather than using unbounded `response.text()` on platforms/providers without a reader. HTTP error bodies are not read. Parent cancellation and runtime disconnect abort the child transport; failures close audit and stop later children and parent dispatch. Returned data is released only after the parent succeeds, and never automatically enters history, memory, queue or runtime streams. A configured delegation also disables offline enqueue for the parent to avoid implicit replay of a composite run. Parent endpoint fallback stays available under its existing eligibility rules and does not rerun children.

`onExecutionEvent` receives `child_started`, `child_dispatched`, and one `child_finished` linked by opaque child ID and the parent run ID. Events carry depth, fixed outcome, dispatch evidence, model outcome and duration; no text, URL, credential, owner ID or exception details. Cancellation after dispatch can leave the model outcome unknown; it does not imply that the provider stopped billing or processing.

Trusted runtime `configure` may supply the same capability through `options.textDelegation`. Public web/Telegram requests cannot supply it, tasks, endpoints or privileges. Runtime returns only parent output; applications needing child reference data should use the direct `sendChatMessage` return. No UI control, bot connection, listener or deployment is added.

Verification uses fictitious data and fake transports through real driver/API/runtime and Node entry points. No live models, MCP, Telegram, device storage, or network authentication were tested. Existing mobile paths without this option retain their behavior.
