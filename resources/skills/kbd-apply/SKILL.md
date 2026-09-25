---
name: kbd-apply
description: KBD-owned spec-apply driver. Wraps a spec backend (openspec; native-kbd as the always-available fallback) and drives it ONE task at a time, so KBD stays the source of truth — every task boundary fires KBD hooks, emits a plain-text position signal, and syncs progress.json and the waypoint. Replaces the broken pattern of handing the turn to a bare "implement everything" command that runs outside KBD.
---

# /kbd-apply

The execute-phase work surface. `/kbd-execute` selects the backend and writes
the dispatch contract; **`/kbd-apply` walks the tasks.**

## Why this exists

Handing implementation to a backend's bare "implement everything" command
(OpenSpec's `/opsx:apply`, Spec Kit's `/speckit.implement`) fires no KBD
hooks, writes no `progress.json`, refreshes no waypoint — it funnels the user
out of the execute phase and loses the connection back to it. This driver
fixes that by making **KBD own the loop** and calling the spec backend per
task.

> **Hard invariant:** never invoke a backend's "do everything" command. Drive
> one task at a time through this skill.

## The per-task loop (what the model does each turn)

```bash
APPLY="boss-mini kbd-apply.mjs"
# Select the change from DERIVED state — see "Which change" below. Never from
# the waypoint's `exactNextCommand`.
CHANGE="<see 'Which change am I on' below>"

# 1. Read the task surface (TSV: id \t done \t title)
$APPLY list "$CHANGE"
read -r TOTAL COMPLETE REMAINING < <($APPLY progress "$CHANGE")

# 2. For each NOT-done task, one per turn:
$APPLY begin-task "$CHANGE" "$ID" "$I" "$TOTAL" "$TITLE"
#   → on the first observed task, opens change:before
#   → opens task:before and prints the canonical change/task signals

#   <<< implement EXACTLY this one task here (edit code/docs) >>>

$APPLY end-task "$CHANGE" "$ID" "$I" "$TOTAL" "$TITLE"
#   → marks the task done in the backend, syncs progress.json,
#     fires task:after, prints "Completed task <I> of <TOTAL>: <TITLE>"
#   → on the final task, closes change:after

# 3. After the LAST task: run the QA gate for this repo, then:
$APPLY verify  "$CHANGE"   # backend verify (openspec validate)
$APPLY archive "$CHANGE"   # backend archive (openspec archive)
```

The plain-text "Starting/Completed task i of n" lines are the **user-facing
guarantee**; the fired hooks are the extensibility layer (memory mirror,
custom reporters, overrides).

## Which change am I on

In this order:

1. `current-waypoint.json`'s `.nextChange`, when present.
2. Otherwise the first entry in `phases/<phase>/progress.json`'s `changes[]`
   whose status is not `DONE`, honouring the phase plan's order. For a child
   phase, read the child's ledger, not the parent's.

**Never select work from `exactNextCommand`.** It is a stored operator string
that is not rewritten by ordinary task completion and can drift far behind
actual progress. Treat it as the operator's stated intent — useful context
for *why* this phase is running, never an answer to *what to run next*.

## Subcommands

| Command | Effect |
|---|---|
| `detect [dir]` | print backend id: `openspec`, `native-kbd`, `speckit`, or empty |
| `list <change>` | tasks as TSV `id⇥done⇥title` |
| `progress <change>` | `total complete remaining` |
| `begin-task <change> <id> <i> <n> <title>` | open a missing `change:before`, then fire `task:before` + position signals |
| `end-task <change> <id> <i> <n> <title>` | mark done + sync + close `task:after`; the final task also closes `change:after` |
| `mark-done <change> <id>` | flip one task done (no hooks) |
| `verify <change>` | backend verify; non-zero exit = fail |
| `archive <change>` | backend archive |

## Backends

Two adapters are implemented: **openspec** (via the real `openspec` CLI,
spawned with no shell) and **native-kbd** (the always-available fallback
backed by `.kbd-orchestrator/changes/<change>/tasks.json`). `speckit` is
detected but not yet adapted in this port — `verify`/`archive` treat it as a
no-op, matching the upstream contract for a backend with no CLI verify step
and no archive step.

## Progress Signals (MANDATORY)

```
Starting kbd-apply — <change>
Completed kbd-apply — <change> (<n>/<n> tasks, verified + archived)
```

Per-task `Starting/Completed task <i> of <n>: <title>` signals are emitted by
the driver's `begin-task`/`end-task` — relay them verbatim to the user.

## Relationship to other skills

- `/kbd-execute` — selects backend, writes `execution.md`, then defers task
  execution to this skill.
- `/kbd-reflect` — consumes the per-task `progress.json` this driver maintains.
- Child loops (`/kbd-new-child`, `/kbd-next-child`) use this **same** driver,
  so nested phases get identical per-task reporting.
