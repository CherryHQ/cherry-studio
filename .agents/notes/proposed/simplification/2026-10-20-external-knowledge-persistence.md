# Agent Note: Reduce unused external knowledge persistence

Status: proposed

English | [中文](2026-10-20-external-knowledge-persistence.zh.md)

## Problem

The external knowledge stack persists remote hierarchy metadata and a scanned-document count even though its production consumers do not use those persisted values. Every extra field requires database constraints, entity schemas, write plumbing and migration maintenance.

The inspected implementation is [the knowledge UI stack head](https://github.com/CherryHQ/cherry-studio/pull/20998), commit `9ee0125ffa05e827edb773f78697259c5a4d82c1`. These changes are still in open PRs; this note does not claim that the feature has shipped on main.

| Field | Current writer | Consumer evidence |
| --- | --- | --- |
| Document `canonicalNodeId` | `ExternalKnowledgeSyncService` metadata builders | Persisted and returned by DataApi, with no subsequent production field access found |
| Document `parentNodeId` | `ExternalKnowledgeSyncService` metadata builders | Persisted and returned by DataApi, with no subsequent production field access found |
| Document `relativeBreadcrumb` | `ExternalKnowledgeSyncService` metadata builders | Persisted and returned by DataApi, with no subsequent production field access found |
| Source `lastScannedCount` | `ExternalKnowledgeSourceService` settlement | Persisted and returned by DataApi, with no UI or runtime field access found |

The read adapter separately uses breadcrumb metadata during traversal and canonical-node selection. That live input is not the persisted Document copy and must remain.

## Proposal

Remove the four persisted fields and their dependent constraints, entity properties and write arguments. Retain the `Connection → Source → Document → KnowledgeItem` relationship and all supported synchronization behavior.

### Scope

- Update `externalKnowledgeDocument.ts`, `externalKnowledgeSource.ts`, their data services and shared entity schemas.
- Remove the redundant persistence arguments from `ExternalKnowledgeSyncService`; retain provider traversal descriptors and any operational scan counters used by jobs.
- Adjust affected DataApi contracts, fixtures and reference documentation. Recheck exact identifiers, SQL column names, whole-object consumers, backup/restore and exports before deleting each field. A newly found real consumer requires a Spec amendment instead of silently removing its behavior.
- Add a forward migration generated from the updated schemas. Do not rewrite shipped SQL or snapshots, remove user databases, or introduce compatibility dual-writes.

### Preserved behavior

Keep `(baseId, provider, tenantId, spaceId)` Source uniqueness. Changing authorization connections must not permit duplicate attachment of the same space; multiple subtrees of one space remain outside this change.

Keep stable remote document identity, `remoteRevision`, `contentHash`, `lastSeenAt`, document warnings, availability and local item ownership. Remote revisions avoid unnecessary reads; content hashes avoid unnecessary indexing. Keep `Source.revision` and `activeJobId` publication fences, pinned Markdown, staging cleanup, scheduled/manual synchronization, authorization recovery and disconnect-with-local-copy behavior.

Do not merge Document into KnowledgeItem, combine all summary columns into JSON, or introduce `mode`, SyncState or generic provider configuration in this phase.

### Migration and ownership

The migration must preserve all retained columns and all Source, Document, Connection, KnowledgeItem, schedule and job references. Test an empty database and populated pre-change databases by running the real production migration chain, inserting representative old rows, and migrating forward. Explicitly assert `foreign_key_check` is empty: the current migration runner logs violations rather than throwing.

Implement domain changes in the layer owned by [PR #20742](https://github.com/CherryHQ/cherry-studio/pull/20742), propagate writer changes through [PR #20856](https://github.com/CherryHQ/cherry-studio/pull/20856), and verify lifecycle and UI consumers in [PR #20903](https://github.com/CherryHQ/cherry-studio/pull/20903) and [PR #20998](https://github.com/CherryHQ/cherry-studio/pull/20998). Inspect the live stack and migration dependencies before integrating the approved Spec below its implementation. Do not hide domain changes in the UI layer or rewrite already-merged history.

### Relationship to the wider design

This is phase A of the external knowledge adjustment. Phase B will introduce a real remote retrieval provider, a unified `KnowledgeProvider` entry with independent `retrieval` and `documents` capabilities, and separated remote-retrieval/local-sync storage and execution.

That architecture remains a separate Spec: select the real provider, validate its authentication/resource/retrieval contract, and resolve query-result, citation and cancellation changes before implementation. Approval of this note authorizes only phase A; it does not certify an unimplemented generic adapter or authorize a placeholder remote provider.

## Alternatives considered

- Keep all columns: avoids migration work but retains permanently synchronized copies with no current business consumer.
- Remove hierarchy metadata from the provider descriptor as well: would break traversal and canonical-node selection; only persistence is redundant.
- Merge Document into KnowledgeItem: couples stable remote identity to replaceable local versions and makes unavailable documents and retained static copies harder to express.
- Redesign all external knowledge tables now: combines authorization and migration risk with an unvalidated second-provider contract.

## Acceptance criteria

- AC1 — Production entity reads and writes no longer require the four removed fields, while Feishu traversal and canonical-node selection return the same supported document set (verification: shared/main contract tests; owner: domain and adapter layer)
- AC2 — Empty and populated databases migrate forward with retained values, IDs, ownership, job and schedule references unchanged, and no foreign-key violations; restarting migration is safe (verification: real SQLite migration tests; owner: domain layer)
- AC3 — Incremental synchronization still skips unchanged content, atomically replaces changed content and rejects stale publication after pause, disconnect or reauthorization; interrupted staging remains recoverable (verification: main synchronization and lifecycle tests; owner: sync and lifecycle layers)
- AC4 — Same-space duplicate sources remain rejected, warnings and last-result UI retain their behavior, local snapshots remain reindexable, and disconnect can still preserve completed local copies (verification: main/renderer tests and targeted Electron validation; owner: lifecycle and UI layers)
- AC5 — The final implementation updates affected reference documentation and the bilingual note together, records actual scoped verification, and contains no unrelated provider, authentication or retrieval changes (verification: docs gates and per-layer change scope; owner: final integration layer)

## Implementation evidence

Phase A is implemented across the existing domain, adapter, synchronization, lifecycle and UI layers in PRs #20742, #20800, #20856, #20903 and #20998. Phase B remains deferred.

- AC1: shared contracts and 24 adapter traversal tests passed. Persisted metadata writers were removed; traversal descriptors and job-output scan counts remain.
- AC2: the populated migration test failed against the old schema and passed with appended migration `0030_external_knowledge_persistence`. Retained values, ownership, task/schedule references, foreign keys, integrity and repeated migration execution are verified. Fresh-database tests passed.
- AC3: synchronization and lifecycle tests passed, including unchanged-content shortcuts, publication fences, staged recovery and disconnect behavior. Job settlement tests now assert real SQLite state through the production migration harness.
- AC4: the final targeted run passed 204 main tests across 8 files and 135 renderer tests across 4 files. Workspace Electron displayed the latest result and document warning from isolated fixture data. Keep-local disconnect removed Source/Document rows while retaining the completed item and Markdown snapshot, without foreign-key violations. Reindex coverage is automated; no live embedding request was made.
- AC5: reference docs, per-layer change scopes, scoped lint/formatting, node/web typechecks, migration-chain checks and documentation checks passed. Read-only DataApi endpoints project reduced shared entities; repository searches found no field-level backup/export consumer. Untracked integrations are not covered.

## Risks

Removing columns can cause SQLite table recreation; incorrectly rebuilt foreign keys may delete or orphan dependent records. Use the existing migration runner and production-chain fixtures, and inspect every regenerated index and constraint.

DataApi returns whole entities today. Repository searches establish the absence of known field consumers, not a guarantee about untracked external integrations. The implementation must inspect all exposed endpoints and identify any published compatibility promise before changing their shapes.

Implementation proceeded on the user’s explicit phase A instruction. No exact-head GitHub Approval has been recorded; this note remains proposed and the implementation PRs remain draft. Live Feishu authorization and network synchronization have not been accepted.
