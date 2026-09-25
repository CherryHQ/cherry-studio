---
name: kbd-child-exit
description: "Exit the active KBD child loop: write its handoff-out, roll its progress up to the parent node, pop the position path, and return control to the parent. The --enter companion descends into a selected child so new children nest under it."
---

# /kbd-child-exit

Close the active child loop and return to the parent — the counterpart to
`/kbd-new-child`. With `--enter`, descend into the selected child instead.

## What this does

### exit (default)

1. Requires the active child to have a `reflection.md` (run `/kbd-reflect` for
   the child first; refuses otherwise).
2. Writes `handoff-out.md` in the child dir — deliverables, goal completion
   status, unresolved items, recommendations to the parent.
3. Rolls the child's progress up the ancestor chain (`lib/kbd/rollup.mjs`):
   each parent node's `progress.json` gains a `children{}` block
   (`status`, canonical implementation counters, legacy counter aliases,
   certification status, handoff, and completion timestamp).
4. Pops the last element of `path[]`, clears `childPointer`, and restores the
   parent's cursor — the parent loop resumes with the child's result visible.
5. Fires `child:after`.

### --enter

Descends into the currently selected `childPointer`: sets `path[]` to the child
chain and clears `childPointer`, so the next `/kbd-new-child` nests **under**
this child. Enter and exit are the child-navigation pair: select with
`/kbd-next-child`, descend with `/kbd-child-exit --enter`, return with
`/kbd-child-exit`.

## Progress Signals (MANDATORY)

Before any other action, emit:

```
Starting kbd-child-exit — <child chain>
```

When the child is closed (or entered), emit:

```
Completed kbd-child-exit — exited <child chain>
```

Use the canonical chain from `path[]`. Emit to plain response text.

## How to invoke

```bash
boss-mini kbd-child-exit.mjs          # exit
boss-mini kbd-child-exit.mjs --enter  # descend
```

Prerequisites: the waypoint `path[]` must have depth > 1 to exit; a
`childPointer` must be selected to `--enter`.

## Examples

```
/kbd-next-child auth-refactor      # select the child
/kbd-child-exit --enter            # descend into it (new children nest here)
# … run the inner loop, /kbd-reflect it …
/kbd-child-exit                    # write handoff-out, roll up, return to parent
```

## Hook integration

Fires `child:after` for the closing child. The opening `child:before` is fired
by `/kbd-new-child`.
