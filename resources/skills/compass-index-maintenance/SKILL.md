---
name: compass-index-maintenance
description: "Maintain Compass graph artifacts: initialize, update, refresh, watch, diagnose, and recover a missing, stale, oversized, or invalid index. Use for graph freshness, build failures, output health, and index lifecycle; use compass-navigate after the graph is ready."
compatibility: "Requires the Compass CLI and an Agent Skills-compatible coding agent."
metadata:
  version: "1"
  product: "compass"
---

# Compass Index Maintenance

Use this skill when Compass graph artifacts are absent, stale, invalid, or
failing to build. Keep graph generation local and deterministic unless the user
explicitly selects a semantic provider or another external integration.

## Workflow

1. Identify the selected source root, output root, graph path, and any explicit
   revision. Never repair one graph and report a different graph as current.
2. Run `compass capabilities --format json` before relying on a machine
   contract, and reject an unknown major version.
3. Use `compass init` when repository scope must be selected and persisted.
   Otherwise use `compass update .` for a structural refresh.
4. Use `compass diagnose multigraph` or the relevant local diagnostic when an
   existing graph is invalid or suspicious. Treat limit errors as failures, not
   empty results, and follow their actionable scope or size guidance.
5. Use `compass watch .` only when continuous refresh is requested. Report the
   running process and watched root.
6. After a successful build, confirm the expected graph and report artifacts
   exist. A stale file surviving a failed build is not evidence of success.

## Boundaries

- Do not invoke a semantic provider, network source, database push, or HTTP
  server merely to repair a local structural graph.
- Preserve explicit `--graph`, `--out`, `--at`, provider, and storage choices.
- Do not delete graph output unless the user authorizes destructive recovery.
- Do not describe a failed refresh as current.
- Keep generated Compass artifacts outside tracked external source checkouts.
- Use `compass-navigate` after the graph is ready for focused code questions.

Return what was checked, the exact maintenance command, the artifact paths, and
any warning or failure that still limits freshness.
