# Agent Note: Pi Durable image deduplication in SQLite

Status: proposed

English | [中文](2026-11-16-pi-durable-image-storage.zh.md)

## Problem

Pi Durable 1.5.2 serializes native records as JSON in SQLite. Inline image data therefore retains Base64 overhead and can recur in submissions, entries, tasks and document content. Actual duplication and total disk savings have not yet been measured against a user database. Context compaction does not delete retained history, and rebuilding identical records does not remove their image payloads.

This proposal owns the physical image representation inside Durable SQLite storage. The [runtime contract](2026-10-17-agent-runtime-contract.md) continues to own runtime boundaries. The [desktop integration](../../../../src/main/ai/runtime/piDurable/README.md) retains its native identity, fork, recovery and projection contracts. Product session messages remain projections; they are not a replacement recovery source.

The baseline was inspected in the published `@earendil-works/pi-durable@1.5.2` package: `storage/sqlite/rows.js` uses JSON encoding, `commit.js` writes records and document revisions, and `storage.js` materializes reads. No image-resource hook was found in that SQLite API. The repository's existing dependency patch must remain intact.

## Proposal

### Storage ownership

Implement this capability upstream in Pi Durable's SQLite storage implementation. Cherry consumes a compatible release; if a release is unavailable, a reviewed source change may be carried in the existing dependency patch with equivalent tests. Do not add a Cherry-only wrapper that replaces images before native submission or imports private SDK modules. Other storage implementations keep their existing logical contract and representation.

Use a binary BLOB table in the same native SQLite database, keyed by SHA-256 of the decoded image bytes. Deduplicate within one backend, including its roots, children and forks. Keep MIME type and other image metadata at each reference so identical bytes with different metadata still round-trip correctly. Independent backends do not share a resource store in this scope.

Persist versioned references in the encoded record and hydrate them at every storage read boundary. Public records, model requests, observers, archives and logical exports continue to contain the original image content. The encoding must distinguish its own references from arbitrary user JSON without reserving user values. Canonical Base64 must round-trip exactly; unsupported or noncanonical encodings remain inline rather than being silently normalized. Images embedded in ordinary text are outside scope.

Cover native structured image payloads wherever they persist: submissions, entries, task state/results and document bases or deltas. Document reconstruction, copy and delta application must operate on the same logical values as before. Do not rewrite arbitrary strings that happen to resemble Base64. Read images in batches per record page and bound temporary decoded buffers; do not eagerly hydrate an entire backend.

### Atomicity and compatibility

Commit image bytes, record references and reference ownership in the same SQLite transaction. Rejected batches and transaction rollback must not leave committed references to absent resources. A missing or corrupt resource is an explicit storage failure; never replace it with empty content or replay a tool to regenerate it.

Append a native schema migration; never rewrite an existing migration. The new reader supports legacy inline records and new references. Convert existing payloads in bounded, restartable transactions under exclusive backend ownership, preserving record IDs, commit sequences, document versions, fork ancestry and pending execution state. Coordinate migration with the desktop's strict `openExisting` path rather than silently creating or replacing a missing store. Opening a migrated format with an unsupported older runtime must fail clearly; downgrade requires restoring a compatible backup.

### Backup and reclamation

Retain one SQLite file per backend. Image resources participate in the same consistent SQLite backup or existing quiesced/checkpointed backup boundary as records. Restore must work without original attachment files or an external image directory. Logical exports hydrate images so exporting and importing through another supported storage format preserves content without a hidden dependency on the original database.

Track references from every retained encoded record and document revision, not just the current model context. Replacing a task or submission record and deleting a revision updates its resource references transactionally. Reclaim a BLOB only when no retained record references it, serialized with commits. Compaction, task completion, closing a panel and deleting one fork are not proof of unreachability. Backend deletion releases its resources with the database. Physical free-page reclamation is separate maintenance; this proposal does not schedule database rebuilds or introduce history expiration.

## Alternatives considered

- Separate content-addressed image files: also removes encoding overhead, but requires coordinating file publication, SQLite commits, backup manifests and orphan collection. Defer until evidence justifies cross-backend sharing or filesystem storage.
- BLOBs without deduplication: removes encoding overhead but keeps repeated payloads in separate records.
- Rebuild from product messages or retain only compacted context: changes recovery and historical fork semantics and does not solve repeated payloads when all images are reimported.
- Compress whole JSON records: may reduce bytes, but retains repeated image ownership and changes the encoding of unrelated content.

## Acceptance criteria

- AC1 — Repeated identical structured image bytes across submissions, entries, tasks, document revisions and same-backend forks occupy one resource, while MIME metadata and logical values round-trip unchanged. (verification: upstream SQLite storage contract tests)
- AC2 — Ordinary JSON resembling a resource reference, noncanonical Base64, mixed text/image results, document deltas and paginated reads retain their original meanings without unbounded backend hydration. (verification: upstream codec and storage contract tests)
- AC3 — Batch rejection, transaction failure and process interruption cannot publish dangling references; missing or corrupt resources fail explicitly without fabricated content or tool replay. (verification: upstream SQLite fault-injection and process-restart tests)
- AC4 — A populated legacy store migrates and resumes after interrupted conversion with the same native IDs, fork checkpoints and pending inputs; unsupported older readers reject the new format. (verification: upstream migration fixtures and desktop native-context integration tests)
- AC5 — Backup and restore on a fresh directory preserve root/child images and recovery without source attachments; logical export/import round-trips all images. (verification: desktop backup integration and upstream storage interchange tests)
- AC6 — Replacing or removing the final owning record permits resource reclamation, while historical revisions, retained forks and concurrent writes prevent premature deletion. Whole-backend removal leaves no separate resources. (verification: upstream reclamation and desktop backend lifecycle tests)
- AC7 — A repeatable image-heavy fixture reports database and WAL bytes separately, resource count, write/read latency and peak memory before and after conversion; repeated payloads are absent from encoded records and resource bytes equal the unique decoded payload total. (verification: upstream benchmark fixture and desktop integration evidence)

## Risks

This changes a persistent upstream format and requires exact-head Spec approval before implementation. SQLite driver BLOB support, batch parameter encoding and every read path must be verified across the upstream adapters; a Node-only success is insufficient. Hashing and hydration add CPU and memory cost. Deduplication reduces representation overhead and repeated bytes, but unique retained images still grow with history. It does not reduce model request Base64 size or guarantee a smaller product message database. No runtime change, migration, upstream submission or measured disk saving is claimed by this proposal.
