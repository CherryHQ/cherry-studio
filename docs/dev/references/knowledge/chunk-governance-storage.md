---
description: Durable Knowledge chunk decisions, retrieval guards and atomic inspector batches, with remaining correction and restore boundaries
sources:
  - src/main/data/db/schemas/knowledgeChunkGovernance.ts
  - src/main/data/services/KnowledgeChunkGovernanceService.ts
  - src/main/data/api/handlers/knowledges.ts
  - src/renderer/pages/knowledge/panels/dataSource/KnowledgeChunkHistory.tsx
  - src/shared/data/types/knowledgeChunkGovernance.ts
  - src/main/features/knowledge/governance
  - src/main/features/knowledge/query/governance.ts
  - src/main/features/knowledge/query/KnowledgeQueryService.ts
  - src/main/features/knowledge/pipeline/vectorstore/indexStore
  - src/shared/ipc/schemas/knowledge.ts
  - src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemChunkDetailPanel.tsx
  - src/renderer/pages/knowledge/panels/dataSource/KnowledgeChunkReviewPanel.tsx
---

# Knowledge Chunk Governance Storage

English | [中文](chunk-governance-storage.zh.md)

These layers implement durable decisions, retrieval safety, exclusion/label controls and explicit source review from the [proposed chunk-governance feature](../../../../.agents/notes/proposed/feature/2026-11-22-knowledge-chunk-governance.md). They do not complete text corrections, citations or backup/restore. The Spec remains proposed and issue #19001 remains open.

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

After success the inspector reloads committed state. On conflict/error it clears the pending intent and requires Refresh and a new selection, with no automatic retry. Switching sources clears selection and late list/save responses cannot overwrite the new source's state, including switching away and back. Changed-source decisions show a review view and disable ordinary batch editing, including when the source has no current chunks. Existing corrections are visible as pending but cannot be edited or published here.

## Reviewing changed sources

The review view retains the previous original, source hash/range, labels, exclusion and pending correction. It remains available when the indexed material is missing or has no chunks, provided the owning item and base are completed. A closed index requires refresh rather than pretending the source is empty.

Select one unmatched record. Discard removes its decisions from reconciliation, not its original evidence or history. Rebind previews the previous and current originals and transfers the decisions only to the explicitly selected chunk in the same source. A target with existing decisions is refused rather than silently merged. Source hashes, old revision and target revision are rechecked under the shared mutation lock. Both transfer sides and linked audit entries commit atomically. No provider call runs, and transferred corrections remain pending and suppressed.

Discard and rebind retire the previous binding with a new revision. History records `discard`, `rebind-away` and `rebind-from`, including the related record identity. Retired bindings do not revive when old source bytes reappear; a new explicit edit or reviewed transfer can reactivate them with another revision. Ordinary neutral records are not auto-retired. Retrieval stays paused until every non-retired unmatched record is resolved. Opening or cancelling a review changes nothing.

## Restoring a discard

The inspector also lists the latest unchanged discard for each original binding, with its retained labels, exclusion and pending correction. Restore discarded decisions previews the effect and requires Save; opening and Cancel do not write. This is a narrow Undo for discard, not a general history browser or an undo for transfers.

Main reads only the two latest history entries, authenticates owning completed item/base, current source hash and expected revision under the same mutation lock, and restores the immediately preceding state on the original binding in one write transaction. A new `restore-discard` history entry records the recovery; prior evidence and history remain immutable. Failed history writes roll back the state change. A later edit, rebind, stale window or changed lifecycle refuses restoration instead of overwriting current intent.

Restoration does not guess a replacement. Changed or missing sources become review-needed and pause retrieval again. A same-identity source reuses its original decision. Corrections remain pending and suppressed. No provider, embedding, index or source-file work runs. Rebinding remains a separate explicit review after restoration, and a transferred-away record cannot be restored through this action. Repeated discard/restore cycles append revisions rather than erasing history.

## Browsing accepted decisions

Decision history in current chunk cards and source review loads on request, five entries per page; older pages replace the current page. The read-only DataApi endpoint scopes by base, item and exact unit identity, rechecks completed ownership, and refuses directories and mismatched owners. `beforeRevision` selects older revisions with a server maximum of 25 entries. New decisions during browsing do not reorder earlier revisions; the returned binding revision can be newer than the displayed entries.

History shows recorded original text, hash, offsets, operation, revision, time, labels, exclusion and correction, with retired bindings and related transfer identities labeled. A recorded correction is not proof of indexing, and historical decisions are not current retrieval state. Empty history creates no records. Opening, paging and closing do not write, restore arbitrary revisions or call a provider. Close, source switches and parent revision refresh clear evidence and ignore late responses; access or malformed-response errors clear the page and show a generic refreshable error.

## Retrieval authority

Before search, `KnowledgeQueryService` reads durable record IDs/revisions and derives exclusions from the actual index. Exact unit/material IDs, source/content hashes, offsets and body text must match. There is no title, ordinal-only or similarity matching.

