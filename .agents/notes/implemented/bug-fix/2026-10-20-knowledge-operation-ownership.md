# Agent Note: Preserve knowledge operation ownership

Status: implemented

English | [中文](2026-10-20-knowledge-operation-ownership.zh.md)

## Problem

A bulk reindex waits for every source acquisition. A failed acquisition can therefore finish reporting after a newer reindex of the same item has completed, hiding the newer index by changing its item to failed.

## Decision

Each reindex execution claims the current subtree under the base mutation mutex. Acquisition failure, reset, and settlement may mutate only items still owned by that execution. A container reset also checks its descendants. Ownership is transient because reindex jobs are abandoned on restart; settlement releases only its own claims.

Unchanged remote revisions or hashes skip indexing only while the local owner is completed, checked under the mutation lock. A failed local owner goes through normal staged publication. Cleanup admission and subtree status updates use bounded batches inside the caller transaction; every batch and ownership withdrawal commits or rolls back together.

The large-batch regression also exposed a recursive status-update plan that scanned the entire base for each root. The recursive step fixes the parent as the outer loop with SQLite CROSS JOIN, allowing the existing base/group index to look up children without repeated base scans.

## Alternatives considered

Checking item status cannot distinguish completed → processing → completed. Holding the base mutation lock during network acquisition blocks unrelated mutations. Adding persistent generations requires a schema change for work that never resumes across restart.

## Consequences

Newer overlapping work wins while unrelated roots can still proceed. Ordinary delete and external document ownership guards remain in force.

## Verification

- Regression — `ownedSubtreeJobHandlers.integration.test.ts`: a failed A acquisition waits for B, a newer A reindex completes, then the old failure settles; A stays completed and visible through the real SQLite query boundary.
- Regression — `reindexSubtreeJobHandler.test.ts`: existing deletion, reset, interruption, and scheduling regressions pass.

- Regression — `ExternalKnowledgeSyncService.test.ts`: unchanged revision/hash and a failure just before acquiring the lock rebuild the local owner.
- Regression — `subtreeDeletion.integration.test.ts`: 33,001 roots pass real JobManager payload validation and real SQLite status updates; an injected failure rolls back all jobs and status changes.
