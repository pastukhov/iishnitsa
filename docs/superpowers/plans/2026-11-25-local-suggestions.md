# Local Suggestions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans with TDD and independent final review.

**Goal:** Mobile-only local opt-in feedback produces reviewed, inactive scoped drafts.
**Architecture:** Separate bounded store and deterministic scoring; Settings panel uses explicit enums and opaque review tickets. No agent or runtime coupling.
**Tech Stack:** TypeScript, React Native, AsyncStorage adapter, Jest/react-test-renderer.
**Spec:** docs/superpowers/specs/2026-11-25-local-suggestions-design.md

## Constraints and review focus

- No raw text, secrets, model calls, remote surfaces or automatic activation.
- Serialized writes, stale revision rejection and cancellation must preserve opt-out/delete.
- Scope changes must hide old snapshots and cancel pending interactions.
- Accept requires a fresh exact review; expiry/noisy evidence must block stale promotion.
- Invalid storage is not overwritten; storage failures cannot appear successful.

## Tasks

- [x] Store TDD: fixed replay fixtures, consent, validation, decay, caps/TTL, review/promotion, deletion/races/failures/cancellation.
- [x] Implement bounded store, static candidates, opaque tickets; snapshots immutable.
- [x] Mobile TDD: actual panel presses with real Zustand + fake AsyncStorage, scope change/delete/error, no outside-store effects.
- [x] Integrate panel in Settings and document explicit namespace, deletion and inactive-draft limits.
- [x] Full required tests, coverage (including panel), independent review; resolve confirmed failures.
- [ ] Native hooks/push/PR, exact head/files, PR Checks/CodeQL/Codecov/GitHub review. No manual merge, #205 excluded.
