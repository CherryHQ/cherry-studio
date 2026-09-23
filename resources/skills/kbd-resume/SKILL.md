---
name: kbd-resume
description: Use to resume a paused KBD run after validating its checkpoint and plan revision. A normal assistant response is never a resume signal — resuming requires this explicit skill.
---

# /kbd-resume

Resume an explicitly paused KBD run. A normal assistant response is never a
resume signal.

## Progress Signals (MANDATORY)

Before validation, emit:

```text
Starting kbd-resume — <phase-name>
```

After the transition, emit:

```text
Completed kbd-resume — <phase-name> running at plan revision <n>
```

## Procedure

1. Resolve the project and read the current checkpoint.
2. Refuse unless the state is `paused`, `pause_requested`, or `blocked`.
3. When the operator supplies a correction reason or replacement next work,
   record a plan revision bump through this project's own runtime CLI when
   available (passing `--reason` and `--exact-next-work`). Use the returned
   N+1 revision; never edit or overwrite the prior plan record.
4. If this project's own runtime CLI is available, run its resume command,
   forwarding the plan revision when supplied or created in step 3.
5. Otherwise validate the requested plan revision, atomically restore
   `previousStatus` (default `running`) via `lib/platform/atomic-write.mjs`'s
   `atomicWrite` (after checking `assertProjectionWritable(root, target)` from
   `lib/kbd/runtime-authority.mjs`), record resume metadata, and move
   `.kbd-orchestrator/PAUSE` to a timestamped audit file.
6. Print the exact resumed command. Do not silently execute it unless the
   operator also requested execution.

Never resume across a plan-revision mismatch.
