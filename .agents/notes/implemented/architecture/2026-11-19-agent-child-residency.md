# Agent Note: Host-owned child thread residency

Status: implemented

English | [中文](2026-11-19-agent-child-residency.zh.md)

## Problem

Opening an agent session attached every bound child thread in Main. Claude Code's `restoreChildren` opened each saved child, and Pi and Pi Durable opened every child their root snapshot listed. Each attachment read the full native archive into a `ChildThreadProjection` that stayed loaded until the root closed. Only Pi Durable released a finished child, and only for the rest of that process.

In an Electron reproduction (17 Claude Code subagents, each reading 40 images), Main's heap stayed near 974 MB after every child finished. Reopening the idle session raised it from 94 MB to 877 MB without any new work. A larger run of the same workload crashed Main with a V8 out-of-memory error after about four minutes.

The [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md) ("Coordinate access without owning execution") leaves residency to the host. The host, however, had three copies of the child attachment state machine, and only one of them released anything.

## Decision

- `src/main/ai/agentSession/ChildResidency.ts` owns child attachment for the Claude Code, Pi and Pi Durable connections. It covers the opening, attached, releasing and closing states, joined concurrent opens, pins for viewers and commands, views that follow a release and reopen, drain (which also joins an in-flight release flush), and close.
- A connection reports whether a child's native work finished through `ChildResidency.finish`. The residency then flushes, releases and records any finished child that no viewer or command pins. The finished evidence stays runtime-specific:
  - Pi Durable: native facts report an idle run with a run end, and every input has an outcome.
  - Pi: the native child task status is completed, stopped or error, and every input has an outcome. Pi child activity can read idle while a background child's request is still running.
  - Claude Code: the child's task activity is idle. A child whose context row existed before this attachment also counts as finished when the owner reports no task state (`unknown`), because Claude background tasks end with their CLI process.
- Releasing writes `checkpointMapping.child.settled` on the child's context row (`AgentSessionContextService.settleChild`) after the final flush. Close writes it for the finished children it stops. Attaching a settled child clears it.
- A reopen records settled descendants as released (`restoreReleased`), and discovery skips them: root and child snapshots in every runtime, and Claude's archive relation replays. Claude restores only unsettled saved children, one at a time. A released child is reloaded by a viewer (`childProjection`), a command (`messageChild`), a Pi child completion or usage attribution, or a Pi or Pi Durable relation upsert.
- No schema migration is needed: `checkpointMapping` is JSON, and `saveProjectionTx` merges child writes into the existing child checkpoint.

## Alternatives considered

- **Evict inside each runtime adapter.** The contract keeps one native owner per runtime and rules out per-thread eviction without native verification. The duplicated projections live in Main, so the host owns the policy.
- **Keep eager restore and release right after attach.** A reopen would still load every archive at once at its peak, and every reopen would repeat the full read.
- **Infer finished from saved product rows.** A crash can leave rows that look complete while the native archive holds more. The marker is written only after a real flush of a finished child.
- **Use activity alone for every runtime.** Pi reports idle mid-request for a background child, and Claude reports unknown before `task_started`. Both would release live children.

## Consequences

- If a parent resumes a released Claude child (for example through `SendMessage`), the host does not observe it until a viewer opens it. Archive reads replay every relation, so a replay cannot be told apart from a live start. The child's saved rows reconcile from the archive when it opens.
- Children of sessions saved before this change have no marker. Claude Code and Pi Durable restore them once and settle them; Pi keeps them loaded, as before, until they complete again.
- A reopen no longer publishes background task events for settled children, because they are never attached.
- Content that a native owner delivers for a child after its release stays in the native archive until the child is opened again.
- The native Claude owner still holds every child's parsed transcript until its root connection closes, and its root archive read parses every child. In the reproduction this is about 276 MB of images after a live run and 122 MB after a settled reopen. Per-thread eviction there needs the native contract that the runtime contract defers.

## Verification

- AC1 — `pnpm typecheck:node` passes, and `pnpm test:main` over the 23 test files that cover the three connections, `ChildThreadProjection` and `AgentSessionContextService` passes (699 tests, 2 skipped); every connection now attaches, pins, releases, drains and closes children only through `ChildResidency`.
- AC2 — `PiDurableRuntimeConnection.test.ts` "releases a background child after its run ends and keeps its final answer", `PiRuntimeConnection.test.ts` "releases a finished child, leaves it unloaded on reopen, and reloads it for a message", and `desktopRuntime.integration.test.ts` "reopens a settled nested child on demand under its immediate parent after an attachment failure" each wait for the settled marker while the root stays open and read the final answer from saved rows.
- AC3 — `PiDurableRuntimeConnection.test.ts` "leaves a settled child unloaded on reopen until a viewer asks for it" and the Pi and Claude tests above record `ChildThreadProjection.attach` calls across a reopen: none before a view or message, then the saved history on reload; the Claude test fails its first lazy attach and the retry finds exactly one context row.
- AC4 — `PiRuntimeConnection.test.ts` "stops a running background child without cancelling a later parent turn": a background child held mid-request stays loaded, and `stopTask` stops it; activity-based Pi evidence failed this test before the task-status rule.
- AC5 — Electron dev instance on an isolated profile: after 17 Claude Code subagents × 40 images finish, all 17 contexts are settled, a heap snapshot holds 0 `ChildThreadProjection`, and Main's post-GC heap is 515 MB (974 MB before); a 40-child session saved before the change settles on its first reopen, and its next cold reopen holds 0 `ChildThreadProjection` at 240 MB (877 MB before), with every remaining image copy owned by `ClaudeProjection.messages` or `ClaudeFeed.native`.
