---
description: Metadata-first selection design for memory-bounded diagnostic chat record export
sources:
  - src/main/data/services/MessageService.ts
  - src/main/data/services/AgentSessionMessageService.ts
  - src/main/services/diagnostics/chatRecordCollector.ts
  - src/main/services/diagnostics/DiagnosticBundleService.ts
  - src/main/services/diagnostics/sourceSelection.ts
---

# Diagnostic Chat Record Metadata Selection

## Status and scope

This design addresses two review findings in diagnostic chat record export:

- range scans currently materialize full message entities before budget selection, so the source-size limit does not bound pre-selection JavaScript memory;
- full-scan statistics retain one string key per message even though message records are inherently unique.

It does not change the archive schema, shared types, DataApi, IPC, database schema, or the existing global keyset order. Missing archive counting is a separate fix.

## Ownership

`MessageService` and `AgentSessionMessageService` continue to own reads from their respective message tables and their row-to-entity mappings. Each service exposes a service-specific, main-process-only metadata page for the existing diagnostic range walk:

```ts
type MessageMetadata = { id: string; topicId: string; createdAt: string; entityJsonBytes: number }
type AgentSessionMessageMetadata = { id: string; sessionId: string; createdAt: string; entityJsonBytes: number }
```

The context field remains domain-specific rather than introducing a shared descriptor. The methods preserve the current closed time range, liveness rules, `(createdAt DESC, id ASC)` order, cursor format, and page size behavior.

`entityJsonBytes` is the exact UTF-8 byte length of `JSON.stringify(entity)` for the owning service's canonical row-to-entity result. It excludes the JSONL newline. The service computes it in the SQLite projection without returning message body columns to JavaScript. Service tests compare the projection with actual serialization for non-ASCII text, escaped characters, JSON fields, null fields, timestamps, and delivery metadata so the projection cannot silently drift from row mapping.

`TopicService` and `AgentSessionService` do not gain diagnostic APIs. Diagnostics uses their existing `getById` methods to obtain the canonical context entities.

Diagnostics continues to own:

- archive names and the one-byte JSONL newline;
- newest-first merge across the two metadata streams;
- topic and session deduplication;
- source-budget selection;
- hydration of selected message entities;
- actual-byte validation and staging.

No generic repository, batch `getByIds`, shared descriptor, or DataApi endpoint is added.

## Collection and selection flow

Each message generator requests one metadata page at a time. It creates lightweight chat candidates containing the message identity, context identity, ordering timestamp, archive routing, and estimated serialized bytes. It never retains a message entity, JSON string, or buffer.

The first observation of a topic or session calls the existing context owner, serializes that entity to measure it, and retains only the context key and byte count. This is the only full-scan deduplication state. Context entities and buffers are released before the next candidate is produced.

The two generators are merged newest-first as today. The budget selector sees message bytes plus the context bytes when that context has not already been selected. Selected candidates remain in memory until staging; their count is bounded by the positive per-message byte cost and the source budget. Unselected message identities are not retained.

Full-scan statistics follow the data model instead of a message-key set:

- every candidate increments `messageCount` and `recordCount` once and adds its message bytes plus the JSONL newline;
- the first observation of a context increments `recordCount` once and adds its serialized bytes plus the newline;
- only context keys require a full-scan set or map.

Inspection consumes the same metadata stream and unique contexts. It does not hydrate message bodies.

## Staging and source changes

Files selected by the shared budget are staged first. Their actual staged bytes are subtracted from the source limit, and chat staging receives the remaining budget.

Chat staging walks selected candidates newest-first. It hydrates at most one candidate's canonical message entity and any not-yet-staged context entity at a time, serializes them as UTF-8 JSONL, and checks their actual combined incremental bytes before writing. Context inclusion is determined from contexts actually staged, not only from the earlier estimated selection, so a skipped candidate cannot leave later messages without their context record.

If the actual incremental bytes fit, the records are written to their domain archives and the actual byte counts feed the manifest. If they do not fit, the whole message candidate is omitted and `size_limit_reached` is recorded. A difference between projected and actual bytes records `source_changed`; a row that disappeared after scanning is also treated as changed. Other hydration or serialization failures record `source_unreadable` and omit the affected candidate without discarding readable file sources.

For hydrated records, manifest totals replace the scan-time byte estimate with the observed actual value before omitted statistics are derived. Records that cannot be hydrated retain their scan-time estimate in omitted statistics. Included statistics always describe bytes and unique records actually staged.

This recheck detects changes that affect byte length or row existence. A same-length mutation may be exported as its current canonical entity; the export does not claim snapshot isolation across the scan and staging phases.

## Memory invariant

Before selection, JavaScript retains at most two metadata pages, merge lookahead, and one byte count per unique topic or session. It does not retain message bodies, serialized message strings, message buffers, or one key per message.

After selection, staging retains the budget-bounded selected metadata and hydrates one candidate at a time. The source budget remains a payload-selection limit rather than a general process-memory hard limit, but a large unselected row can no longer enter the JavaScript heap during the range scan.

## Verification

Implementation must demonstrate these contracts with focused tests:

1. Both metadata page methods preserve filtering, cursor order, and pagination while returning no body fields.
2. Both `entityJsonBytes` projections equal canonical entity serialization across Unicode, escaping, nullable JSON, timestamps, and agent delivery composition.
3. Collection never calls full-message hydration while scanning or inspecting; only selected candidates are hydrated during staging.
4. Full-scan stats count every message directly and deduplicate only topics or sessions.
5. A projected-versus-actual size change cannot exceed the remaining source budget and produces corrected included/omitted statistics and warnings.
6. A changed or unreadable selected chat does not discard readable file sources.

Run the focused main-process service and diagnostics tests, `pnpm lint`, and the broader change gate because the implementation spans data services and diagnostics selection.

## Alternatives not selected

- Reducing the existing full-entity page size still allows one row to exceed the intended pre-selection bound and keeps message bodies alive behind generator frames.
- Querying message tables directly from diagnostics duplicates liveness and row-mapping policy outside the table owners.
- A generic diagnostic descriptor, repository, or shared endpoint expands infrastructure for a single main-process consumer without adding an independent cross-consumer capability.
- Database-wide aggregate statistics avoid context-key memory but can monopolize the synchronous SQLite connection for a long scan and do not provide the newest-first candidates required for selection.
