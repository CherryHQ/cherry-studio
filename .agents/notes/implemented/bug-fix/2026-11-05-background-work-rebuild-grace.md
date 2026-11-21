# Agent Note: bound the background-work rebuild deferral

Status: implemented

English | [中文](2026-11-05-background-work-rebuild-grace.zh.md)

## Problem

A spawn-frozen configuration change forces a connection rebuild, but detached background work (a `run_in_background` shell, a background agent, or a DSH background flow) may still occupy the warm connection. `ensureConnection()` deferred the rebuild behind `waitForBackgroundWorkRelease()` — a promise that settled only when the driver reported the work released or the connection died. Detached work has no host-side liveness probe, so work whose process died without a release signal (an OS restart the runtime never observed) left the waiter pending forever and every later turn stuck in admission. The 2026-09-18 production incident left a user's persisted message unadmitted for 5m40s until a manual SIGTERM tore the connection down.

## Decision

Bound the deferral with `BACKGROUND_WORK_REBUILD_GRACE_MS` (120 s). On expiry the waiter settles `false` and the caller decides:

- A live turn of the connection's own execution (an autonomous generation, a transition, or an admitted turn that began during the wait) is driver-reported live work; forcing the rebuild would kill it, so the grace window is re-armed and its own release still settles the waiter.
- With no turn waiting to admit (a prewarm re-prime), the deferred rebuild is abandoned and the next real turn re-reconciles.
- Otherwise, a pending user turn outranks unowned occupancy: the rebuild is forced through the regular teardown path, which structurally clears the occupancy before reconnecting.

A natural release inside the window wins and clears the grace timer, so a stale timer cannot fire into a successor waiter. Expiry logs `Background work did not release within the grace period` with `sessionId` and `graceMs`; forced and abandoned paths log their own lines.

## Alternatives considered

- **Error the pending turn instead of forcing the rebuild** — dropped: it preserves live work but leaves a zombie permanently wedged, because every later turn re-defers and re-errors, and the connection never recovers.
- **Admit on the stale connection after the grace** — dropped: a `rebuild` verdict means spawn-frozen facts differ, so the turn would run under the old configuration.
- **Driver liveness probe when a session reopens** — deferred as a follow-up: distinguishing dead from live detached work needs a new runtime API surface. The bounded wait caps a zombie's damage at one grace period and then recycles it through the teardown.
- **Surface the deferred state in the renderer** — deferred: `connection.pendingRebuild` exists in the state machine but has no display spot; adding one is a product decision.

## Consequences

A pending user turn waits at most 120 s for unowned detached work; live work that legitimately needs longer is destroyed by the teardown — the same outcome a session close, idle TTL, or app exit already produces. Live autonomous work is never killed by the grace expiry, and a prewarm rebuild loses nothing but its own deferral. The timer is `unref()`'d and cleared on every natural release path, so it cannot outlive its waiter. The deferred state remains invisible to the renderer.

## Verification

- Regression — `AgentSessionRuntimeService.test.ts`: forces the connection rebuild when background work never releases within the grace period.
- Regression — same file: does not force the rebuild over an autonomous generation that began during the grace window, and re-arms the window.
- Regression — same file: abandons the deferred rebuild instead of forcing it when no turn is waiting.
- Regression — same file: cancels the forced rebuild once background work releases within the grace period, clearing the timer.
