# Refresh a graph

Load this reference when project files changed or the user requests a rebuild.

## Session and worktree bootstrap

```bash
compass ensure
```

Run `ensure` once when an installed agent session starts and after its working
directory changes to another Git worktree. It uses the normal incremental
pipeline and reports `initialized`, `updated`, or `current`. Leave
`compass-out/` inside the active worktree; do not share a mutable output root
between worktrees. Do not use `--force` for normal bootstrap.

## Structural update

```bash
compass update .
```

`update` performs deterministic local structural extraction and writes
`compass-out/graph.json`, `GRAPH_REPORT.md`, `graph.html` when allowed, and
`manifest.json`. The manifest lets later updates reuse unchanged work.

Common controls include:

```bash
compass update PATH --out DIR
compass update PATH --no-cluster
compass update PATH --force
compass update PATH --no-viz
compass update PATH --exclude PATTERN
```

Run `compass update --help` before combining options. Respect repository ignore
rules unless the user explicitly requests otherwise. `--force` disables normal
incremental reuse and is appropriate for suspected cache/root drift, not every
edit. `--no-gitignore` widens the scan boundary and should be deliberate.

`--no-cluster` leaves community-derived reports incomplete for architecture
questions. `--no-viz` avoids or removes visualization output but does not make
the graph itself less valid. Resolution and hub-exclusion options affect
community structure, so record them when results will be compared over time.

## Refresh decision

- Source changed: run `compass update .`.
- Only community parameters or visual output changed: consider
  `compass cluster-only`.
- Only community names are missing or stale: use `compass label --missing-only`.
- Documents, PDFs, Office files, or images changed: use `compass extract`
  with the intended semantic configuration.
- Unsure whether a path needs work: run `compass check-update PATH`.
- Active edit session: use `compass watch .`.

After refresh, run `compass reflect --if-stale` before using learned lessons.

## Output integrity

Treat a nonzero exit as a failed refresh. Do not report the graph current merely
because an older `compass-out/graph.json` still exists. If output looks invalid,
use:

```bash
compass diagnose multigraph --graph compass-out/graph.json
```

When the graph is valid but query results look outdated, compare the source root,
output directory, and graph selected by the query. Also inspect
`manifest.json` and the recorded project root before forcing a rebuild.

After a successful update, confirm the graph, report, and manifest correspond to
the same output directory. If a wiki or exported artifact matters, regenerate it
explicitly; `update` does not promise that every optional export is current.
