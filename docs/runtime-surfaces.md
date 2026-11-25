# Shared runtime and surface adapters

The mobile entry remains `sendChatMessage`. Its optional `signal` cancels a run; `memoryStore` injects an instance with a platform-neutral storage port. `createRuntime` uses that same function as its executor. The CLI subprocess tests import the production API without native-module mocks, and compare its answer with the mobile entry. Native storage and image modules load only when used; MCP client metadata comes from the bundled app configuration.

## Trusted host composition

```ts
import { sendChatMessage } from "../client/lib/api";
import { createRuntime } from "../client/lib/runtime/service";

const runtime = createRuntime({
  execute: sendChatMessage,
  authenticate: async (credential, surface) => {
    // Verify the host's credential and revocation policy, then return its owner.
    // Return null on failure. Never derive identity from a memory namespace.
    return verifiedPrincipalOrNull;
  },
  configure: async (principal, sessionId, surface) => ({
    endpoint: trustedEndpoint,
    options: {
      memoryStore: hostMemoryStore,
      memoryScope: { accountId: principal.ownerId, chatId: sessionId },
      // Optional trusted tool policy, approval handler, fallback and skill context.
    },
  }),
});
const client = runtime.forSurface("web");
```

The example deliberately leaves verification and trusted configuration to the host; it is not a deployed authentication service. Configure must return a scope authorized for that principal/session and any explicitly activated skill for that session. Runtime request text cannot select endpoints, credentials, system instructions, tool permissions, approvals, skill activation or memory scope. Owner identifiers are validated and configuration is captured per session; no global mutable platform adapter is installed. Memory transactions serialize by storage-adapter identity: hosts must reuse the same adapter object for one backend, while independent backends do not block each other. Missing auth always fails closed. Remote input must never choose the CLI host module.

`RuntimeClient` exposes `createSession(auth)`, `start(auth, sessionId, text)`, `stream(auth, sessionId, runId)`, `cancel(auth, sessionId, runId)`, `disconnect(auth, sessionId)`, and `run(auth, sessionId, text)` (start + stream). Sessions and runs are server-assigned using Web Crypto `crypto.randomUUID()`, with no weak randomness fallback. A host without Web Crypto must supply a cryptographic `randomUUID` function; generation failures and active-ID collisions fail closed. Every operation verifies owner and surface; stream delivery rechecks authentication. Unknown and forbidden identifiers share a fixed error. One consumer may stream a run. Closing a consumed iterator cancels its owned run and frees its output.

Events are `started`, cumulative `output` snapshots and exactly one `finished` outcome (`completed`, `failed`, `cancelled`). Intermediate snapshots may coalesce for slow consumers. Configured URLs/API keys/tokens and explicit host `secrets` are redacted; suffixes are withheld to protect values split across updates. Failed/cancelled runs do not flush potentially partial secrets. Errors expose fixed codes rather than exception bodies or private configuration. This redacts known configured values; it cannot classify arbitrary unknown secrets supplied by a host or provider. No request bodies or output are logged by the runtime.

Limits: 8192 input characters, 65536 characters in the latest output snapshot, 32 sessions per runtime and four retained runs per session. Run deadline defaults to 60 seconds (configurable from 1 ms to five minutes). Consumers must consume or disconnect completed runs to release slots; do not retain sessions indefinitely. All buffers are in memory only. Runtime execution never enqueues offline payloads. Mobile enqueue checks cancellation after storage waits; cancellation during persistence removes the new entry while retaining the storage lock. If durable cleanup itself fails, a runtime tombstone prevents replay in that process, but restart safety cannot be guaranteed while storage is failing; the host must repair/clean the durable queue before restarting. Existing tool-replay eligibility remains unchanged.

## CLI

`runCli(client, auth, text, io, signal?)` is the reusable I/O entry. The actual process wrapper requires an explicitly trusted local host module exporting `createCliHost(): { client, auth }`:

```sh
npx tsx scripts/agent-cli.ts --host ./my-trusted-host.ts --text "A question"
```

It has no default endpoint and opens no network listener. Credentials belong in the host, not command arguments. Output is JSON lines; exit codes are 0 completed, 1 failed, 2 usage and 130 cancelled. SIGINT/SIGTERM call cancellation. `scripts/fixtures/runtime-cli-host.ts` is only a fake-transport test host, not a deployment configuration. Text-only CLI execution and fake MCP initialization are tested in real Node. Native image persistence still requires a mobile host or a separately supplied native-capable environment; no Node image implementation is added.

## Web and Telegram

`createWebAdapter(client, credentialResolver)` and `createTelegramAdapter(client, verifier)` return `handle(context, command)`. Pass clients from the corresponding `forSurface` call. No HTTP server, browser UI, Telegram subscription, webhook or public endpoint is installed.

Commands have exactly these fields:

- `{ type: "create" }`
- `{ type: "start" | "run", sessionId, text }`
- `{ type: "stream" | "cancel", sessionId, runId }`
- `{ type: "disconnect", sessionId }`

Responses are session/run identifiers, `ok`, a stream of runtime events, or `{ type: "error", code: "request_failed" }`. Unknown fields are rejected. The web resolver reads authenticated host connection context, never command fields. The Telegram verifier must independently validate actor and conversation and return `{ actorId, conversationId, credential }` or null. Telegram session bindings include both verified actor and conversation, so group membership or a copied session ID alone cannot grant access. Use a stable credential value/object for the life of a stream; changed identity fails closed.

**Transport disconnect must call the explicit `disconnect` command concurrently with any pending stream read.** Async iterator `return()` alone cannot interrupt an already-pending `next()`. Explicit disconnect cancels/wakes owned runs and frees the session; breaking an iterator after a delivered event also cleans up its run. Auth revocation stops further delivery and cancels the owned run. Deployments must wire credential verification, expiry/revocation, secure transport and disconnect events; these injected contracts are not production authentication or a deployed bot.

## Cancellation and existing guarantees

Cancellation reaches LLM and MCP fetch/reader waits and approval waits, checks every subsequent tool boundary and prevents fallback or offline replay. Dispatched external calls can still have performed an action: their diagnostic outcome is unknown, not a claim of rollback. An already-started native image operation may finish internally, but its cancelled run ignores the result and performs no later tools or memory work. Storage reads/queues are checked before starting a new persistence write; an already-invoked storage adapter write cannot be physically rolled back. Tool policy, session-bound skills and scoped memory continue through the existing executor.

## Verification and limits

Run `npm test -- --runInBand client/lib/runtime/__tests__ client/lib/__tests__/node-portability.test.ts`, then `npm run check:required`. Fixtures use fake fetch/storage/identity and never contact live providers, MCP servers or Telegram. Tests cover actual CLI invocation/SIGINT, mobile parity, native-free imports/MCP initialization, scope and skill integration, cancel/disconnect, revocation, cross-owner/session/surface rejection, secret splitting, resource bounds and transport contracts. Native screen rendering, deployed TLS/auth, real Telegram delivery and real provider rollback are not verified or claimed.
