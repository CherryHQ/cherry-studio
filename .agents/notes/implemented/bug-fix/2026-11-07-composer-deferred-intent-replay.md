# Agent Note: Preserve deferred composer requests until replay

Status: implemented

English | [中文](2026-11-07-composer-deferred-intent-replay.zh.md)

## Problem

The first toolbar interaction can occur before the rich composer loads. The fallback records the requested panel, paste, drop, or token insertion for replay after mounting the editor. The runtime erased that request before scheduling its replay. An intervening render that changes an effect dependency cancels the timer, leaving the replacement effect with no request to deliver. MP-31 intermittently reproduced a plus-button click with no attachment menu, including one failure across three focused executions.

The fallback-to-editor handoff also scheduled focus through TipTap's animation frame. The fallback could unmount before that frame, leaving focus on the document and losing the first typed character.

## Decision

Retain each deferred request while its replay is pending. Consume it inside the timer callback after confirming that the editor is still alive, immediately before delivery. Effect cleanup can cancel and reschedule pending work without losing the request; a completed replay cannot be repeated by a later render. Preserve the existing timer cleanup and editor event paths.

Restore the editor selection through TipTap, then focus its view synchronously before scrolling the selection into view. Retain the guard that preserves another active input and require actual fallback interaction before transferring focus.

## Alternatives considered

- Retrying clicks or preloading the editor in the E2E helper would hide the first-interaction failure.
- Removing the deferred timer would change ordering relative to mount-time focus restoration.
- Removing effect dependencies would retain stale panel callbacks.

## Consequences

Lazy loading remains intact; focus transfers synchronously when the interacted-with fallback unmounts. Deferred toolbar and transfer requests survive renders before delivery without introducing persistent state or data migration.

## Verification

- Regression — a component test reproduces a dependency change before replay, asserts actual pasted text appears exactly once in the editor DOM, and verifies the event does not reach the document paste handler. It fails before the repair and passes afterward.
- `pnpm test:renderer src/renderer/components/composer/__tests__/ComposerSurface.test.tsx src/renderer/components/composer/__tests__/ComposerSurface.lazy.test.tsx`: 212 tests passed.
- Electron — MP-31 completed the attachment upload and parsing flow in three consecutive focused executions after the repair; driver cleanup passed. Full cross-platform acceptance remains pending.
- Regression — `ComposerSurface.test.tsx` and `ComposerSurface.coldInput.test.tsx` pass 174 tests. The real TipTap cold-input case protects the first character and focus handoff; warm-editor and idle-mount cases preserve their separate contracts. Full Electron typing and the deferred painting-preset smoke case remain unaccepted.
