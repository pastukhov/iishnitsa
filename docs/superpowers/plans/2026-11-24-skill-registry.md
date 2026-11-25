# Scoped Skill Registry Implementation Plan

> **For agentic workers:** Use test-first implementation and independent review before publication.

**Goal:** Deliver #200 only: validated local SKILL.md import and explicit bounded session activation.
**Architecture:** Immutable in-memory registry and opaque scope tokens; API/core revalidate at dispatch and pass only user-role reference context. Legacy global skills become inert saved references.
**Tech Stack:** Existing TypeScript/Jest, no new dependencies.
**Spec:** ../specs/2026-11-24-skill-registry-design.md

## Constraints and review focus

No remote import/catalogue execution, hooks, permission grants, persisted activation or new UI. Enforce exact identity/version/trust, UTF-8 bounds including wrapper, revocation across callbacks/fallback, no automatic queue/memory carryover and #198–199 regressions.

- [x] Registry unit RED/GREEN: strict metadata, limits, conflicts, opaque session/activation tokens and canonical bounded context. Files: skill-registry.ts and its tests.
- [x] Entry-point RED/GREEN: real sendChatMessage + core, positive user-context placement, import/scoping failures, revocation, concurrent isolation, fallback, no queue/memory and denied model tool claims. Revalidate before each dispatch.
- [x] Legacy prompt RED/GREEN: getEffectiveSystemPrompt ignores saved skills; remove misleading enable controls/copy, retain saved references without auto activation.
- [x] Document supported API and limits; run check:required, coverage and local strict diff estimate. Independent review of trust boundaries and tests.
- [ ] Native commit/push hooks; verify automatic PR exact head/files and mandatory CI plus separate codecov/patch. Never manual merge; no #201.


## Validation and review

TDD reproduced missing import/scoping/context behavior and the legacy system-prompt promotion. Independent review found the MCP initialization revocation window; a transport guard and real-entry regression close it. A direct builtin attempt-callback revocation regression also failed before adding the final pre-adapter check. No remaining review blockers.

Final `EXPO_NO_TELEMETRY=1 npm run check:required` and full coverage run pass: 719 tests / 36 suites; registry 100% across all coverage metrics. Strict local patch estimate versus origin/main is 100/100 executable lines, including partially covered branches as misses. Global lines 95.71%, branches 89.90%. UI files are outside LCOV collection; hosted codecov/patch remains an independent publication check. Expo telemetry alone is disabled to avoid analytics writes outside the workspace; all hooks/checks remain enabled.

No live MCP/provider/catalogue or mobile UI was exercised. The new activation path is API-only; stored references do not automatically run. Existing opaque historical queue prompts are not retroactively sanitized.
