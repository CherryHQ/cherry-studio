# Agent Note: Session message tree storage constraints

Status: implemented

English | [中文](2026-11-09-session-tree-storage-constraints.zh.md)

## Problem

Session message parents were unconstrained text. A direct writer could persist a missing parent, a parent in another Session, or a non-root message with no parent. Adding constraints alone would reject the flat rows in shipped v2 databases including archives converted by the bridge release.

## Decision

Require `(role = 'root') = (parent_id IS NULL)` and a composite foreign key from `(session_id, parent_id)` to `(session_id, id)`, backed by a unique index. Retain the existing unique root index. The parent foreign key uses NO ACTION: ordinary deletion must reparent children first, while Session deletion still cascades the entire archive without recursively cascading along a deep message chain.

Append a custom backfill migration before the generated constraint migration. Migration `0039` reconstructs archives without a selected head or any parent edges in `(created_at, id)` order. It checks existing edges while foreign keys are disabled and rolls back its migration transaction on failure. Root insertion disables the FTS insert trigger during backfill to avoid conflicting with explicitly allocated FTS rowids; the production migration runner restores triggers afterward. Rebuild FTS within the migration transaction so every generated root has an FTS document, including roots with no text. The one-time rebuild scans existing searchable text; merely restoring triggers leaves external-content integrity broken and can make later Session deletion fail.

Between `0032` and `0039`, continuing an older session could create a root and append new turns while leaving earlier messages detached. Before applying `0039`, the shared boot and backup-restore runner repairs these databases in one transaction. It orders flat archives by `(created_at, id)`. In mixed trees, parentless messages that predate the root and have no linked descendants become a shared prefix of the existing root branches. Other detached subtrees and messages with missing or cross-session parents attach to their own session's root. The repair creates a root where necessary and clears a parent stored on a root.

Migration `0043` also repairs empty, missing and cross-session head references in databases that already passed the tree backfill. It chooses the latest leaf reachable from the session root by `(created_at, id)` and preserves valid selections. A flat archive whose selected root was a placeholder selects its restored history tip during the pre-backfill repair.

Flat-archive reconstruction moves from the startup seeder described in the [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md) into schema migration, partially superseding that backfill responsibility. The migration also gives empty Sessions their root and selection; startup seeding only backfills legacy delivery reply anchors. The [tree operation decision](2026-11-09-agent-session-tree-operations.md) records query, mutation and projection behavior.

The current application delegates v1 conversion to the 2.2.2 bridge release. Its resulting v2 archives use the appended migrations above. Direct-SQL test fixtures create real roots through a shared fixture helper.

## Alternatives considered

- A parent-ID-only foreign key allows cross-Session edges.
- Self-cascading deletion can erase descendants accidentally and hits SQLite trigger depth limits on long chains.
- Startup-only seeding happens after schema migrations, too late to satisfy the new CHECK.

## Consequences

The constraints protect local parent relationships. Acyclicity and native execution identity remain separate invariants. The compatibility repair preserves message IDs, contents and timestamps, along with existing branch choices and descendants. It commits before the Drizzle migration transaction. If a later migration fails, a retry sees the recovered trees.

## Verification

- Regression — `agentSessionTreeConstraints.test.ts`: real file-backed SQLite tests cover invalid inserts and updates, reparent-before-delete, whole-Session deletion with 2,000 descendants, populated pre-tree and pre-constraint upgrades, preservation of branches and FTS results, FTS external-content integrity and deletion of empty/populated Sessions after upgrade, and repair of missing or cross-session legacy parents.
- Regression — `agentSessionTreeConstraints.test.ts` preserves all 10,001 flat messages through upgrade. Existing data, runtime, search, recycle-bin and migration consumers run with valid tree fixtures.
- Regression — `agentSessionTreeConstraints.test.ts` verifies default pagination and search for recovered v2.2.2 history, alternate branch preservation, recovery of detached subtrees including sessions without a root, and repair of invalid v2.2.3 selections before exposing history.
