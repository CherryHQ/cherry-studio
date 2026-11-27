# Agent Note: Bounded failure for silent agent replies

Status: implemented

English | [中文](2026-11-25-agent-reply-inactivity.zh.md)

## Problem

Agent replies can stop producing native events or hold intermediate success while background results remain pending or unattributable. The five-minute idle-resource TTL excludes active execution. The existing 120-minute product-stream inactivity backstop does not express runtime-event progress or immediate unexpected EOF failure.

## Decision

Main supervises the current native execution owner with one 30-minute runtime-event inactivity watchdog, starting when its stream opens before connection setup. Qualifying content, usage, background activity and native execution transitions renew it; renderer attachment, context reads and queue edits do not. Held success remains supervised for non-empty and unknown pending results. Unexpected EOF fails unresolved execution immediately.

Confirmed human approvals observed on the same connection generation pause the deadline. Answering or aborting the final applicable approval grants a fresh interval, including immediate rejection during request handling. Only public registry facts determine the exemption, without requiring a context ID or inferring child blocking. The existing two-hour approval backstop remains unchanged; EOF still fails during approval waits.

Failure injects a reducer error, withdraws queued follow-ups and owned deferred placements, retains assistant identity and received content, synchronously detaches the connection and closes it asynchronously. Persistence acknowledgement remains valid. Entry, reply, watchdog and connection-generation fences protect successor work. Recovery requires explicit user retry after checking tool side effects; there is no automatic retry.

## Alternatives considered

- A per-turn held-success-only deadline: misses silence before native completion and needlessly supervises suspended replies.
- A renderer watchdog: depends on window attachment and cannot own native retirement and persistence.
- A driver heartbeat: changes transport and can hide stuck execution; runtime-event supervision belongs to the host.
- No change: leaves held replies without a runtime-aware bound and delays explicit EOF failure until another backstop.

## Consequences

A genuinely silent foreground tool running for 30 minutes or longer now fails even if healthy. Qualifying background activity renews the timer even when parent text and token counts freeze. A same-connection approval can conservatively exempt unrelated work because native events cannot prove which child blocks which reply. The five-minute resource TTL, 120-minute stream backstop, two-hour approval backstop and Stop/close bounds remain unchanged. Main's event loop must run for timers to fire.

## Verification

- AC1 — `AgentSessionRuntimeService.test.ts`: silence fails exactly at the inactivity bound, once, including during connection setup and before any body content; terminal persistence changes the same pending assistant row to error.
- AC2 — `AgentSessionRuntimeService.test.ts`: unresolved and held-success EOF fail immediately, while terminal handoff and deliberate Stop/close remain intact; hanging close does not delay visible failure.
- AC3 — `AgentSessionRuntimeService.test.ts`: pending and unknown result holds fail on the same reply; background events renew, bookkeeping does not, and confirmed approvals pause until the last answer or abort.
- Regression — `AgentSessionRuntimeService.test.ts` and `agentSessionRuntimeState.test.ts`: queued follow-ups are withdrawn, stale callbacks cannot fail successors, and idle background occupancy has no reply watchdog.
