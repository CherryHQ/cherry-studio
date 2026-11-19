# Agent Note: Host-owned child thread residency

Status: proposed

English | [中文](2026-11-19-agent-child-residency.zh.md)

## Problem

Opening an agent session attaches every bound child thread in Main. Claude Code's `restoreChildren` opens each saved child, and Pi and Pi Durable open every child their root snapshot lists. Each attachment reads the full native archive into a `ChildThreadProjection` that stays loaded until the root closes. Only Pi Durable released a finished child, and only for the rest of that process.

In an Electron reproduction (17 Claude Code subagents, each reading 40 images), Main's heap stayed near 974 MB after every child finished. Reopening the idle session raised it from 94 MB to 877 MB without any new work. A larger run of the same workload crashed Main with a V8 out-of-memory error after about four minutes.

The [runtime contract](2026-10-17-agent-runtime-contract.md) ("Coordinate access without owning execution") leaves residency to the host. The host, however, had three copies of the child attachment state machine, and only one of them released anything.

## Proposal

- `src/main/ai/agentSession/ChildResidency.ts` owns child attachment for the Claude Code, Pi and Pi Durable connections. It covers the opening, attached, releasing and closing states, joined concurrent opens, pins for viewers and commands, views that follow a release and reopen, drain, and close.
- A connection hands every `Subagent` relationship it observes to the residency. A child is finished when its latest relationship reports `work: 'idle'`, a field that the [subagent work state](2026-11-19-agent-subagent-work-state.md) proposal adds to the runtime contract. The residency then flushes, releases and records any finished child that no viewer, command or loaded nested child pins.
- Releasing writes `checkpointMapping.child.settled` on the child's context row after the final flush. Close writes it for the finished children it stops. Attaching a settled child clears it.
- A reopen records settled descendants as released. Relationship replays leave them released and restore unsettled idle children one at a time. A released child is reloaded by a viewer (`childProjection`), a command (`messageChild`), a Pi child completion or usage attribution, or a relationship that reports it running.
- No schema migration is needed: `checkpointMapping` is JSON, and the child projection merges its writes into the existing child checkpoint.

## Alternatives considered

- **Evict inside each runtime adapter.** The contract keeps one native owner per runtime and rules out per-thread eviction without native verification. The duplicated projections live in Main, so the host owns the policy.
- **Keep eager restore and release right after attach.** A reopen would still load every archive at once at its peak, and every reopen would repeat the full read.
- **Infer finished from saved product rows.** A crash can leave rows that look complete while the native archive holds more. The marker is written only after a real flush of a finished child.
- **Use activity alone for every runtime.** Pi reports idle mid-request for a background child, and Claude reports unknown before `task_started`. Both would release live children.

## Acceptance criteria

- AC1 — Claude Code, Pi and Pi Durable connections attach, pin, release, drain and close children through `ChildResidency` (verification: unit)
- AC2 — A finished, unwatched child is flushed, released and marked settled while its root stays open, and its saved rows keep the final answer (verification: unit)
- AC3 — A reopen does not attach settled children; viewing or messaging one reloads it with its saved history, and a failed lazy attach can retry without duplicating the context row (verification: unit)
- AC4 — A running child is not released; a Pi background child in the middle of a request stays stoppable (verification: unit)
- AC5 — In the Electron reproduction, no `ChildThreadProjection` stays loaded after all children finish or after the idle session reopens, and Main keeps no host-side copy of child content (verification: Electron)

## Risks

- Children of sessions saved before this change have no marker. Every runtime restores them once and settles them.
- Content that a native owner delivers for a child after its release stays in the native archive until the child is opened again.
- The native Claude owner still holds every child's parsed transcript until its root connection closes, and its root archive read parses every child. In the reproduction this is about 276 MB of images after a live run and 122 MB after a settled reopen. Per-thread eviction there needs the native contract that the runtime contract defers.
