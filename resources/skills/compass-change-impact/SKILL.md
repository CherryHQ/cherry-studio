---
name: compass-change-impact
description: "Assess change impact with Compass: map callers, dependents, affected tests, public contracts, and review scope before or after an edit. Use for blast-radius analysis, regression planning, or code-review scope; use compass-debug when investigating an existing failure."
compatibility: "Requires the Compass CLI and an Agent Skills-compatible coding agent."
metadata:
  version: "1"
  product: "compass"
---

# Compass Change Impact

Use Compass to identify bounded review and regression scope for a proposed or
completed code change. Graph impact is a conservative review aid; verify public
contracts and decisive relationships in source and tests.

## Workflow

1. Name the symbol, file, command, schema, or behavior that may change. Resolve
   ambiguity before expanding the scope.
2. Run `compass affected "<symbol>" --depth N` for bounded downstream review.
   Use `compass callers`, `compass callees`, or `compass impact` when a typed
   one-hop or transitive operation better matches the question.
3. Use `compass path` to verify any claimed dependency chain and `compass
   explain` to inspect nearby ownership or tests.
4. Classify results into implementation dependents, tests and fixtures, public
   contracts, generated artifacts, and documentation. Read the relevant source
   before deciding that a result requires a change.
5. Check repository compatibility guidance for public commands, formats,
   schemas, storage, integrations, and stable identifiers.
6. After authorized edits, refresh the graph and repeat the same bounded query
   when confirming the final review scope.

## Boundaries

- Treat `affected` output as candidates, not mandatory edits.
- Preserve relationship direction, multiplicity, provenance, and pagination.
- Reach `next=none` before calling the impact inventory exhaustive.
- Do not omit ambiguity, unresolved targets, negative cases, or failure paths.
- Do not broaden a narrow change into unrelated cleanup.
- Use `compass-debug` for root-cause investigation and `compass-architecture`
  for repository-wide design explanations.

Return the proposed review set, why each item is included, the verification
commands, and any relevant graph gaps.
