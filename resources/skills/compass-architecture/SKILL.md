---
name: compass-architecture
description: "Explain software architecture with Compass: map crates, modules, ownership boundaries, dependency layers, hubs, communities, and cross-system routes. Use for broad repository structure or design questions; use compass-navigate for locating one symbol or path."
compatibility: "Requires the Compass CLI and an Agent Skills-compatible coding agent."
metadata:
  version: "1"
  product: "compass"
---

# Compass Architecture

Use the Compass graph for broad structural questions about modules, crates,
layers, ownership, hubs, and cross-component dependencies. Combine the graph
report with focused queries, then verify the important boundaries in source and
repository documentation.

## Workflow

1. Resolve the selected graph and read `compass-out/GRAPH_REPORT.md` when the
   request genuinely needs repository-wide context.
2. Run `compass query "<architecture question>"` with a budget sized to the
   available context. Use `compass explain "<concept>"` for a component and its
   neighborhood or `compass path` for a claimed inter-layer dependency.
3. If `compass-out/wiki/index.md` exists, navigate from the index rather than
   opening wiki pages indiscriminately.
4. Identify stable ownership boundaries, dependency direction, high-degree
   nodes, communities, and explicit unresolved or inferred relationships.
5. Verify the decisive crate entry points, manifests, public types, and design
   documents in source.
6. Present the smallest architecture view that answers the question. Separate
   observed graph facts from design inference.

## Boundaries

- Do not treat community clustering as a normative module boundary.
- Do not claim a missing path proves two components are independent.
- Do not flatten parallel edges or reverse relationship direction.
- Keep repository origin when reasoning across merged or global graphs.
- Reach `next=none` before making exhaustive inventory claims.
- Use `compass-navigate` when the request is a focused symbol search and
  `compass-change-impact` when the question is review scope for an edit.

Return the graph path or revision, the architectural boundaries, supporting
source locations, and explicit uncertainties.
