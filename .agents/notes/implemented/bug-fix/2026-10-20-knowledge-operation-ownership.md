# Agent Note: Preserve knowledge operation ownership

Status: implemented

English | [中文](2026-10-20-knowledge-operation-ownership.zh.md)

## Problem

A bulk reindex waits for every source acquisition. A failed acquisition can therefore finish reporting after a newer reindex of the same item has completed, hiding the newer index by changing its item to failed.

## Decision

Each reindex execution claims the current subtree under the base mutation mutex. Acquisition failure, reset, and settlement may mutate only items still owned by that execution. A container reset also checks its descendants. Ownership is transient because reindex jobs are abandoned on restart; settlement releases only its own claims.

Unchanged remote revisions or hashes skip indexing only while the local owner is completed, checked under the mutation lock. A failed local owner goes through normal staged publication. Cleanup admission and subtree status updates use bounded batches inside the caller transaction; every batch and ownership withdrawal commits or rolls back together.

The large-batch regression also exposed a recursive status-update plan that scanned the entire base for each root. The recursive step fixes the parent as the outer loop with SQLite CROSS JOIN, allowing the existing base/group index to look up children without repeated base scans.

Schedule mutations use the same base mutex and deletion admission fence as teardown. In-flight disconnects own a transient exclusion until settlement and final deletion finish; reauthorization skips those sources, while explicit schedule/state mutations reject them. Failed disconnects release the exclusion and retain the existing paused/retry behavior; this does not add restart-resumable disconnects.

## Alternatives considered

Checking item status cannot distinguish completed → processing → completed. Holding the base mutation lock during network acquisition blocks unrelated mutations. Adding persistent generations requires a schema change for work that never resumes across restart.

## Consequences

Newer overlapping work wins while unrelated roots can still proceed. Ordinary delete and external document ownership guards remain in force.

## Verification

- `ownedSubtreeJobHandlers.integration.test.ts`: a failed A acquisition waits for B, a newer A reindex completes, then the old failure settles; A stays completed and visible through the real SQLite query boundary.
- `reindexSubtreeJobHandler.test.ts`: existing deletion, reset, interruption, and scheduling regressions pass.

- `ExternalKnowledgeSyncService.test.ts`: unchanged revision/hash and a failure just before acquiring the lock rebuild the local owner.
- `subtreeDeletion.integration.test.ts`: 33,001 roots pass real JobManager payload validation and real SQLite status updates; an injected failure rolls back all jobs and status changes.

- `ExternalKnowledgeSourceLifecycle.test.ts`: schedule mutation queued during base teardown cannot leave an orphan schedule.
- `ExternalKnowledgeDisconnect.test.ts`: reauthorization commits while cancellation is deferred without changing the disconnect revision; final source/document deletion succeeds.
