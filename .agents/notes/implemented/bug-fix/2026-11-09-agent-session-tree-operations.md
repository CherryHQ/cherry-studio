# Agent Note: Session delivery mutation and tree query costs

Status: implemented

English | [中文](2026-11-09-agent-session-tree-operations.zh.md)

## Problem

Session message PATCH accepted changes to delivery text while DELETE rejected the same in-flight delivery. Native input binding may not exist yet in `accepted` or `delivering`, so binding checks alone cannot protect the dispatched instruction.

Branch navigation issued one ORM query per descendant. SQLite could choose the session-time index and rescan the session at each level. Flat-history seeding also issued one ORM update per message, and page assembly repeatedly scanned the same sibling rows.

## Decision

Reject public PATCH for `accepted` and `delivering` inside the write transaction, before changing content, attachments, checkpoints or timestamps. Terminal display-message behavior remains unchanged. This restores the input immutability boundary in the [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md).

Resolve a branch in one recursive query, selecting the newest immediate child by `(created_at, id)` at every level. Unary `+` on the ordering timestamp prevents the session-time ordering shortcut; the existing `(session_id, parent_id)` index restricts each lookup to that parent's children. Group page siblings once by parent. Seed flat histories with SQLite `lag()` and one update per session, retaining timestamps, roots, selected branches and the existing seeder version.

## Alternatives considered

- UI-only disabling leaves the public PATCH endpoint writable.
- Selecting the newest leaf anywhere in the subtree changes Session navigation semantics.
- Persistent path caches introduce invalidation ownership; these local query repairs require no cache or schema migration.

## Consequences

Pagination retains its timestamp/ID cursor and still walks the selected ancestry. These changes do not establish bounded-depth pagination or Electron rendering performance. Native history is still authoritative for execution; editing display rows is not native rollback.

## Verification

- Regression — `AgentsMigrator.treeValidation.test.ts`: 10,001 v1 messages preserve data and order through import, seeding and pagination; in-flight delivery PATCH must reject without changing the row.
- Regression — `agentSessionMessageTree.test.ts`: immediate-child ordering, timestamp ties, siblings, empty sessions, repeated seeding and delayed replies retain their contracts.

Local service measurements use identical file-backed SQLite fixtures and alternate before/after operations. Timing observations are not packaged-app or live-provider acceptance.
