---
description: Scan-based cleanup of unreferenced file entries using the per-entry cleanup policy
sources:
  - src/main/services/file/internal/entryCleanup.ts
  - src/main/data/services/FileEntryService.ts
  - src/main/data/services/FileRefService.ts
  - src/main/data/db/schemas/file.ts
  - src/main/data/db/schemas/fileRelations.ts
---

# File Entry Cleanup

File-entry cleanup reclaims entries whose owning business references have disappeared. It is a
silent, scan-based FileManager task: there is no cleanup queue, SQL trigger, pin toggle, or
renderer action.

This pass is distinct from the filesystem orphan sweep. Entry cleanup starts from rows whose
`cleanupPolicy` allows deletion; the filesystem sweep starts from blobs that no longer have a row.

## 1. Problem

Deleting a business row cascades its association rows, but intentionally does not run filesystem
work inside that transaction. Without a later pass, the `file_entry` row and an internal blob would
remain indefinitely. A create-then-reference workflow can also fail before its first association is
written, producing the same zero-ref state without any delete event.

## 2. Ownership

FileManager owns cleanup because it already owns entry deletion, cache invalidation, and internal
blob removal. Candidate state is derived from the database on every pass; there is no persistent
queue or retry bookkeeping for business services to maintain.

## 3. Safety Boundary

Zero refs alone never authorize deletion. The row must carry automatic cleanup intent, pass the
creation-time grace window, and still have zero registered persistent refs inside the deleting
transaction. Dangling state is not consulted, and a pending restore blocks the pass entirely.

## 4. Business Intent: `cleanupPolicy`

### 4.1 Assignment at Creation

Every entry creation surface requires one of two policies:

| Policy | Zero persistent references |
|---|---|
| `manual` | Preserve the entry until an explicit caller/user deletion |
| `delete_when_unreferenced` | Eligible after the grace window |

The database defaults to `manual` as a safe fallback, but TypeScript creation schemas require an
explicit policy. Business-owned copies and generated/transient artifacts generally use
`delete_when_unreferenced`; user-library imports and other independently retained files use
`manual`. The caller that understands the ownership outcome chooses the policy.

### 4.2 Policy Transitions

`ensureExternalEntry` may upgrade a reused entry from `delete_when_unreferenced` to `manual` when
the new caller wants to retain it. It never implicitly downgrades `manual` to automatic cleanup.
The repository enforces the same upgrade-only rule for normal updates.

Both origins support both policies. Reclaiming an external entry deletes only Cherry's DB row and
cache index; it never deletes the user's file.

### 4.3 Renderer Visibility

`cleanupPolicy` remains part of the `FileEntry` data shape, but the Files page exposes no cleanup
toggle, pending badge, or drain action. Retention is assigned by the creation flow and applied by
the background task.

## 5. Cleanup Pass

### 5.1 Candidate Query

`FileEntryService.findCleanupCandidates()` selects at most 100 rows that:

- have `cleanupPolicy = 'delete_when_unreferenced'`;
- were created more than one hour ago;
- have no row in any persistent reference table registered by
  `persistentFileRefTablesBySourceType`.

The anti-join conditions are generated from that registry rather than hand-maintained. This makes
registration of a new reference source part of the same source of truth used by reference counts
and cleanup. Candidates are ordered by `createdAt`.

`deletedAt` is not a filter: an unreferenced auto-policy internal entry remains eligible even if it
was moved to trash. A manual entry is never a candidate, whether present, missing, active, or
trashed.

The query is equivalent to:

```sql
SELECT file_entry.*
FROM file_entry
WHERE cleanup_policy = 'delete_when_unreferenced'
  AND created_at < :now_minus_one_hour
  AND NOT EXISTS (:one anti-join per registered persistent ref table)
ORDER BY created_at
LIMIT 100;
```

The current registry includes chat messages, agent-session messages, paintings, jobs, translation
history, provider logos, and mini-app logos. Do not copy that list into query code; extend
`persistentFileRefTablesBySourceType` and its exhaustive consumers instead.

### 5.2 Grace Window

