---
name: kbd-cancel
description: Use to gracefully cancel the active KBD run while preserving its checkpoint and immutable audit history. Requires a non-empty cancellation reason. Cancellation is terminal.
---

# /kbd-cancel

Cancel the active run as an explicit terminal operator action.

## Progress Signals (MANDATORY)

Before cancellation, emit:

```text
Starting kbd-cancel — <phase-name>
```

After durable cancellation, emit:

```text
Completed kbd-cancel — <phase-name> cancelled
```

## Procedure

1. Require a non-empty cancellation reason.
2. If this project's own runtime CLI is available, run its cancel command with
   the reason.
3. Otherwise, create `.kbd-orchestrator/PAUSE` first and atomically set the
   waypoint status to `cancelled` (via `lib/platform/atomic-write.mjs`'s
   `atomicWrite`), recording the prior status, reason, actor, and timestamp.
   Before writing, call `assertProjectionWritable(root, target)` from
   `lib/kbd/runtime-authority.mjs` — it throws when the waypoint is
   runtime-authoritative (`generatedBy === 'kbd-runtime'`), which is exactly
   the case where a direct write here would be wrong.
4. Preserve all checkpoints and dirty-work metadata.
5. Invoke a host-native cancel operation when the harness exposes one.

Cancellation is terminal. Resuming it requires a new run, never an in-place
status edit.
