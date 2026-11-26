# Agent Note: Session message tree storage constraints

Status: implemented

English | [中文](2026-11-09-session-tree-storage-constraints.zh.md)

## Problem

Session message parents were unconstrained text. A direct writer could persist a missing parent, a parent in another Session, or a non-root message with no parent. Adding constraints alone would reject the flat rows in shipped v2 databases including archives converted by the bridge release.

## Decision

Require `(role = 'root') = (parent_id IS NULL)` and a composite foreign key from `(session_id, parent_id)` to `(session_id, id)`, backed by a unique index. Retain the existing unique root index. The parent foreign key uses NO ACTION: ordinary deletion must reparent children first, while Session deletion still cascades the entire archive without recursively cascading along a deep message chain.

Append a custom backfill migration before the generated constraint migration. Migration `0039` reconstructs archives without a selected head or any parent edges in `(created_at, id)` order. It checks existing edges while foreign keys are disabled and rolls back its migration transaction on failure. Root insertion disables the FTS insert trigger during backfill to avoid conflicting with explicitly allocated FTS rowids; the production migration runner restores triggers afterward. Rebuild FTS within the migration transaction so every generated root has an FTS document, including roots with no text. The one-time rebuild scans existing searchable text; merely restoring triggers leaves external-content integrity broken and can make later Session deletion fail.

Between `0032` and `0039`, opening a legacy session could select a new root while leaving its older messages detached. Before applying `0039`, the shared boot and backup-restore migration runner repairs these databases in one transaction. For an otherwise flat session whose head is the root, it chains the messages in `(created_at, id)` order and selects the last one. For sessions with existing branches, it attaches each detached subtree to the same session's root and preserves the selected head and existing parent edges. It keeps message IDs, content and timestamps.

Flat-archive reconstruction moves from the startup seeder described in the [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md) into schema migration, partially superseding that backfill responsibility. The migration also gives empty Sessions their root and selection; startup seeding only backfills legacy delivery reply anchors. The [tree operation decision](2026-11-09-agent-session-tree-operations.md) records query, mutation and projection behavior.

The current application delegates v1 conversion to the 2.2.2 bridge release. Its resulting v2 archives use the appended migrations above. Direct-SQL test fixtures create real roots through a shared fixture helper.

## Alternatives considered

- A parent-ID-only foreign key allows cross-Session edges.
- Self-cascading deletion can erase descendants accidentally and hits SQLite trigger depth limits on long chains.
- Startup-only seeding happens after schema migrations, too late to satisfy the new CHECK.

## Consequences

The constraints protect local parent relationships. They do not prove acyclicity, selected-head validity or native execution identity. A parent on a root, a missing parent referenced by ID, or a cross-session parent still stops the upgrade. The repair commits before the Drizzle migration transaction. If a later migration fails, a retry sees the already repaired trees.

## Verification

- Regression — `agentSessionTreeConstraints.test.ts`: real file-backed SQLite tests cover invalid inserts and updates, reparent-before-delete, whole-Session deletion with 2,000 descendants, populated pre-tree and pre-constraint upgrades, preservation of branches and FTS results, FTS external-content integrity and deletion of empty/populated Sessions after upgrade, and transactional rejection of corrupt edges.
- Regression — `agentSessionTreeConstraints.test.ts` preserves all 10,001 flat messages through upgrade. Existing data, runtime, search, recycle-bin and migration consumers run with valid tree fixtures.
- Regression — `agentSessionTreeConstraints.test.ts` migrates a v2.2.2 flat archive with an already selected root and a detached subtree beside healthy branches. It verifies history, selection, foreign keys, rerun behavior and preservation of source rows when an explicit bad edge blocks upgrade.
