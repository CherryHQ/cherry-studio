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

External staging row validation runs inside the insert transaction, so invalid input cannot leave an unreadable cleanup row. Untitled Feishu nodes use their remote object token as a stable display name. Preview requires a completed external item. Renderer authorization attempts carry a monotonically increasing identity; cleanup and cancellation invalidate it, including across Activity hide/show. A late session is cancelled before browser launch, and completion is checked again after browser launch returns.

Terminal synchronization cleanup is separate from result publication. Authorization failure pauses the Source and advances its revision, so the old Job cannot publish its summary. Settlement still clears that Job's own active reference under the current Source revision, in the same transaction, and notifies after commit. A replacement Job remains protected by its different id. Requiring the original revision for this cleanup leaves manual-only Sources blocked after successful reauthorization.

## Alternatives considered

Checking item status cannot distinguish completed → processing → completed. Holding the base mutation lock during network acquisition blocks unrelated mutations. Adding persistent generations requires a schema change for work that never resumes across restart.

## Consequences

Newer overlapping work wins while unrelated roots can still proceed. Ordinary delete and external document ownership guards remain in force.

## Verification

- Regression — `ownedSubtreeJobHandlers.integration.test.ts`: a failed A acquisition waits for B, a newer A reindex completes, then the old failure settles; A stays completed and visible through the real SQLite query boundary.
- Regression — `reindexSubtreeJobHandler.test.ts`: existing deletion, reset, interruption, and scheduling regressions pass.

- Regression — `ExternalKnowledgeSyncService.test.ts`: unchanged revision/hash and a failure just before acquiring the lock rebuild the local owner.
- Regression — `subtreeDeletion.integration.test.ts`: 33,001 roots pass real JobManager payload validation and real SQLite status updates; an injected failure rolls back all jobs and status changes.

- Regression — `ExternalKnowledgeSourceLifecycle.test.ts`: schedule mutation queued during base teardown cannot leave an orphan schedule.
- Regression — `ExternalKnowledgeDisconnect.test.ts`: reauthorization commits while cancellation is deferred without changing the disconnect revision; final source/document deletion succeeds.

- Regression — `KnowledgeItemService.test.ts`: blank staging titles roll back without leaving a cleanup row.
- Regression — `externalPreview.integration.test.ts`: real SQLite transitions from completed to deleting, processing, and failed revoke preview paths.
- Regression — `ExternalSourcesSection.test.tsx`: late reconnect responses after unmount or Activity hide/show cancel their sessions, and delayed browser launch cannot complete an abandoned authorization.

- Regression — `ExternalKnowledgeSourceLifecycle.test.ts` and `syncExternalSourceJobHandler.test.ts`: credential failure followed by settlement and reauthorization in either order clears only the terminal Job binding, preserves newer-revision results and replacement Jobs, and notifies after commit.
