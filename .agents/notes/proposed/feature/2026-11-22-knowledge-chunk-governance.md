# Agent Note: Governed Knowledge chunk changes

Status: proposed

English | [中文](2026-11-22-knowledge-chunk-governance.zh.md)

## Problem

Issue #19001 asks for reversible retrieval exclusions, batch labels/metadata, and provenance-preserving text corrections for Knowledge chunks. Chunks currently are derived index data. `KnowledgeIndexStore.rebuildMaterial` replaces units and search text, and unit identity includes material ID, content hash, unit type, index and offsets. Overwriting those rows would lose user intent on rebuild and break the invariant that a chunk's original text is a slice of its source content.

The main database owns Knowledge business data; each base's `index.sqlite` is rebuildable. User decisions must not live only in that disposable index. Existing source deletion/reindex guards, background jobs, visibility checks and source/citation ownership remain in force.

## Proposal

### Durable governance, derived effective index

Persist chunk governance in Main-owned business data, accessed through validated DataApi reads/mutations and existing Knowledge workflow orchestration. A record binds base/item identity, source content hash, unit identity/offsets, an original-text snapshot/hash, user labels, optional text override, exclusion state and a revision. Retain original text and source provenance separately from corrected retrieval text. Store only these changes and their change history, not source credentials or unrelated document copies. Migration creates no records for untouched chunks.

The per-base index remains derived. It materializes effective retrieval text and exclusion state for one committed governance revision without rewriting source content or its original offsets. Use a distinct effective-text/embedding identity for an override. Retain the existing normalized source slice as original evidence; an override is not a new claim that the source file contained those corrected characters. Backup/restore must preserve the durable decisions alongside their owning base/item, and rebuilding the disposable index must reconstruct them.

### User operations and state

The existing chunk inspector shows original text, effective text, source identity, labels and active/pending/review-needed state. Users can exclude/include a chunk without deleting its source, edit or remove a text override, and add/remove labels for explicitly selected chunks. Exclusion affects retrieval, not source ownership or the ability to inspect original content. Labels are organizational metadata; adding one neither changes content nor silently adds it to model prompts or search queries.

Preview the selection count and effect of a batch action. Main verifies that every selected chunk belongs to the requested accessible base/item and expected source/revision. Invalid/stale selections fail atomically rather than partially editing another revision. Re-enabling a chunk removes only its exclusion, not its text correction or labels. Removing an override restores original text through the same index update path. Existing material/base deletion remains a separate action and removes its owned governance records according to the existing deletion/restore lifecycle.

### Applying a change safely

Serialize mutations and reindex/delete work through the existing per-base Knowledge mutation owner. Accept the durable revision first, then use recoverable JobManager work to prepare the effective lexical text and, for vector bases, embeddings for changed effective text. Show pending/failed state and the recoverable reason. Exclusion must take effect at the retrieval authority immediately, without waiting for a new embedding, while successful re-enable/correction is not called indexed until the complete effective revision is ready.

The main database and per-base index cannot share a transaction. Bind derived results to the durable revision and publish a material's effective lexical/vector view atomically. When revisions differ or preparation fails, suppress the affected unit from all retrieval lanes rather than return old text or stale embeddings as current. Keep unaffected chunks searchable. Retry, restart and cancellation cannot publish an older revision over a later edit. Removing an override follows the same rule, including any required original embedding preparation. No unapproved model call runs just from opening the inspector; apply/confirm explains when a vector correction requires existing configured embedding work and its possible provider cost.

Enforce exclusion before bounded candidate selection in BM25/vector/hybrid retrieval, not just by hiding final UI rows. Otherwise excluded high-ranked units could consume the finite candidate budget and starve valid lower-ranked chunks. Revalidate the accepted governance revision before reranking and before returning results, so excluded text cannot reach the reranker or a model through a stale in-flight search. Preserve existing item/base visibility checks, result ranking semantics and limits.

### Reindex reconciliation and citations

Reapply a record automatically only when the source content and exact unit identity/offsets still match. A same-content, same-chunk rebuild reproduces that identity and may safely reuse the decision. Never match by ordinal alone, substring similarity or title after source/chunking changes. If identity no longer matches, retain the record and its original evidence as review-needed; show the reason and the affected source. Do not silently discard corrections or revive previously excluded content. Until the user explicitly reviews, rebinds or discards unmatched records, pause retrieval for that material, while other materials remain available. Rebinding previews the old/new original text and creates a new revision with a traceable link.

Effective search hits identify an override and its governance revision; citations distinguish original-source evidence from user-corrected text. Opening a citation offers the original and the effective correction without moving original source offsets to fit the override's length. Historical citations retain their recorded revision or explicitly say it is unavailable, rather than resolve silently to today's different text. Source read/grep continues to expose the source itself and must not be mislabeled as the corrected retrieval view.

## Alternatives considered

- Edit/delete derived index rows directly: reindex erases decisions and cannot preserve recoverability or provenance.
- Persist decisions only inside `index.sqlite`: a disposable projection would become the sole owner of user work.
- Rewrite original content to fit a correction: destroys the source-slice/citation contract and makes a correction look like original evidence.
- Fuzzy reattach on reindex: can transfer an exclusion or correction to unrelated text after chunking/source changes.
- Hide exclusions only after top-K or only in the renderer: can leak text to rerankers/models and starve valid candidates.
- Pretend two database commits are atomic: leaves mixed lexical/vector/governance revisions after failure or restart.

## Acceptance criteria

- AC1 — Governance records, original evidence, labels, revisions and history survive restart, index rebuild and supported base backup/restore; source bytes/offsets remain original, ownership follows base/item lifecycle, and a migrated untouched base has no synthetic changes. (verification: database, main and restore integration)
- AC2 — Exclude/include and batch label changes affect only explicitly selected accessible chunks, are reversible and conflict safely on stale source/revision; exclusion does not delete source content or unrelated labels/corrections. (verification: database, main, renderer and Electron)
- AC3 — Retrieval uses a complete effective revision with matching lexical/vector text; exclusions apply before candidate caps and before reranking/model use, unaffected chunks remain searchable, and failed/cancelled/restarted jobs cannot leak stale text or overwrite later edits. (verification: main retrieval and job integration)
- AC4 — Same-identity rebuilds preserve active decisions; changed/ambiguous identities retain evidence and a visible review-needed state with affected-material retrieval paused until explicit review, and confirmed rebind/discard cannot silently apply intent to a different chunk. (verification: database, reindex integration and renderer)
- AC5 — Original versus corrected text and citation revision are clear, historical references do not silently resolve to a different correction, and correction removal restores original retrieval text without inventing source offsets. (verification: main, citation integration and renderer)
- AC6 — Accessible bilingual inspector, batch previews, pending/error/review states and cost disclosure work in narrow/light/dark layouts; user guidance and scoped checks pass, and partial implementation stays proposed without claiming full issue resolution. (verification: renderer, visual inspection, docs gate and Electron)

## Risks

Cross-database recovery and bounded retrieval are correctness boundaries, not UI details. A first storage-only or exclusion-only implementation does not cover the complete issue. Layer durable records/reconciliation, retrieval/index publication, and inspector/citation UX separately, retaining explicit AC coverage in each layer.

Conservative reconciliation can pause a source after an unrelated edit changes its content hash. This is deliberate and visible, preferring a review to silently reintroducing excluded content or misapplying a correction. Review should be reversible and must not erase original evidence.

Corrections and original snippets can contain sensitive information. Keep them within the owning base's access/backup boundaries, do not include full text in routine logs, and explain that retrieval exclusion is not secure deletion or a restriction on explicit source reads.
