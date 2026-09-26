# Graph schema and provenance

Load this reference when interpreting graph structure, confidence, or source
evidence.

## Core model

Compass represents files, symbols, document sections, project entities, and
concepts as nodes. Directed relationships connect nodes. Communities group
densely connected regions; hub scores identify highly connected nodes.

Node IDs are stable identifiers within the graph and may be more precise than
human-readable labels. Source metadata can include a file, line or region,
origin URL, author, contributor, and capture time.

## Relationship evidence

Preserve each edge's source, target, relation, confidence, and provenance:

- `EXTRACTED`: directly observed by a structural parser or trusted input.
- `INFERRED`: resolved or semantically proposed with recorded confidence.
- `AMBIGUOUS`: multiple candidates remain or resolution is incomplete.

Do not reverse a directed edge in prose. Do not flatten confidence categories
into certainty. A community indicates structural density, not necessarily a
runtime subsystem or ownership boundary.

## Source verification

When a claim matters:

1. Identify the node and relation used.
2. Follow `source_file` and `source_location` when present.
3. Verify the relevant source.
4. State when provenance is missing, inferred, ambiguous, or historical.

Merged and historical graphs may contain origin and revision metadata. Include
that context when the answer could otherwise be mistaken for the current
working tree.
