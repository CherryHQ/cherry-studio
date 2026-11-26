# Agent Note: Session delivery mutation and tree query costs

Status: implemented

English | [中文](2026-11-09-agent-session-tree-operations.zh.md)

## Problem

Session message PATCH accepted changes to delivery text while DELETE rejected the same in-flight delivery. Native input binding may not exist yet in `accepted` or `delivering`, so binding checks alone cannot protect the dispatched instruction.

Branch navigation issued one ORM query per descendant. SQLite could choose the session-time index and rescan the session at each level. Flat-history seeding also issued one ORM update per message, and page assembly repeatedly scanned the same sibling rows.

## Decision

Reject public PATCH for `accepted` and `delivering` inside the write transaction, before changing content, attachments, checkpoints or timestamps. Terminal display-message behavior remains unchanged. This restores the input immutability boundary in the [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md).

Resolve a branch in one recursive query, selecting the newest immediate child by `(created_at, id)` at every level. Unary `+` on the ordering timestamp prevents the session-time ordering shortcut; the existing `(session_id, parent_id)` index restricts each lookup to that parent's children. Group page siblings once by parent.

Flat-history reconstruction belongs to the appended migrations in the [storage constraint decision](2026-11-09-session-tree-storage-constraints.md). The same migration gives empty Sessions their root and selection; startup `AgentSessionMessageTreeSeeder` only backfills legacy delivery reply anchors. Existing non-empty trees and their selections, including an absent selection, remain unchanged. Direct-SQL fixtures link their intended message IDs explicitly through `linkSessionMessageChain`.

For #23359, select only page IDs, parents and timestamps before loading payloads. Reuse one prepared primary-key read and project each assistant message immediately when `deferToolOutputs` is requested. This prevents a full page of raw tool outputs from remaining live during projection and avoids decoding the lookahead row. Default reads stay verbatim. The bounded per-row reads trade up to 200 synchronous lookups for a smaller live payload set.

Shared tool-output projection reuses the oversized JSON string from the 32 KiB UTF-8 transport check to compute the reference revision. Each stored-message or live-chunk projection serializes the original output once, keeping the existing hash format without a retained cache.

## Alternatives considered

- UI-only disabling leaves the public PATCH endpoint writable.
- Selecting the newest leaf anywhere in the subtree changes Session navigation semantics.
- Persistent path caches introduce invalidation ownership; indexed query repairs need no persistent cache. The separate [storage constraint decision](2026-11-09-session-tree-storage-constraints.md) owns schema migration and flat-history backfill.

## Consequences

Pagination retains its timestamp/ID cursor and still walks the selected ancestry. These changes do not establish bounded-depth pagination or Electron rendering performance. Native history is still authoritative for execution; editing display rows is not native rollback.

Single oversized rows and non-deferred reads can still require substantial memory. Other whole-history consumers and native process crashes are outside this repair; it does not establish that every symptom in #23359 is resolved.

## Verification

- Regression — `AgentSessionMessageService.test.ts` rejects in-flight delivery PATCH without changing the row. Migration evidence is recorded in the [storage constraint decision](2026-11-09-session-tree-storage-constraints.md).
- Regression — `agentSessionMessageTree.test.ts`: immediate-child ordering, timestamp ties, siblings, empty sessions, repeated seeding and delayed replies retain their contracts. Startup seeding preserves non-empty branches with either an absent or selected head.

Local service measurements use identical file-backed SQLite fixtures and alternate before/after operations. Timing observations are not packaged-app or live-provider acceptance.

- Regression — page projection preserves raw storage, small outputs, older-page cursors and default verbatim reads; a guarded lookahead decoder catches hydration outside the requested page.
- Local memory probe — 80 stored messages with 1 MiB tool outputs, reading the default 50-item page: maximum sampled live JS heap growth at decode boundaries was 102.0 MiB before and 2.2 MiB after, with forced GC at each sample. This measures retained payloads, not peak RSS. A 16 MiB SQLite heap probe did not reproduce SQLITE_NOMEM.

- Regression — `messageOutputProjection.test.ts` rejects a second serialization of the same output while checking the exact reference revision on stored and live paths; exact-budget, over-budget, CJK and persisted citation cases preserve transport behavior.
