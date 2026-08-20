# Agent Note: Phase 0b documentation audit outcomes

Status: implemented

English | [中文](2026-08-19-phase-0b-doc-audit-outcomes.zh.md)

## Problem

The Phase 0b audit found two places where the implementation needed to depart
from the [original docs-governance proposal](../../proposed/process/2026-08-18-docs-governance-and-spec-workflow.md).
The proposed Chat adapter and UI conventions described APIs and ownership
boundaries that never landed. The proposal also required every existing
domain-prefixed filename to be renamed, but the completed tree still has 24
such files.

Leaving these differences implicit would make the proposal contradict the
repository it is meant to govern.

## Decision

Current implementation is the authority for reference documentation. Phase 0b
therefore deletes `chat/adapters.md` and `chat/conventions.md`; a future shipped
adapter contract can introduce current-state documentation when it exists.

Phase 0b does not mass-rename existing domain-prefixed files. Existing basenames
stay stable unless a move or an ambiguity requires a rename. New or renamed
documents use the shortest unambiguous name within their domain and avoid a
redundant domain prefix.

This note supersedes only those two Phase 0b decisions. The remaining governance
proposal still defines the target tree, frontmatter, gates, Agent Notes, and
later rollout phases.

## Alternatives considered

- **Keep the two target-architecture Chat documents.** Rejected because reference
  docs are current-state authority; explicit target labels still leave agents
  and contributors with APIs that do not exist.
- **Rename all 24 prefixed files during the audit.** Rejected because it adds
  inbound-link churn without improving the content audit or any gate.
- **Rewrite the original proposal in place.** Rejected because a changed decision
  needs a superseding record and cross-link, not erased history.

## Consequences

- The Chat reference maps only implemented modules and contracts.
- Existing reference links remain stable through Phase 0b.
- The 24 legacy prefixed basenames are accepted; the no-redundant-prefix rule
  applies when a document is newly created or renamed.
