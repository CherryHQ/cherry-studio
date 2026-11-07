# Agent Note: Preserve deferred composer requests until replay

Status: implemented

English | [中文](2026-11-07-composer-deferred-intent-replay.zh.md)

## Problem

The first toolbar interaction can occur before the rich composer loads. The fallback records the requested panel, paste, drop, or token insertion for replay after mounting the editor. The runtime erased that request before scheduling its replay. An intervening render that changes an effect dependency cancels the timer, leaving the replacement effect with no request to deliver. MP-31 intermittently reproduced a plus-button click with no attachment menu, including one failure across three focused executions.

## Decision

Retain each deferred request while its replay is pending. Consume it inside the timer callback after confirming that the editor is still alive, immediately before delivery. Effect cleanup can cancel and reschedule pending work without losing the request; a completed replay cannot be repeated by a later render. Preserve the existing timer cleanup and editor event paths.

## Alternatives considered

- Retrying clicks or preloading the editor in the E2E helper would hide the first-interaction failure.
- Removing the deferred timer would change ordering relative to mount-time focus restoration.
- Removing effect dependencies would retain stale panel callbacks.

## Consequences

The existing lazy-loading and focus ordering remain intact. Deferred toolbar and transfer requests survive renders before delivery without introducing persistent state or data migration.

## Verification

- Regression — a component test reproduces a dependency change before replay, asserts actual pasted text appears exactly once in the editor DOM, and verifies the event does not reach the document paste handler. It fails before the repair and passes afterward.
- `pnpm test:renderer src/renderer/components/composer/__tests__/ComposerSurface.test.tsx src/renderer/components/composer/__tests__/ComposerSurface.lazy.test.tsx`: 212 tests passed.
- Electron — MP-31 completed the attachment upload and parsing flow in three consecutive focused executions after the repair; driver cleanup passed. Full cross-platform acceptance remains pending.
