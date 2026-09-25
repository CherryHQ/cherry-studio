---
name: karpathy-progress-memory
description: >
  Record a successful KBD task, change, or phase boundary as a canonical,
  idempotent progress event. Use when a boundary transition succeeds, when
  recovering work after context loss, or when KBD progress must survive a
  memory-service outage without editing generated projections. Do NOT use for
  changing KBD position or status; use kbd-process-orchestrator instead.
version: '1.0.0'
license: MIT
compatibility: Node.js LTS (>= 22), git, prometheus CLI; pk optional
allowed-tools: file_system
metadata:
  author: Prometheus AGS
  version: '1.0.0'
  category: process
  tags: [process, kbd, progress, memory, recovery]
---

# Karpathy Progress Memory

This skill records one versioned event at a successful KBD boundary. The
recorder checks the event against `prometheus kbd status --json` before it
writes anything. A disagreement is an error to report; the recorder never
repairs or edits `progress.json`, `tasks.md`, a waypoint, or another generated
projection.

The record is written once to `.prometheus/session-log.md` and sent to the
project-scoped knowledge store through `pk ingest`. If `pk` or its backing
service is unavailable, the event is still recorded as `degraded`: the session
log entry and receipt already exist, so nothing is lost, and `--flush-degraded`
retries delivery once `pk` is reachable again. This degraded state is reported
and does not block later work.

## Progress Signals (MANDATORY)

Before recording a boundary, emit:

```text
Starting karpathy-progress-memory — <task|change|phase> <qualified identity>
```

After the recorder returns, emit its actual result:

```text
Completed karpathy-progress-memory — <recorded|degraded|duplicate>
```

Use the canonical boundary and identity from the validated event. Never print
`recorded` when the command returned a degraded result.

## Automatic boundary use

KBD invokes the recorder after successful task, change, and phase transitions.
The hook form derives its stable event identity from the canonical project and
run, boundary, qualified subject, and terminal status. A successor run can
reuse phase/change/task IDs without colliding with earlier receipts. Unrelated
later KBD revisions therefore replay as the same event. `observedAt` is receipt
metadata and is not part of semantic collision detection:

```sh
boss-mini record-progress.mjs \
  --project-root "$PWD" \
  --from-hook \
  --boundary task
```

`KBD_HOOK_NAME` must identify a task as `change-id:task-id` or
`change-id/task-id`. Change hooks carry the change ID. A failed or partial
transition cannot pass canonical validation and therefore cannot produce a
completion record.

Optional hook metadata:

- `KBD_TASK_CLASS`: `product`, `research`, `evidence`, `integration`, or
  `release`; defaults to `product`.
- `KBD_TASK_ELAPSED_HOURS`: decimal elapsed hours; defaults to `0`.
- `PK_BIN`: explicit `pk` path. A missing or failing command produces a
  `degraded` result.
- `KPM_PK_TIMEOUT_SECONDS`: bounded `pk` submission timeout from `0.1` to `10`
  seconds; defaults to `5`.

No KBD lifecycle skill in this repository fires the recorder automatically
yet — `hooks/hooks.json` carries no entry for it, on purpose: `pk ingest` can
take seconds, and every existing hook budget here is 1000 ms or less
(`lib/karpathy/hooks-budget.test.mjs` enforces that no future hook entry with
that budget dispatches to this recorder). Wiring this skill into the KBD
lifecycle is deferred to the phase that ports the KBD skills themselves
(`kbd-apply`, `kbd-execute`) to this repository; until then, invoke it
directly as shown above at a boundary, or run it manually for evidence.

## Explicit event use

For a manually assembled evidence boundary, validate an event matching
`references/schemas/progress-event.schema.json`:

```sh
boss-mini record-progress.mjs \
  --project-root /path/to/project \
  --input /path/to/progress-event.json
```

The event contains a stable ID; boundary status; canonical phase, change, and
task identity; task class and elapsed hours; touched files; verification
commands with exit codes and summaries; commit hash; blocker; and exact next
work. Payloads are bounded to 256 000 bytes and rejected when they contain
common secret forms or unsafe paths.

## Result contract

The command prints one JSON object on stdout:

- `recorded`: the session log and `pk` accepted the record.
- `degraded`: the session log was written but `pk` did not accept the record.
  Continue work and report this result; run `--flush-degraded` later to retry.
- `duplicate`: the stable event already has a complete receipt; no second
  append or memory write occurs.

Each receipt stores the original bounded event. If the process exits after the
session-log append and pending receipt but before `pk` delivery, the next run
resumes delivery from that snapshot under the same event lock. Hook replay
compares only canonical boundary identity; later HEAD, touched-file,
exact-next, and wall-clock changes do not rewrite the original record.

Exit `2` means the event, canonical identity, or required local write failed.
Do not change generated KBD files to make such an event pass.

## Flushing degraded receipts

```sh
boss-mini record-progress.mjs --project-root "$PWD" --flush-degraded
```

Retries delivery for every receipt that is incomplete or degraded, oldest
first, up to `--limit` receipts (default 25), and reports how many were
delivered, how many remain degraded, and how many were left unvisited.
