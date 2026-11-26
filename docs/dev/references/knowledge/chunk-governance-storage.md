---
description: Durable Knowledge chunk decisions and fail-closed retrieval guards, with remaining workflow boundaries
sources:
  - src/main/data/db/schemas/knowledgeChunkGovernance.ts
  - src/main/data/services/KnowledgeChunkGovernanceService.ts
  - src/shared/data/types/knowledgeChunkGovernance.ts
  - src/main/features/knowledge/query/governance.ts
  - src/main/features/knowledge/query/KnowledgeQueryService.ts
  - src/main/features/knowledge/pipeline/vectorstore/indexStore
---

# Knowledge Chunk Governance Storage

English | [中文](chunk-governance-storage.zh.md)

This is the storage and retrieval-safety foundation for the [proposed chunk-governance feature](../../../../.agents/notes/proposed/feature/2026-11-22-knowledge-chunk-governance.md). No user mutation endpoint or inspector control calls this service yet. Committed internal exclusions now affect search, but this is not the complete editing, correction, review or restore workflow.

## Ownership

`KnowledgeChunkGovernanceService` owns the main-database `knowledge_chunk_governance` and `knowledge_chunk_governance_history` tables. The per-base derived index remains disposable. No filesystem, provider or embedding work runs in this data service.

A record binds a base/item and exact unit ID to source content hash, original UTF-16 offsets, original text and its SHA-256 hash. The create operation checks that the source item belongs to the base, is a completed non-directory item, and has a completed base. The composite foreign key preserves base/item ownership even outside the service. Permanent item/base deletion cascades through the records and their history.

The future mutation workflow must obtain and validate the indexed source snapshot before calling `create`, coordinate writes with the per-base mutation lock, and validate complete batch selections. Matching offset length alone does not authenticate supplied source text. The retrieval guard independently checks stored evidence against the current index; it does not authorize or expose a mutation endpoint.

## Revisions and history

Create writes revision 1 and its state history in one synchronous write transaction. State contains an exclusion flag, labels, and an optional text correction. Labels are trimmed, non-empty, deduplicated and sorted. `null` removes a correction; an empty correction is rejected. Original source evidence is not overwritten by a state change.

`updateState` requires the exact stored source hash and expected revision. A stale source/revision fails without changing either table. A changed state increments the revision and appends history atomically. An identical normalized state is a no-op. A history write failure rolls back the corresponding current-state write as well. Read/history queries are scoped to base, item and unit; `listByBase` reads only the requested base in deterministic record-ID order. These are internal database rows, not a published cross-process entity endpoint.

The additive migration leaves existing sources untouched and creates no synthetic governance records. These tables live in the normal database, not a replaceable index. Tests read stored records through an independent file-backed connection and reopen the derived index. Full application restart, base import/export and restore workflows have not been verified for this feature.

## Retrieval authority

`KnowledgeQueryService` reads a synchronous Main-owned snapshot of durable record IDs/revisions and derived exclusion sets before searching. `KnowledgeIndexStore.resolveGovernanceExclusions` checks each binding against the actual unit ID, material ID, material/current content hashes, offsets and original body text. It never matches by title, ordinal alone or text similarity.

- An exact excluded unit is suppressed in every retrieval lane. Re-enabling removes only its exclusion; stored labels/corrections remain unchanged.
- A non-null correction is pending and its unit stays suppressed. This layer cannot prepare or publish corrected lexical text/embeddings, so neither old text nor an unprepared override is advertised as the current retrieval view.
- Any unmatched record pauses its entire material, retaining original evidence and history. Other materials remain searchable. Same-content, same-identity rebuilds can reuse decisions without copying them into the index. There is no rebind/discard or visible review workflow yet.
- BM25 MATCH, its short-term relaxation, the short-token LIKE fallback, vector search and both hybrid lanes apply the exclusion predicate before their SQL limits and RRF candidate selection. Unit-level filtering does not suppress allowed units that share an embedding hash. Bound JSON arrays avoid per-ID SQL variable limits and SQL interpolation.

After index search settles, Main revalidates the durable revisions and exact-index reconciliation before calling the reranker. It repeats the check after reranking and before returning results. A concurrent decision change or a rebuild that changes a governed binding returns a retryable conflict, without an automatic repeat of a possibly paid provider call. Failed policy reads and a closed governed index fail closed. Main does not treat the business database and index database as one transaction, cache a renderer policy, or log decision text.

Exclusion is not deletion or access control. Chunk inspection and explicit original-source reads retain original text and offsets; citations and source files are not rewritten. Labels do not enter query text, model prompts or embeddings.

## Boundaries Still Pending

- Mutation endpoints, per-base serialized writes, batch previews and atomic selection validation.
- Visible review-needed state and explicit rebind/discard after source/chunk identity changes.
- Effective-text/embedding jobs, matching lexical/vector revision publication and crash recovery.
- Base backup/restore integration for durable decisions and history.
- Original/corrected citation revisions and historical references.
- Inspector controls, user confirmation, cost disclosure and native acceptance.

Do not expose editing or describe a correction as indexed/effective until the remaining workflow enforces the Spec. Keep the Spec proposed. These layers provide partial AC1/AC2/AC3/AC4 foundations, not complete acceptance or resolution of issue #19001.

## Verification

Storage tests use `setupTestDatabase()` with production migrations. They cover original evidence, independent connection reads, normalized changes, stale revision/source conflicts, removal/no-op semantics, injected history-write failures, scope guards and ownership cascades. The migrate-forward test starts before the additive migration with populated Knowledge rows and checks that those rows are preserved with no invented decisions.

Retrieval integration tests use the real migrated Main database, file-backed per-base SQLite, production FTS/vector engine, query service and rerank path. Only configured provider methods are mocked. Scenarios cover exclusions beyond the candidate cap, all search lanes and fallbacks, shared embedding hashes, thousands of bound IDs, UTF-16 evidence, reversible inclusion, pending corrections, exact rebuild/reopen, conservative source/chunk mismatch handling, forged bindings, original inspection, and revision/index changes before reranking and return. No live provider, native Electron, correction publication, restore or inspector acceptance is claimed.
