---
name: kbd-audit
description: Use for a read-only causal audit of the active KBD run — exact position, lifecycle history, plan revision, ownership, blockers, and uncommitted work — without mutating anything.
---

# /kbd-audit

Produce a read-only causal audit of the active KBD run.

## Progress Signals (MANDATORY)

Before reading state, emit:

```text
Starting kbd-audit — <phase-name>
```

After rendering the report, emit:

```text
Completed kbd-audit — <phase-name> at revision <n>
```

## Procedure

1. Read the waypoint and phase state directly:
   `waypointLoad(filePath)` from `lib/kbd/waypoint.mjs` for the projection, and
   `.kbd-orchestrator/phases/<phase>/progress.json` for the ledger. If this
   project's own runtime CLI exposes an audit command, prefer that over
   re-deriving the report by hand.
2. Report lifecycle status, plan revision, last completed work, exact next
   work, pause/block reason, decisions, actor/device provenance, and drift.
   `isRuntimeAuthoritative(root)` from `lib/kbd/runtime-authority.mjs` tells
   you whether the waypoint is a canonical-runtime projection or a
   hand-authored/legacy one — call it out explicitly either way.
3. Include a read-only git status summary and diff summary; never include
   secrets or full transcripts.
4. If only legacy state exists, identify contradictory aliases, stale
   projections, malformed ledgers, and direct-writer risk explicitly.

This skill is read-only. Do not resume, migrate, repair, or execute work.