- Exact excluded units are suppressed in every lane.
- Non-null corrections remain pending and suppressed until effective-text/embedding publication exists.
- Any non-retired unmatched record pauses its material and retains evidence/history; other materials remain searchable. Same-content, same-identity rebuilds reuse decisions. Confirmed rebind/discard resolves only the selected record.
- BM25 MATCH, relaxed short-term search, short-token LIKE, vector and both hybrid lanes filter before SQL limits and RRF. Shared embedding hashes do not suppress unrelated units. Bound JSON avoids per-ID SQL variable limits and interpolation.

Main revalidates revisions and exact-index reconciliation before reranking and before returning results. Concurrent changes return conflict without repeating a possibly paid provider call. Failed policy reads and closed indexes fail closed. The two databases are not treated as one transaction, renderer policy is not cached, and original/correction text is not logged.

## Boundaries Still Pending

- Effective-text/embedding jobs, complete lexical/vector publication, crash recovery and correction editing/removal.
- Arbitrary revision restoration and undoing a rebind.
- Cross-base transfer of durable decisions and history, plus native backup/restore acceptance.
- Original/corrected citation revisions and historical references.
- Provider-cost disclosure for future correction work and native Electron acceptance.

Do not expose correction editing or call a pending correction indexed/effective before those paths enforce the Spec. Current evidence is partial AC1/AC2/AC3/AC4/AC6, not full issue resolution.

## Verification

Storage tests use `setupTestDatabase()` and production migrations for original evidence, independent reads, normalization, stale revisions, ownership cascades, no-ops and history rollback. Migration tests preserve populated existing Knowledge rows without inventing decisions.

Main integration uses the migrated database, file-backed SQLite index, production FTS/vector/query/rerank paths and the real batch workflow. Provider methods alone are mocked. Scenarios include candidate-cap safety, all lanes/fallbacks, shared hashes, thousands of IDs, UTF-16, exact rebuild/reopen, source mismatch, original inspection, in-flight conflicts, atomic later-entry/history failures, competing windows, lifecycle/ownership validation and preserved pending corrections.

Review tests additionally cover actual rebind/discard transactions, both audit links, source/target conflicts, empty/missing material, retirement across rebuilds and rollback after a transfer-side history failure. Inspector tests cover confirmation-only writes, exact selection/revision delivery, real shared-control keyboard/focus behavior, conflict recovery and stale responses across source switches. Visual checks use the actual inspector, shared controls and virtual list in English/light desktop and Chinese/dark narrow layouts, with IPC/data fixtures. They do not claim native Electron, live providers, correction publication, citation or base backup/restore acceptance.

Discard restoration tests additionally cover original-identity versus changed/missing sources, stale and superseded intent, foreign ownership, transfer rejection, transactional rollback and lifecycle changes after a real mutation-lock wait.


## Rebuilding into a new base

Changing the embedding model through Restore creates a new base and new source item identities. This is not the same operation as rebuilding the existing base's disposable index, or restoring a whole-app backup archive.

Until cross-base transfer can preserve exact source bindings and accepted history, Restore refuses a source base that owns any chunk decision record. This includes labels, corrections, exclusions, neutral records and retired review records. Re-enabling a chunk or discarding an unmatched decision does not erase its history and does not bypass the guard. No new base, copied source, index or job is created by the refusal. The original base and decisions stay unchanged. Do not delete those records as a workaround.

The source base's mutation lock covers the eligibility check and rebuild, so a decision accepted before the rebuild's turn cannot be silently dropped. Untouched bases remain restorable, including when another base has decisions. Existing-base index rebuild and explicit review remain separate operations. This guard prevents unsupported transfer; it does not complete backup/restore acceptance or provide cross-base recovery. Native application restore acceptance still needs verification. Automated whole-app archive round trips are covered below.


## Whole-app archive restore evidence

`KnowledgeGovernanceBackup.integration.test.ts` runs the production version 7 backup, ZIP archive reading/extraction, restore staging, durable journal and preboot promotion on real temporary files and migrated SQLite databases. It closes the live connection before promotion and opens a new connection afterward. This is whole-app replacement with preserved base/item identities, not cross-base transfer.

Both full and slim archives preserve exact decision records and accepted history, including original Unicode text/hashes/offsets, corrections, labels, exclusions, retired bindings, transfer links and discard history. Staging leaves the live database and source file unchanged. After promotion, discarded intent remains restorable and item deletion still cascades to its decisions/history; untouched bases gain no records. A live decision accepted after staging expires promotion instead of overwriting newer intent.

Full backup also restores the captured source file and cache. Slim backup includes the database and cache only: source files are not archived or restored, and a changed source stays changed. Preserved decision rows in a slim restore are not proof that source bytes or derived retrieval indexes are available or current. Existing reconciliation still owns those checks.

Only application lifecycle/drain signals, path routing, cache-flush notification, window messages and relaunch are test boundaries. SQLite, migrations, governance writes, checkpoint/hash, archive I/O, journal and promotion are real. These tests do not verify native Electron relaunch, remote storage, cross-platform restore, cross-base rebuild, provider calls or effective correction indexing. The Spec remains proposed.
