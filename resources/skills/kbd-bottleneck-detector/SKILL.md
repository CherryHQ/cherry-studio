---
name: kbd-bottleneck-detector
description: Evaluate or repair canonical KBD task, phase, and ZeeSpec boundaries. Use when progress receipts, projections, or build gates may be stale, or when the user mentions "bottleneck detector". Do NOT use for creating or advancing phases (see kbd-new-child and kbd-next-phase).
---

# /kbd-bottleneck-detector

## Progress Signals (MANDATORY)

Before running the detector, emit:

```text
Starting kbd-bottleneck-detector — <status|evaluate|repair> <boundary>
```

After the detector returns, emit its actual outcome:

```text
Completed kbd-bottleneck-detector — <pass|blocked|repaired|pending_review>
```

Use the boundary and outcome returned by the detector. A blocked or pending
review result completes the detector operation without completing the boundary.

Run it directly:

```bash
boss-mini kbd-bottleneck-detector.mjs status
boss-mini kbd-bottleneck-detector.mjs evaluate task before <task-id>
boss-mini kbd-bottleneck-detector.mjs repair phase after <phase-id>
```

`evaluate` does not repair projections. `repair` may rewrite only derived KBD
waypoint, progress, and position projections; it must not change the canonical
revision. Treat `blocked` as a real lifecycle blocker and use the exact progress
signal returned by the command.

Diagnosing duplicate, missing, or out-of-order receipts, certification
failures, or authority ambiguity: the canonical authority is the signed KBD
event journal. Waypoint, progress, and position files are replayable
projections and never prove completion by themselves.

- A successful `before` receipt opens one obligation keyed by boundary kind and
  canonical subject. A duplicate start is blocked.
- A successful `after` receipt closes that obligation. Missing or out-of-order
  completion is blocked and records a typed blocker.
- Projection repair is safe only when replay leaves the canonical revision
  unchanged. Ambiguous authority permits no canonical mutation.
- Integration and certification gates require complete implementation state.
  Certification also requires closed boundaries, valid task completion
  receipts, a passed integration gate, no unfinished gate, and no unresolved
  blocker.

`guard evaluate --json` returns `outcome` (`pass`, `repaired`, or `blocked`),
`authoritativeRevision`, `position`, `findings`, `outstandingObligations`,
`exactSignal`, `repairedProjections`, and `receiptId`. Surface `exactSignal`
verbatim, followed by `Position: <position> @ revision <authoritativeRevision>`.
`status` exposes the same folded obligations and latest receipt/gate summaries.

Ordinary evaluation is deterministic, local, and network-free. At phase or
child completion, on ambiguous canonical authority, or after the same violation
twice at one revision, load and run the installed `adversarial-review` skill.

Never attach this detector to operator-requested Stop. Stop remains advisory and
fail-open.
