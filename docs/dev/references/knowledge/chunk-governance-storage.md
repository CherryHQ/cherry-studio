---
description: Storage-only foundation for future Knowledge chunk governance, with revision and provenance boundaries
sources:
  - src/main/data/db/schemas/knowledgeChunkGovernance.ts
  - src/main/data/services/KnowledgeChunkGovernanceService.ts
  - src/shared/data/types/knowledgeChunkGovernance.ts
---

# Knowledge Chunk Governance Storage

English | [中文](chunk-governance-storage.zh.md)

This is a storage-only foundation for the [proposed chunk-governance feature](../../../../.agents/notes/proposed/feature/2026-11-22-knowledge-chunk-governance.md). It does not change retrieval, reindexing, citations or the chunk inspector. No user mutation endpoint calls this service yet. An `excluded` flag in this table does not currently exclude a chunk from search.

## Ownership

`KnowledgeChunkGovernanceService` owns the main-database `knowledge_chunk_governance` and `knowledge_chunk_governance_history` tables. The per-base derived index remains unchanged. No filesystem, provider or embedding work runs in this data service.

A record binds a base/item and exact unit ID to source content hash, original UTF-16 offsets, original text and its SHA-256 hash. The create operation checks that the source item belongs to the base, is a completed non-directory item, and has a completed base. The composite foreign key preserves base/item ownership even outside the service. Permanent item/base deletion cascades through the records and their history.

The future Knowledge workflow must obtain and validate the actual indexed source snapshot before calling `create`, and coordinate it with the per-base mutation lock and retrieval publication. Matching offset length alone does not prove that supplied text is the real indexed source. This service is not that source-validation or retrieval authority.

## Revisions and history

Create writes revision 1 and its state history in one synchronous write transaction. State contains an exclusion flag, labels, and an optional text correction. Labels are trimmed, non-empty, deduplicated and sorted. `null` removes a correction; an empty correction is rejected. Original source evidence is not overwritten by a state change.

`updateState` requires the exact stored source hash and expected revision. A stale source/revision fails without changing either table. A changed state increments the revision and appends history atomically. An identical normalized state is a no-op. A history write failure rolls back the corresponding current-state write as well. Read/history queries are scoped to base, item and unit. The service returns internal database rows; this is not a published cross-process entity endpoint.

The additive migration leaves existing sources untouched and creates no synthetic governance records. These tables live in the normal database, not a replaceable index. A test reads the record and history from a second file-backed connection; full application restart, base import/export and restore workflows have not been verified for this feature.

## Boundaries Still Pending

- Batch operations and their atomic selection validation.
- Reconciliation against changed source/chunk identity and visible review-needed state.
- Immediate exclusion before candidate caps/reranking and revision revalidation for in-flight searches.
- Effective-text/embedding jobs, matching lexical/vector publication and crash recovery.
- Original/corrected citation revision handling and historical references.
- Inspector controls, user confirmation, cost disclosure and native acceptance.

Do not expose writes or describe storage state as indexed/effective until the workflow and retrieval layers enforce the Spec. Keep the Spec proposed; this layer alone does not resolve issue #19001.

## Verification

The storage tests use `setupTestDatabase()` with production migrations. They cover original evidence, independent connection reads, normalized changes, stale revision/source conflicts, removal/no-op semantics, injected history-write failures, scope guards and ownership cascades. The migrate-forward test starts before the additive migration with populated Knowledge rows and checks that those rows are preserved with no invented decisions.
