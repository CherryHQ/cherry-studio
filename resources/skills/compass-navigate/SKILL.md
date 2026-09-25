---
name: compass-navigate
description: "Locate code with the Compass graph: find symbols, callers, callees, dependency paths, related source, and exact graph evidence. Use for focused codebase navigation or repository search before opening files; use compass-architecture for broad system structure."
compatibility: "Requires the Compass CLI and an Agent Skills-compatible coding agent."
metadata:
  version: "1"
  product: "compass"
---

# Compass Navigate

Use Compass as the first navigation layer when the request is to locate code,
trace a dependency, find callers or callees, or identify the smallest relevant
source set. The graph is an evidence index; verify decisive facts in cited
source before changing code.

## Workflow

1. Resolve the selected graph. Keep an explicit `--graph` or `--at` selector
   unchanged throughout the task; otherwise use `compass-out/graph.json`.
2. If the current graph is absent and repository guidance permits generation,
   run `compass update .` once. If generation fails, report the failure and do
   not treat an older surviving graph as current.
3. Choose the narrowest command:
   - `compass search "<symbol>"` for exact or fuzzy symbol lookup.
   - `compass callers "<symbol>"` or `compass callees "<symbol>"` for one-hop
     call evidence.
   - `compass path "<source>" "<target>"` for a known dependency path.
   - `compass affected "<symbol>" --depth N` for bounded downstream scope.
   - `compass explain "<concept>"` for a concept and its neighborhood.
   - `compass query "<question>"` for focused natural-language traversal.
4. When output reports `next=N`, repeat the unchanged command with `--page N`.
   Reach `next=none` before making an exhaustive claim.
5. Open only the returned source needed to verify identity, direction,
   provenance, ambiguity, and the requested relationship.

## Boundaries

- Treat an absent path as evidence that this graph does not encode the route,
  not proof that no route exists.
- Preserve ambiguous matches instead of selecting the first candidate.
- Treat `affected` as review scope, not proof that every result must change.
- Do not silently switch graphs, revisions, output roots, or repositories.
- For a broad module map or ownership explanation, use `compass-architecture`.
- For stale or missing graph artifacts, use `compass-index-maintenance`.

Return concise results with the graph or revision used and the source locations
that support the conclusion.
