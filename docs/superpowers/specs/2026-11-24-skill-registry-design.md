# Scoped SKILL.md import (#200)

Local text import creates immutable, validated, untrusted records. The existing remote preview/storage UI is not an activation boundary: saved skills will no longer be concatenated into system prompts. No new UI or remote catalogue importing is added. The supported activation path is the exported registry/session API plus `sendChatMessage` options.

Use a deliberately narrow flat frontmatter grammar with required `schema_version: 1`, slug `name`, numeric `version` (x.y.z), single-line `description`, `surface: chat`, and `trust: untrusted`. Reject unknown/duplicate keys, invalid controls/surrogates, and unsupported metadata. Body text is opaque reference data: links, commands and hooks are never followed or executed. Each file is at most 16,384 UTF-8 bytes; metadata name/version/description limits are 64/32/256 characters. A registry holds at most 32 records and 262,144 raw UTF-8 bytes.

Keys are exact name/version. Identical reimports are idempotent; different content at the same key is rejected. Versions may coexist, but callers must select an exact version and cannot activate two versions of one name. Activation chooses 1–4 records in canonical order, with at most 8,192 UTF-8 bytes for the complete serialized context. There is no automatic latest-version selection or trust upgrade.

Opaque in-memory session and activation tokens bind exact imported records to a session and the chat surface. Forged, closed or mismatched tokens fail closed. Closing a session revokes future dispatches: revalidate after callbacks/asynchronous preparation, before each LLM/tool dispatch and each fallback. Already sent operations cannot be recalled. No activation is persisted or inherited by a new session.

Insert the serialized reference as a separate user-role context message, never a system prompt or tool-policy input. Activated runs disable memory reads/saving/summaries and offline queueing; failure is returned rather than silently queued without context. Existing tool approval/replay protection remains independent. No content enters telemetry or logging. Caller-managed chat output can still reflect the reference; this is not a guarantee of model obedience or an arbitrary-code sandbox.

Alternatives rejected: persisted global enable flags violate session isolation; a new import/confirmation UI expands this issue; general YAML execution/companion files add unnecessary authority. Existing legacy queue records are opaque caller prompts and cannot be reliably retroactively separated from old skill text; this change prevents new implicit imports and does not claim to sanitize historical records.

## Supported caller usage

The local caller supplies an already available string to `createSkillRegistry().import(raw)`; the module never fetches a file or discovers companion content. Frontmatter is plain, unquoted, one `key: value` per line (no YAML collections, aliases, multiline values or unknown fields). LF and CRLF are accepted. Example:

```markdown
---
schema_version: 1
name: concise-reference
version: 1.0.0
description: A short reference for this conversation
surface: chat
trust: untrusted
---
Reference example: a concise answer has a clear first sentence.
```

```typescript
const registry = createSkillRegistry();
registry.import(rawSkillMd);
const session = createSkillSession("chat");
const activation = registry.activate(session, [
  { name: "concise-reference", version: "1.0.0" },
]);
try {
  await sendChatMessage(messages, endpoint, onChunk, [], false, {
    skillContext: { session, activation, surface: "chat" },
  });
} finally {
  closeSkillSession(session);
}
```

Caller code controls session lifetime and explicitly supplies the activation for every request. Recreating plain token objects or serializing/restoring them never grants activation. The Settings/remote-preview UI remains reference storage only and does not call this API. Historical persisted prompts cannot be automatically reclassified; callers should review old queued requests before replaying them. New activated requests are never queued, even if `queueOnFailure` is true.

Dispatch revocation is checked immediately before LLM fetch and MCP tools/call fetch, including after MCP initialization and approval callbacks. The diagnostic `operation_dispatched` notification marks commitment to that synchronous send; closing inside that notification does not recall the committed request. The conservative replay latch still treats adapter entry as a possible action even if a subsequent scope check prevents transmission.