The one-hour `createdAt` grace protects create-then-reference workflows and abandoned creations.
It is not a lease and is not extended by reads or metadata updates.

Discovery is only a hint. Each candidate is rechecked inside its own synchronous
`DbService.withWriteTx` callback:

1. re-read the entry;
2. stop if it vanished or is now `manual`;
3. count persistent refs again inside the transaction;
4. stop if a ref appeared;
5. delete the row.

The shared write transaction serializes the ref-count check and deletion. After commit,
`cleanupDeletedEntry()` invalidates caches and best-effort removes an internal blob. An unlink
failure does not restore the row; the later filesystem orphan sweep can reclaim the leftover blob.

### 5.3 No Volume Abort

Entry cleanup has no candidate-count or byte-fraction safety abort. Large legitimate business
deletions also produce large candidate sets, and the pass already requires explicit auto policy,
the grace window, registry-driven ref absence, and an in-transaction recheck.

Do not confuse this with the filesystem orphan sweep, whose plan is based on files without DB rows
and does have count/byte thresholds.

### 5.4 Per-Candidate Protocol

- deleted row -> `deleted`, followed by cache/blob cleanup;
- refs appeared -> `skippedRefsReappeared`;
- row vanished or became manual -> `gonePinned`;
- candidate processing threw -> `failed`, with the row retried by a future scan.

The pass is idempotent because it stores no queue or retry state; every run derives work from the
current database.

### 5.5 Triggering

FileManager starts one ungated pass during initialization. It also registers a 30-minute interval;
an interval pass runs when the system has been idle for at least 60 seconds or no pass has completed
for two hours. `runSweep()` invokes cleanup before its DB/file orphan reports, but that legacy IPC
method has no renderer caller. Source services do not schedule the pass after deleting refs.

`hasPendingRestore()` is checked before discovery. A staged restore can have blobs on disk that are
not yet referenced by the live DB, so cleanup reports `skipped` and examines nothing.

### 5.6 Failure Handling and Observability

Every pass logs one structured `file-entry-cleanup` record with:

- `outcome`: `completed`, `skipped`, or `failed`;
- this batch's `candidates` count (there is no separate backlog count);
- `deleted`, `skippedRefsReappeared`, `gonePinned`, `failed`, and `unlinkFailures`;
- duration and, for a pass-level failure, its error message.

Per-candidate failures are logged and do not stop later candidates. A saturated
`candidates === 100` result is the available backlog signal.

## 6. Race and Failure Behavior

| Scenario | Result |
|---|---|
| A ref exists during discovery | Anti-join excludes the entry |
| A ref is inserted after discovery | Transactional recheck preserves the entry |
| Policy is upgraded after discovery | Transactional re-read preserves the entry |
| Process exits after row deletion, before unlink | Blob is an FS orphan and can be swept later |
| Internal unlink fails | Row stays deleted; failure is counted/logged |
| External entry is reclaimed | Row/cache only; user-owned path is untouched |
| Pass crashes | No queue recovery is needed; the next pass re-derives candidates |

## 7. Migration and Extension

### 7.1 Adding a New Persistent File Reference Source

Follow [File Module Architecture §5.2](./architecture.md#52-adding-a-new-reference-source): add
the source-owned FK table, source type, registry entry, exhaustive `FileRefService` mappings, and
tests. The cleanup anti-join then includes the source automatically.

### 7.2 Migration Classification

The v2 file migrator keeps zero-ref legacy entries `manual` and marks entries with migrated
persistent refs `delete_when_unreferenced`. This avoids interpreting every historical zero-ref file
as disposable on the first cleanup pass.

## 8. Verification Map

| Concern | Tests |
|---|---|
| Candidate query and registry coverage | `src/main/data/services/__tests__/FileEntryService.test.ts` |
| Per-candidate transaction and outcomes | `src/main/services/file/internal/__tests__/entryCleanup.test.ts` |
| Init/idle interval and file-sweep interaction | `src/main/services/file/__tests__/FileManager.entryCleanup.test.ts` |
| End-to-end entry/blob behavior | `src/main/services/file/__tests__/FileManager.integration.test.ts` |
