# Compass command reference

Load this reference when selecting a command, reviewing automation, or checking
whether a Compass capability is covered by the installed skill. Run
`compass <command> --help` for the current option syntax.

## Read and navigate

- `compass capabilities`: report versioned, read-only machine contracts for
  editor and automation integrations.
- `compass ask`: route a direct natural-language structural question to a
  bounded, deterministic typed query operation.
- `compass search`: find typed symbols by name using the local FTS index.
- `compass callers`: list direct typed incoming usages, including calls,
  routes, references, imports, exports, and aliases.
- `compass callees`: list direct typed call-graph successors.
- `compass impact`: compute bounded transitive change impact, excluding
  heuristic evidence unless explicitly requested.
- `compass explore`: return related source grouped by file plus connecting
  paths in one bounded response.
- `compass node`: show an attributable evidence trail between two symbols.
- `compass context`: compose a bounded, digest-verified evidence packet for an
  explain, modify, debug, or test task after exact target resolution.
- `compass agent-graph`: prepare, inspect, apply, query, diff, and export an exact
  GROUNDED agent-authored overlay. Writes require explicit local enablement;
  select either the current Base Graph or an exact `--realization`, and always
  name an exact Overlay Revision for Effective Graph reads. Base Graph facts
  and historical realizations remain immutable.
- `compass call-graph`: trace bounded callers, callees, or both from a source
  position or structural symbol, with optional Program IR enrichment.
- `compass query`: budgeted, deterministic pages of natural-language graph
  traversal, or deterministic CompassQL.
- `compass program`: inspect canonical Program IR functions, coverage, callers,
  and call evidence, or run CompassQL over its read-only graph projection.
- `compass path`: shortest known graph route between two matched nodes.
- `compass explain`: budgeted, deterministic pages for one matched node plus
  its local neighborhood.
- `compass architecture`: bounded architecture projection with explicit
  coverage, omissions, and witness IDs for agent inspection.
- `compass affected`: downstream review candidates, optionally filtered by
  relation and depth. Typed graphs use the same source-backed relationship
  resolver as `callers` and `impact`; use `--format json|agent-json` when an
  agent needs diagnostics and evidence counts.
- `compass tree`: repository hierarchy enriched with graph metadata.
- `compass history`: configure, materialize, inspect, export, prefer, or garbage
  collect immutable commit realizations.
- `compass diff`: compare two revision graphs and optionally topology, locations,
  analysis, or metadata.
- `compass benchmark`: measure query behavior for one graph on the current
  machine.
- `compass diagnose multigraph`: validate graph shape and report problematic
  parallel or reciprocal relationships.
- `compass check-update`: report whether watched semantic changes left a pending
  refresh marker.
- `compass store status|validate`: inspect and validate the local SQLite graph
  sidecar without changing graph meaning.
- `compass store backup`: checkpoint and copy a validated local generation into
  a new backup directory with a signed-by-digest manifest.
- `compass store restore`: validate that manifest, graph export, selector, and
  sidecar before restoring into a new or empty output directory.

These commands are read-only. An `--at REV` query requires an existing
materialized realization; run `compass history build REV --code-only` explicitly
before querying an uncached revision. Query caches may still be refreshed, but
no extraction or credential-dependent provider runs implicitly.

## Build and enrich

- `compass ensure`: idempotent session/worktree bootstrap using the incremental structural pipeline.
- `compass update`: deterministic structural refresh after project changes.
- `compass extract`: structural plus optional semantic, Cargo, PostgreSQL, or
  Google Workspace layers.
- `compass document`: inspect PDF, DOCX, PPTX, or XLSX content locally, with
  optional managed OCR and typed JSON evidence.
- `compass models`: list, install, or verify the pinned OCR model profiles in
  the Compass cache; no system OCR package is required.
- `compass watch`: long-running deterministic refresh and semantic-staleness
  detection.
- `compass cluster-only`: recompute communities and visual/report artifacts from
  existing extraction.
- `compass label`: generate or complete human-readable community labels.
- `compass add`: download an external URL into the selected local source folder.
- `compass clone`: clone or update a supported GitHub repository checkout.

`extract`, `label`, `add`, and `clone` may cross a network boundary. `watch` is
long-lived. Every command in this group writes local state.

## Publish, compose, and serve

- `compass export`: create HTML, call-flow HTML, Obsidian, wiki, SVG, GraphML,
  Neo4j, or FalkorDB artifacts; database `--push` is a remote write.
- `compass serve`: long-running MCP server over stdio or HTTP.
- `compass merge-graphs`: compose explicit graph JSON files into one artifact.
- `compass global`: add, remove, list, or locate graphs in the cross-project
  registry.
- `compass prs`: inspect pull requests, worktrees, likely conflicts, base
  branches, and graph impact.
- `compass review`: analyze one exact target/head candidate and emit a typed PR
  Intelligence report as reviewer text, canonical JSON, bounded Markdown, or
  SARIF; add `--readiness` for the independent digest-linked readiness
  envelope. Local mode resolves `--base` and `--head` without fetching; GitHub
  mode freezes the revisions identified by `--pr` and `--repo` and requires
  those objects in the local repository.
- `compass merge-driver`: three-way merge entry point for a configured Git merge
  driver, not an ordinary file merge command.

Keep repository origins and graph revisions visible when composing results.
Never treat PR impact as proof of a textual conflict.
Advisory risk from `review` is reviewer evidence, not an exit-status policy.
Only the Action's explicit `fail-on: deterministic` setting may turn a proven
deterministic gate failure into a failing check.

## Knowledge and semantic operations

- `compass provider`: add, list, show, or remove semantic provider definitions.
- `compass save-result`: persist a useful, dead-end, or corrected query result.
- `compass reflect`: synthesize corroborated saved results into project lessons.
- `compass cache-check`: split semantic inputs into cached and uncached work.
- `compass merge-chunks`: combine valid semantic result chunks.
- `compass merge-semantic`: combine cached and newly produced semantic layers.

Provider mutations change user configuration. Result saving and reflection write
durable project knowledge. The three cache/merge commands are low-level recovery
tools and must not replace normal extraction without a reason.

## Installation and hooks

- `compass agent`: list, install, diagnose, export, validate, or render MCP
  configuration for a supported coding-agent integration.
- `compass install`: install the canonical skill and platform integration.
- `compass uninstall`: remove managed integrations; `--purge` additionally
  removes Compass output and requires explicit user intent.
- `compass upgrade`: verify and install the latest stable Compass release.
- `compass hook`: install, inspect, or uninstall repository refresh hooks.
- `compass hook-check`: no-op probe owned by installed hook configuration.
- `compass hook-guard`: adapter owned by installed search/read/Gemini guards.

Do not call `compass hook-check` or `compass hook-guard` as ordinary user
workflows. Their stdin/stdout contracts are platform integration details.

`history-worker`, `hook-spawn`, and `hook-refresh` are intentionally absent from
the public command list. They are process and hook implementation details. Do
not invoke them directly; use `compass history`, `compass hook`, or
`compass install` to manage the owning lifecycle.
