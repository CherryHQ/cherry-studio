# Agent Notes

English | [中文](README.zh.md)

An **Agent Note** records a decision that affects this codebase — the *why* and *what we gave up*, the parts code and docs can't carry.

Notes live at `{lifecycle}/{class}/yyyy-mm-dd-topic.md`:

- **Lifecycle**: `proposed/` (reviewed before implementation) · `implemented/` (shipped, kept current) · `rejected/` (declined, kept while the rationale prevents a mistake)
- **Class**: `feature` · `bug-fix` · `simplification` · `architecture` · `process` · `testing`

Every note opens with `# Agent Note: <title>` and a `Status:` line, states its `## Problem`, and carries a mandatory `## Alternatives considered`. Each note has a `.zh.md` counterpart mirroring its structure.

This system is being adopted per [the docs-governance proposal](proposed/process/2026-08-18-docs-governance-and-spec-workflow.md), which defines the format, the note-worthiness threshold, and the rollout. The full ruleset and format gate land with that proposal's Phase 1.
