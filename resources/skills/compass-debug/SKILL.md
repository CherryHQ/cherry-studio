---
name: compass-debug
description: "Debug failures with Compass graph evidence: trace stack symbols, suspicious callers, regressions, error propagation, and nearby tests. Use when diagnosing a bug, crash, failing test, or unexpected behavior; use compass-change-impact for pre-edit blast-radius review."
compatibility: "Requires the Compass CLI and an Agent Skills-compatible coding agent."
metadata:
  version: "1"
  product: "compass"
---

# Compass Debug

Use the Compass graph to turn a failure symptom into a small, testable source
hypothesis. A graph relationship is evidence for where to inspect; it does not
replace reproducing the failure or reading the implementation.

## Workflow

1. Capture the exact symptom: failing command or test, error text, stack symbol,
   affected input, and the last known good behavior.
2. Resolve the selected graph. If it is absent or stale, use
   `compass-index-maintenance` before drawing conclusions.
3. Locate the symptom with `compass search`, then use `compass callers`,
   `compass callees`, `compass call-graph`, or `compass explain` to inspect the
   nearest propagation path.
4. Use `compass path` when the hypothesis depends on a specific route between
   two symbols. Preserve direction; a reverse-only path is not the requested
   path.
5. Inspect the returned implementation and its closest tests. Form one concrete
   hypothesis and run the narrowest reproduction that can falsify it.
6. If a fix is authorized, implement it at the owning boundary and add the
   lowest useful regression test. Refresh the graph once after final code edits.

## Boundaries

- Do not infer a root cause from name similarity or graph proximity alone.
- Do not select one of several exact-name matches without disambiguating it.
- Keep failure handling, limits, cleanup, and platform behavior in the
  hypothesis when they are relevant.
- Distinguish directly observed calls from inferred or unresolved edges.
- Do not mutate code when the request is diagnosis-only.
- Use `compass-change-impact` when the main question is what a proposed change
  could affect rather than why current behavior fails.

Report the reproduction, the evidence path, the verified source cause, and any
remaining uncertainty.
