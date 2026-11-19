# Agent Note: Subagent work state in the runtime contract

Status: implemented

English | [中文](2026-11-19-agent-subagent-work-state.zh.md)

## Problem

[Child residency](2026-11-19-agent-child-residency.md) releases a child once its native work has finished, and must reload a released child when its parent resumes it. The [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md) gives Main no common fact for either. `Activity` describes only a thread's foreground loop, and a `Subagent` relationship carries no state. Without one, Main has to work out "finished" separately for each runtime, from runtime-specific channels:

- Pi Durable: native facts read through `handle.durable.facts()`, plus input outcomes.
- Pi: a child task status that Main builds from Pi behavior events, plus input outcomes. Pi child activity can read idle while a background request is still running.
- Claude Code: task activity, which reads `unknown` before `task_started` and for a child known only from its archive.

Claude's owner also replays every relationship on each archive read. With no state on the relationship, Main cannot tell a replay from a child that started work again, so a released Claude child that its parent resumes (for example through `SendMessage`) would not be observed until a viewer opens it. Only Pi Durable announces a resumed child to its nearest loaded ancestor.

## Decision

### Contract

`Subagent` in `packages/agent-runtime/src/contracts.ts` has an optional `work?: 'running' | 'idle'`, the owner's evidence for the child's native work:

- `running`: a child run is active, or admitted input is waiting for one. This includes a created child whose first run has not started.
- `idle`: the child has run, no run is active, and no admitted input is waiting. An owner reports `idle` only from positive native evidence.
- Work state describes the child thread, not an assignment. The relationship still carries no assignment outcome, and an idle child can work again.

Adapters include `work` in snapshot `subagents`, in `subagent.upsert`, and in their typed `relation()` and `openChild()` results. They publish `subagent.upsert` on the parent's observation whenever the child's work changes, and report current evidence when they replay relationships.

Evidence per adapter:

- Claude Code: the owner's task table in `owner.ts`. A task is `running` from `background_tasks_changed` or `task_started` until `task_notification` or a terminal `task_updated`, and each change publishes its relationship. A child known only from the archive is `idle`, because background tasks end with the CLI process that ran them. Archive recovery takes a child's parent from its recorded parent agent, then from the transcript holding its spawning Agent/Task call, and otherwise treats it as a direct child of the root, as the SDK reports depth-1 parents as null. A cold archive read therefore replays every child relationship.
- Pi: `PiBehaviorOptions.onWork` reports a thread's live state (no active run, nothing queued, Pi idle) each time the behavior layer refreshes results, which it does at every run start and end. The runtime publishes a change on the parent that lists the child. A loading child keeps its known work, and relationships replayed when a root opens read `idle`.
- Pi Durable: commit observation tracks each child's committed run (`pi.live`) and queued input (`pi.inbox`) and publishes a change on the loaded parent. Opening a parent and `relation()` read both documents. A child created in this process reads `running` until its first run ends. The resumed-input announcement carries `running`.

### Host

`ChildResidency.relate(relation, open)` consumes every relationship a connection observes:

- An attached child takes the relationship and is released once it reads `idle` and no viewer, command or loaded nested child pins it.
- A child whose relationship is not `idle` is opened, including a released one, so a child its parent resumes is observed without a viewer.
- An idle child that the residency has not seen and that is not settled is restored one at a time and then released.
- A loaded nested child pins its attached parent child until the nested child is released.
- `command()`, used by `messageChild`, clears the child's work evidence and pins it, so only a relationship that arrives after the command can release it.

No connection computes runtime-specific finished evidence, and Claude's reopen no longer restores saved children from their context rows. Background task events for the UI are unchanged.

## Alternatives considered

- **Widen `Activity` to cover background and admitted work.** A child's own observation stops when the child is released, so it cannot report that the parent resumed it, and Main would still need to tell replays from live starts. Root activity also drives Main's turn tracking; widening it would change when root turns start.
- **Mark each `subagent.upsert` as live or replayed.** That tells Main when to reload a child but not when one finished, so the finished evidence would stay per runtime.
- **Add assignment outcomes (`completed`, `failed` and so on) to the relationship.** The [subagent control note](../../proposed/architecture/2026-10-18-agent-runtime-subagent-control.md) keeps assignment outcomes separate from the relationship, and residency only needs to know whether work remains.

## Consequences

- An adapter that misses a transition either keeps a child loaded until its root closes (a missed `idle`) or leaves a resumed child unobserved (a missed `running`). An absent `work` keeps the child loaded.
- Pi Durable reads one conversation record for each child work change to find the loaded parent, and the live and inbox documents of every child when a parent opens.
- A Claude reopen restores unsettled children from the archive's relationship replay instead of saved context rows. A saved child that the archive no longer lists attaches only when a viewer or command opens it.
- A nested child whose parent is released and that resumes without its parent running is still observed only when a viewer or command opens it, except in Pi Durable, which announces it to its nearest loaded ancestor.

## Verification

- AC1 — `packages/agent-runtime-claude-code/tests/runtime.test.ts` "continues the same child with a new native run (cold=%s)", `packages/agent-runtime-pi/tests/behaviorRuntime.test.ts` "continues the discovered child in place, streams to shared handles and delivers its next run once", `packages/agent-runtime-pi/tests/runtimeLifecycle.test.ts` "keeps child observations and native identity across continuation" and `packages/agent-runtime-pi-durable/tests/runtime.test.ts` "discovers native forks and archives only child-owned output independently of the parent" read `running` while the child works and `idle` after each run, from the parent's upserts and snapshot; the package suites pass (Claude Code 124 tests, Pi 224 with 5 skipped, Pi Durable 181 with 6 skipped).
- AC2 — The Claude test reads `idle` after `claude.archive()` replays the relationship, cold and warm; Pi "restores child relations on reopen and refuses a child without its live owner" replays `work: 'idle'`; the Durable test reads `idle` from the restored parent snapshot, `relation()` and a cold reopen's events.
- AC3 — `src/main/ai/agentSession/__tests__/ChildResidency.test.ts` drives a real `ChildThreadProjection` through relationships alone: an idle replay leaves a released child released, unseen idle children restore one at a time, and a commanded child stays loaded until an idle relationship after the command; no connection computes runtime-specific finished evidence, `pnpm typecheck:node` passes, and `pnpm test:main` over 24 files covering the residency and the three connections passes (706 tests, 2 skipped).
- AC4 — `PiRuntimeConnection.test.ts` and `PiDurableRuntimeConnection.test.ts` "reloads a released child that its parent continues and saves its continued answer without a viewer", and `desktopRuntime.integration.test.ts` "reloads a settled child that its parent resumes and saves its continued answer without a viewer" (real Claude CLI through `SendMessage`); the Pi test fails without `onWork` upserts and the Claude test fails with the previous skip-released behavior.
- AC5 — `ChildResidency.test.ts` "keeps a parent child loaded while its nested child works and releases both after it ends" fails when the nested child does not pin its parent.
- AC6 — Electron dev instance on an isolated profile: after 17 Claude Code subagents × 40 images finish, all 17 child contexts are settled, a heap snapshot holds 0 `ChildThreadProjection`, and Main's post-GC heap is 515 MB; after a quit and cold restart that reopens the session, 0 `ChildThreadProjection` are loaded, all 17 contexts stay settled with no restore failures, and the post-GC heap is 223 MB.
