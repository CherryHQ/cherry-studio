# Agent Note: Session message tree storage constraints

Status: implemented

English | [中文](2026-11-09-session-tree-storage-constraints.zh.md)

## Problem

Session message parents were unconstrained text. A direct writer could persist a missing parent, a parent in another Session, or a non-root message with no parent. Adding constraints alone would reject the flat rows in shipped v2 databases and the v1 importer.

## Decision

Require `(role = 'root') = (parent_id IS NULL)` and a composite foreign key from `(session_id, parent_id)` to `(session_id, id)`, backed by a unique index. Retain the existing unique root index. The parent foreign key uses NO ACTION: ordinary deletion must reparent children first, while Session deletion still cascades the entire archive without recursively cascading along a deep message chain.

Append a custom backfill migration before the generated constraint migration. Only archives without a selected head or any parent edges are reconstructed, ordered by `(created_at, id)`. Preserve existing branches, selections, timestamps and message facts. Explicitly reject invalid existing parent edges while the migration runner has foreign keys disabled; failure rolls back the complete upgrade. Root insertion disables the FTS insert trigger during backfill to avoid conflicting with explicitly allocated FTS rowids; the production migration runner restores triggers afterward.

The v1 importer creates roots and inserts messages in normalized timestamp/ID order with per-Session tails across bounded batches. Roots, content, selected heads and FTS updates share the existing import savepoint. Count validation excludes generated roots. Direct-SQL test fixtures create real roots through a shared fixture helper.

## Alternatives considered

- A parent-ID-only foreign key allows cross-Session edges.
- Self-cascading deletion can erase descendants accidentally and hits SQLite trigger depth limits on long chains.
- Startup-only seeding happens after schema migrations, too late to satisfy the new CHECK.

## Consequences

The constraints protect local parent relationships. They do not prove acyclicity, selected-head validity or native execution identity. Corrupt existing parent edges stop migration instead of silently choosing a replacement parent.

## Verification

- Regression — `agentSessionTreeConstraints.test.ts`: real file-backed SQLite tests cover invalid inserts and updates, reparent-before-delete, whole-Session deletion with 2,000 descendants, populated pre-tree and pre-constraint upgrades, preservation of branches and FTS results, and transactional rejection of corrupt edges.
- Regression — `AgentsMigrator.treeValidation.test.ts` covers 10,001 messages across batches and timestamp normalization across Sessions; `AgentsMigrator.transforms.test.ts` checks rollback and retry; `AgentsMigrator.sessionCache.test.ts` runs import followed by count validation. Existing data, runtime, search, recycle-bin and migration consumers run with valid tree fixtures.
