---
name: kbd-new-child
description: Create a child phase inside the currently-active node (arbitrary depth). Mirrors /kbd-new-phase but writes into phases/<parent>/children/<child>/, appends the new child to childPhases[], moves childPointer to it, and fires child:before. Use to split a parent phase into scoped sub-processes.
---

# /kbd-new-child

Create a child phase owned by the currently-active node.

## What this does

1. Validates the active waypoint has a resolvable node.
2. Validates the child name (kebab-case, no traversal, no slashes) and refuses duplicates.
3. Creates `.kbd-orchestrator/phases/<parent>/children/<child-name>/` with `goals.md`, `progress.json`, `handoff-in.md` (parent→child contract), and `scope.json` (context-isolation contract).
4. Atomically appends `<child-name>` to `childPhases[]`, sets `childPointer` to the new child, updates `currentTask` and `exactNextCommand` to scope to the child.
5. Fires `child:before` exactly once for the new child.
6. Emits Progress Signals and a confirmation banner.

## When to use

When a phase (or child) reveals work that's complex enough to deserve its own
scope but not big enough to be a sibling phase. Each child carries its own
`assessment.md` / `plan.md` / `execution.md` / `reflection.md` under
`phases/<parent>/children/<child>/`.

Compare to `/kbd-new-phase`, which creates a top-level sibling.

## Progress Signals (MANDATORY)

```
Starting kbd-new-child — <parent>/<child>
Completed kbd-new-child — <parent>/<child> ready for /kbd-assess
```

## Prerequisites

- A node MUST be active (the waypoint's resolvable path is non-empty).
- The proposed child name MUST NOT already appear in `childPhases[]`.
- `current-waypoint.json` MUST be valid JSON.
- The new depth MUST NOT exceed `project.json`'s `maxChildDepth` (default 4).

## How to invoke

```bash
boss-mini kbd-new-child.mjs <child-name> [goal-1] [goal-2] …
```

## Examples

```
/kbd-new-child auth-refactor "split user-model" "migrate sessions"
/kbd-new-child docs-sweep
/kbd-new-child perf-pass-1
```

## Hook integration

Fires `child:before` exactly once, **after** the waypoint flip, so hooks
reading state see the new child as authoritative. The hook's index is the
1-based depth of the new child; total is the configured `maxChildDepth`.
