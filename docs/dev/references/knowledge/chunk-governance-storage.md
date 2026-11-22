---
description: Durable Knowledge chunk decisions, retrieval guards and atomic inspector batches, with remaining correction and restore boundaries
sources:
  - src/main/data/db/schemas/knowledgeChunkGovernance.ts
  - src/main/data/services/KnowledgeChunkGovernanceService.ts
  - src/shared/data/types/knowledgeChunkGovernance.ts
  - src/main/features/knowledge/governance
  - src/main/features/knowledge/query/governance.ts
  - src/main/features/knowledge/query/KnowledgeQueryService.ts
  - src/main/features/knowledge/pipeline/vectorstore/indexStore
  - src/shared/ipc/schemas/knowledge.ts
  - src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemChunkDetailPanel.tsx
---

# Knowledge Chunk Governance Storage

English | [中文](chunk-governance-storage.zh.md)

These layers implement durable decisions, retrieval safety and exclusion/label controls from the [proposed chunk-governance feature](../../../../.agents/notes/proposed/feature/2026-11-22-knowledge-chunk-governance.md). They do not complete text corrections, source-review resolution, citations or backup/restore. The Spec remains proposed and issue #19001 remains open.

## Ownership

`KnowledgeChunkGovernanceService` owns the main-database `knowledge_chunk_governance` and `knowledge_chunk_governance_history` tables. The per-base index remains disposable. No filesystem, provider or embedding work runs in this data service.

A record binds a base/item and exact unit ID to source content hash, original UTF-16 offsets, original text and its SHA-256 hash. The source item and base must be completed, and the item must belong to that base and not be a directory. A composite foreign key preserves ownership. Permanent item/base deletion cascades through records and history.

`KnowledgeChunkGovernanceWorkflow` authenticates selected IDs against actual indexed units, the current source hash, the original source slice and its derived unit identity. The caller cannot supply replacement source evidence or a correction. It uses the same per-base `KeyedMutex` as indexing, reindexing and deletion. Runtime orchestration uses `knowledge.apply_chunk_governance` IPC; the database service remains internal.

## Revisions and history

Create writes revision 1 and history in one synchronous write transaction. State contains exclusion, labels and an optional correction. Labels are trimmed, non-empty, deduplicated and sorted. Original source evidence is never overwritten by a state change.

`updateState` requires the exact stored source hash and expected revision. A stale source/revision changes neither table. A changed normalized state increments the revision and appends history atomically; an identical state is a no-op. History failure rolls back current state too. Reads are scoped by base, item and unit. `listByBase` orders records deterministically.

`applyBatch` performs every selected change and its history in one `withWriteTx` transaction. Revision 0 means no record existed when selected. An include on an untouched chunk, or removal of an absent label from one, does not invent a record. Re-enable changes only exclusion and preserves labels/corrections. A later stale selection or history failure rolls back earlier writes in the same batch.

The additive migration creates no synthetic decisions. Tests read records through an independent connection and reopen the derived index. Full application restart, base import/export and restore remain unverified for this feature.

## Inspector workflow

Open a completed source's chunk inspector and select the chunks to change, up to 500 per batch. Each card retains original text, source identity, labels and active/excluded/pending/review-needed state. Choose exclude/include, or enter one label of up to 80 characters and choose add/remove. The preview identifies the count and action. Only Save submits the captured identities, hashes and revisions; opening, selecting, previewing and Cancel do not write.

Exclusion affects retrieval, not source access or secure deletion. Labels are organizational metadata, never model prompts, search text or embeddings. These actions make no provider call. Re-enabling a chunk with an unpublished correction does not publish that correction; its pending state remains out of retrieval.

After success the inspector reloads committed state. On conflict/error it clears the pending intent and requires Refresh and a new selection, with no automatic retry. Switching sources clears selection and late list/save responses cannot overwrite the new source's state, including switching away and back. Changed-source decisions with current indexed chunks show a review banner and disable editing. A material-level review view for a source with no current chunks is still pending. Existing corrections are visible as pending but cannot be edited or published here.

## Retrieval authority

Before search, `KnowledgeQueryService` reads durable record IDs/revisions and derives exclusions from the actual index. Exact unit/material IDs, source/content hashes, offsets and body text must match. There is no title, ordinal-only or similarity matching.

- Exact excluded units are suppressed in every lane.
- Non-null corrections remain pending and suppressed until effective-text/embedding publication exists.
- Any unmatched record pauses its material and retains evidence/history; other materials remain searchable. Same-content, same-identity rebuilds reuse decisions. Explicit rebind/discard is still unavailable.
- BM25 MATCH, relaxed short-term search, short-token LIKE, vector and both hybrid lanes filter before SQL limits and RRF. Shared embedding hashes do not suppress unrelated units. Bound JSON avoids per-ID SQL variable limits and interpolation.

Main revalidates revisions and exact-index reconciliation before reranking and before returning results. Concurrent changes return conflict without repeating a possibly paid provider call. Failed policy reads and closed indexes fail closed. The two databases are not treated as one transaction, renderer policy is not cached, and original/correction text is not logged.

## Boundaries Still Pending

- Effective-text/embedding jobs, complete lexical/vector publication, crash recovery and correction editing/removal.
- Explicit review, rebind and discard of unmatched records.
- Base backup/restore of durable decisions and history.
- Original/corrected citation revisions and historical references.
- Provider-cost disclosure for future correction work and native Electron acceptance.

Do not expose correction editing or call a pending correction indexed/effective before those paths enforce the Spec. Current evidence is partial AC1/AC2/AC3/AC4/AC6, not full issue resolution.

## Verification

Storage tests use `setupTestDatabase()` and production migrations for original evidence, independent reads, normalization, stale revisions, ownership cascades, no-ops and history rollback. Migration tests preserve populated existing Knowledge rows without inventing decisions.

Main integration uses the migrated database, file-backed SQLite index, production FTS/vector/query/rerank paths and the real batch workflow. Provider methods alone are mocked. Scenarios include candidate-cap safety, all lanes/fallbacks, shared hashes, thousands of IDs, UTF-16, exact rebuild/reopen, source mismatch, original inspection, in-flight conflicts, atomic later-entry/history failures, competing windows, lifecycle/ownership validation and preserved pending corrections.

Inspector tests cover confirmation-only writes, exact selection/revision delivery, conflict recovery and stale responses across source switches. Visual checks use the actual inspector, shared controls and virtual list in English/light desktop and Chinese/dark narrow layouts, with IPC/data fixtures. They do not claim native Electron, live providers, correction publication, citation or restore acceptance.
