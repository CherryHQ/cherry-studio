# Agent Note: Subagent work state in the runtime contract

Status: proposed

English | [中文](2026-11-19-agent-subagent-work-state.zh.md)

## Problem

[Child residency](2026-11-19-agent-child-residency.md) releases a child once its native work has finished, and must reload a released child when its parent resumes it. The [runtime contract](2026-10-17-agent-runtime-contract.md) gives Main no common fact for either. `Activity` describes only a thread's foreground loop, and a `Subagent` relationship carries no state. Without one, Main has to work out "finished" separately for each runtime, from runtime-specific channels:

- Pi Durable: native facts read through `handle.durable.facts()`, plus input outcomes.
- Pi: a child task status that Main builds from Pi behavior events, plus input outcomes. Pi child activity can read idle while a background request is still running.
- Claude Code: task activity, which reads `unknown` before `task_started` and for a child known only from its archive.

Claude's owner also replays every relationship on each archive read. With no state on the relationship, Main cannot tell a replay from a child that started work again, so a released Claude child that its parent resumes (for example through `SendMessage`) would not be observed until a viewer opens it. Only Pi Durable announces a resumed child to its nearest loaded ancestor.

Each adapter already holds the native evidence. Claude's owner tracks every task from `background_tasks_changed` or `task_started` to its terminal notification. Pi and Pi Durable keep agent-behavior live facts (`idle`, `runEnd`) for every conversation.

## Proposal

### Contract

`Subagent` in `packages/agent-runtime/src/contracts.ts` gains an optional work state:

```ts
export interface Subagent {
  // id, parent, child, origin as before
  /** The owner's evidence for the child's native work; absent when the owner has none. */
  readonly work?: 'running' | 'idle'
}
```

- `running`: a child run is active, or admitted input is waiting for one. This includes a created child whose first run has not started.
- `idle`: the child has run, no run is active, and no admitted input is waiting. An owner reports `idle` only from positive native evidence.
- Work state describes the child thread, not an assignment. The relationship still carries no assignment outcome, and an idle child can work again.

An adapter that exposes relationships:

- includes `work` in snapshot `subagents`, in `subagent.upsert`, and in its typed `relation()` and `openChild()` results;
- publishes `subagent.upsert` on the parent's observation whenever the child's work state changes;
- reports current evidence when it replays relationships, so a replay never reads `running` for a child that is not working.

Evidence per adapter:

- Claude Code: the owner's task table. A task is `running` from `background_tasks_changed` or `task_started` until `task_notification` or a terminal `task_updated`. A child known only from the archive is `idle`, because background tasks end with the CLI process that ran them.
- Pi: the child conversation's live facts (no active run and nothing queued, after a recorded run end). The adapter publishes them from the run start and end hooks that the behavior layer already calls. A child that is not loaded in this process is `idle`.
- Pi Durable: the child conversation's native facts (`live.idle` and `runEnd`). The adapter publishes them from its commit observer when the child's live state changes. The existing resumed-input announcement carries `running`.

### Host

`ChildResidency` consumes relationships:

- Each connection hands every relationship it observes to the residency. A loaded child counts as finished exactly when its latest relationship reads `idle`.
- A released child reloads when a relationship reports it as anything other than `idle`, so a parent that resumes it is observed. It stays released on an `idle` replay.
- A loaded nested child keeps its parent child loaded, so the parent's observation keeps delivering the nested child's relationships.
- A command (`messageChild`) leaves the child loaded until a relationship that arrives after the command reports `idle`.

No connection computes runtime-specific finished evidence, and Claude's reopen no longer restores saved children from their context rows. Background task events for the UI stay as they are.

## Alternatives considered

- **Widen `Activity` to cover background and admitted work.** A child's own observation stops when the child is released, so it cannot report that the parent resumed it, and Main would still need to tell replays from live starts. Root activity also drives Main's turn tracking; widening it would change when root turns start.
- **Mark each `subagent.upsert` as live or replayed.** That tells Main when to reload a child but not when one finished, so the finished evidence would stay per runtime.
- **Add assignment outcomes (`completed`, `failed` and so on) to the relationship.** The [subagent control note](2026-10-18-agent-runtime-subagent-control.md) keeps assignment outcomes separate from the relationship, and residency only needs to know whether work remains.

## Acceptance criteria

- AC1 — Claude Code, Pi and Pi Durable relationships read `running` while a child run is active or input waits for one and `idle` after the run ends, in parent snapshots and in upserts on the parent's observation (verification: unit)
- AC2 — A replayed relationship for a child that is not working reads `idle`: Claude archive reads, Pi root reopen and Pi Durable reopen (verification: unit)
- AC3 — Main releases a finished child only from its relationship's work state; no connection computes per-runtime finished evidence (verification: unit)
- AC4 — A released child that its parent resumes is reloaded and observed without a viewer, in Claude Code, Pi and Pi Durable (verification: unit)
- AC5 — A running nested child keeps its parent child loaded, and both release after the nested child finishes (verification: unit)
- AC6 — In the Electron reproduction (17 Claude Code subagents, each reading 40 images), every child still settles after the live run and the next cold reopen loads none of them (verification: Electron)

## Risks

- An adapter that misses a transition either keeps a child loaded until its root closes (a missed `idle`) or leaves a resumed child unobserved (a missed `running`). An absent `work` keeps the child loaded.
- Pi Durable reads child facts on commits that change a child's live state, which adds reads in proportion to the loaded parents' children.
- A nested child whose parent is released and that resumes without its parent running is still observed only when a viewer or command opens it, except in Pi Durable, which announces it to its nearest loaded ancestor.
