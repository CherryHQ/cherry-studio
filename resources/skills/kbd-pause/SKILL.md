---
name: kbd-pause
description: Use to gracefully pause the active KBD run, checkpoint its exact position, and prevent every harness from steering execution until an operator resumes it. Operator intent always outranks agent continuation.
---

# /kbd-pause

Pause the active KBD run. Operator intent always outranks agent continuation.

## Progress Signals (MANDATORY)

Before acting, emit:

```text
Starting kbd-pause — <phase-name>
```

After the checkpoint is durable, emit:

```text
Completed kbd-pause — <phase-name> paused
```

## Procedure

1. Resolve the project containing `.kbd-orchestrator/`.
2. Require a non-empty reason from the arguments or the operator.
3. If this project's own runtime CLI is available, run its pause command with
   the reason.
4. Otherwise create `.kbd-orchestrator/PAUSE` first, then atomically update the
   waypoint to `status: "paused"` (via `lib/platform/atomic-write.mjs`'s
   `atomicWrite`), preserving its prior status as `previousStatus` and
   recording `pauseReason`, `pausedAt`, and `pausedBy`. Before writing, call
   `assertProjectionWritable(root, target)` from `lib/kbd/runtime-authority.mjs`
   — it throws when the waypoint is runtime-authoritative, meaning a direct
   write here would be out of band.
5. Report the last completed work, exact next work, dirty-work summary, and
   current plan revision. Do not execute the next command.

Never remove `PAUSE`, resume work, or reinterpret ordinary prose as a resume.
