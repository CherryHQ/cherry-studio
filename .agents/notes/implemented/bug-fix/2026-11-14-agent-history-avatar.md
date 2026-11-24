# Agent Note: Current Agent avatars in historical messages

Status: implemented

English | [中文](2026-11-14-agent-history-avatar.zh.md)

## Problem

Message snapshots preserve their producing author's avatar. Using that snapshot unconditionally makes an existing Agent's historical messages retain an old avatar after a profile edit. Soft deletion also leaves the session's Agent ID intact, and a failed query can retain cached Agent data.

## Decision

The Agent adapter provides current avatars keyed by author ID. The shared message header prefers a matching current avatar and otherwise uses the message snapshot. Names and model identities remain historical. Home assistants do not provide this override. Image capture uses the same adapter.

The domain query hook treats a confirmed DataApi NOT_FOUND as absence even when cached data remains. Temporary errors retain cached data, and a successful read makes the Agent available again. Reuse the existing error predicate without changing DataApi cache semantics.

## Alternatives considered

- Rewriting historical snapshots would discard the original avatar and require history-wide writes.
- Applying a session avatar without matching the producing author ID could attribute another author's message incorrectly.
- Treating every query failure as deletion would replace avatars during temporary failures.

## Consequences

Existing Agents' historical messages follow profile avatar edits. Deleted Agents' messages retain their original avatar. Snapshot file references and database formats remain unchanged; no migration, extra profile query or mirror state is introduced.

## Verification

- Regression — MessageHeader and Agent adapter tests cover avatar edits, image-to-emoji changes, author-ID isolation, snapshot fallback and unchanged historical names.
- Regression — useAgent tests cover cached data during temporary errors, confirmed deletion and successful restoration; existing tab synchronization tests cover a consumer of the same hook.
- Regression — an Electron fixture using the real message component, Agent query and avatar IPC verifies an immediate avatar update and deletion fallback without calling an external model.
