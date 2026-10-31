---
description: Agent lifecycle command ownership, atomic archive and restore, schedule recovery, purge, and backup quiescing
sources:
  - src/main/ai/agents/AgentLifecycleService.ts
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/main/ai/runtime/claudeCode/ClaudeCodeWarmQueryManager.ts
  - src/main/data/services/AgentService.ts
  - src/main/data/services/AgentSessionService.ts
  - src/main/data/services/AgentTaskService.ts
  - src/main/ai/agents/AgentJobsService.ts
  - src/main/ai/agents/agentOrphanSweep.ts
  - src/main/ai/agents/agentWorkspaceStorage.ts
  - src/main/ai/agents/AgentWorkspaceStorageService.ts
  - src/main/data/services/AgentWorkspaceService.ts
  - src/main/utils/file/pathIdentity.ts
  - src/main/services/LegacyBackupManager.ts
---

# Agent Lifecycle

`AgentLifecycleService` is the command owner for archiving, restoring, and purging
Agents and Agent Sessions, deleting their workspaces, and reclaiming unreferenced
Agent artifacts. It also coordinates Agent-side write quiescing for backup.
Ordinary task execution and message delivery do not pass through this service.

## Ownership and dependencies

```text
Lifecycle IPC / Trash purge / BackupManager
                    ↓
          AgentLifecycleService
            ├─ AgentService / AgentSessionService / AgentTaskService
            ├─ JobManager: synchronize committed schedule timers
            ├─ AgentSessionDeliveryService: queue drain and wakeups
            ├─ AiStreamManager: dispatch admission and abort/drain
            ├─ AgentSessionRuntimeService: runtime close barriers
            ├─ AgentWorkspaceStorageService: storage conversion and recovery
            └─ ChannelManager: reconcile current connection intent
```

Data services own SQLite writes. `AgentTaskService` applies Agent-owner policy
through the physical schedule owner, `JobScheduleService`. Neither schedules nor
the generic JobManager know how to archive an Agent.

The lifecycle service owns operation locks and tracks commands until their
post-commit cleanup finishes. Delivery owns only delivery work. Runtime drivers
still own native session formats, resume mechanics, and artifact reclamation.
ChannelRuntime retains revision checks and stale-adapter isolation; it does not
implement Agent lifecycle policy.

## Commands and transactions

Existing `ai.agent.delete`, `ai.agent.sessions.delete`,
`ai.agent.session.delete`, `ai.agent.session.restore`, and
`ai.agent.workspace.delete` routes delegate to the lifecycle owner. The delete
handlers translate their existing flags into explicit archive or purge methods.
`ai.agent.restore` restores an Agent. Agent restore is not a DataApi mutation:
it coordinates timers and Channel connections as well as SQLite state.

An Agent archive or restore commits the Agent, optional Session archive changes,
and schedule lifecycle changes in one synchronous `withWriteTx` transaction.
Only after commit does the command synchronize timers, request Channel
reconciliation, close affected runtimes, and publish read-model notifications.
DB rollback must not emit these effects. Post-commit resource failures do not
undo committed business state; startup recovery and later reconciliation repair
derived resources.

Restore applies to the explicitly selected entity, not an implicit subtree.
Related Sessions remain independently restorable. Undo supplies explicit entity
IDs; no temporary restore snapshot or archive-operation journal is stored in DB.
Pins removed at archive time are not recreated. Session archive retains the
existing sticky-binding detachment policy.

## Admission and concurrency

Archive rejects unsettled generation, including terminal persistence and runtime
background work. Idle connections and warm preloads can be closed and drained. Agent-only
archive checks its associated Sessions too; retaining Sessions is not permission
to interrupt their generation.

The Session menu separates recoverable **Archive** from red **Delete Permanently**.
The latter requires confirmation and uses `ai.agent.session.delete_permanently`
to remove active Sessions directly, under the same busy check and dispatch lock
as archive. It does not first archive and then purge. Both actions are disabled
while generating or awaiting approval; main-process admission remains authoritative.
The existing Recycle Bin purge still accepts only archived Sessions, so a stale
Recycle Bin page cannot delete a Session that has already been restored.

Agent menus use the same distinction. `ai.agent.delete_permanently` removes an
active Agent directly, with the same Agent/Session locks and busy checks as archive.
Related Sessions are retained by default. The explicit cascade option permanently
deletes all related Sessions, including archived ones, in the Agent transaction;
unrelated Sessions and user workspace directories are preserved. There is no Undo
for permanent deletion. Archived-Agent purge still retains related Sessions.

Assistant menus follow the same product contract through
`trash.assistant.delete_permanently`: `TrashService` owns topic dispatch locks and
busy checks, and `AssistantService` commits owner and optional topic deletion
atomically. Runtime coordination does not move into DataApi.

- Agent commands serialize by Agent ID.
- Session lifecycle operations serialize by Session ID, acquiring multiple IDs
  in sorted order. Restore and purge share these locks.
- Archive additionally uses the existing AiStreamManager dispatch lock to make
  its busy check and DB transition indivisible from new turn admission.
- Aggregate operations re-read membership after acquiring locks and after drains.
- Purge invokes `abortAndDrain` without already holding the dispatch lock, since
  that method acquires the dispatch lock itself.

Locks and pause holds are process-local, not database rows. SQLite transactions
remain synchronous and contain no runtime awaits.

## Scheduled tasks

Archive preserves schedule rows and Channel subscriptions, disables future fires,
and clears `nextRun`. Only schedules enabled before archive receive
`metadata.agentTrash.resumeOnRestore`. Metadata updates merge the current row,
preserving unrelated fields such as Session reuse configuration.

On restore:

| Schedule | Result |
|---|---|
| Previously paused by the user | Remains paused |
| Enabled cron or interval | Re-arms for a future occurrence; no catch-up Job |
| Future once | Re-arms |
| Overdue, unconsumed once | Disabled with `metadata.missed`, displayed as **Missed** |
| Consumed once | Remains completed; no repeat |

Missed tasks remain editable, deletable, and manually runnable; they cannot be
enabled without rescheduling. Editing to a valid future once, cron, or interval
clears missed state and leaves the task paused. Manual execution atomically links
the missed task to its Job and deduplicates overlapping submissions. Completion
clears the marker only if it still belongs to that Job; failures remain missed.
Recovery can reconcile a completed Job whose post-settlement update was interrupted.
This does not strengthen the harness's existing at-least-once execution contract.

Reconciliation reads owners including archived rows. Missing owners permit
schedule deletion; archived owners require suspension, not deletion; active owners
with residual archive markers follow the same restore rules. The initial DB-only
pass runs during service readiness, before JobManager's deferred startup recovery.
Retention disabled does not disable reconciliation or make archived rows orphans.

## Purge and artifact ownership

Explicit purge and retention cleanup use the same lifecycle owner. Candidates are
revalidated under operation locks before runtime drain and deletion. Schedule
deletion shares the Agent deletion transaction, and subscription removal follows
the existing FK cascade. File reclamation happens after DB commit and can retry.

`agentOrphanSweep` belongs to the AI domain. Archived rows still claim their
Agent directories, system workspace archives, and native resume artifacts. Runtime-owned
live tokens also protect native artifacts. The sweep preserves its freshness
gate and pending-backup-restore exclusion. User-selected workspace directories
are never recursively deleted by this workflow.

After a Session is archived and its runtime closes, its system workspace is
compressed to a sibling `<sessionId>.tar.gz`. User workspace rows and directories
are retained unchanged. Compression uses an `.archiving` directory and a temporary
archive; the original contents are removed only after the archive is validated
and published. Failures retain the files for a later lifecycle sweep to retry.
Linked or special files prevent compression rather than being silently omitted.
Archive shutdown drains pending Claude idle-prewarm preparation and subprocess disposal
before filesystem work starts, including idle or replaced entries already detached
from the warm-query map. Failed disposal remains tracked and blocks conversion until retried.

Workspace registration and storage reclamation share `AgentWorkspaceStorageService`
in the AI domain. Registration enters through `ai.agent.workspace.register` IPC;
DataApi retains workspace queries, metadata updates, and ordering. The domain service
owns the process-local reservations, resolves filesystem identities, and combines
persisted claims with those reservations before its synchronous database write;
AgentWorkspaceService only reads and writes database records and publishes workspace
membership changes after registration commits. Existing DataApi queries refresh
across windows without performing file work. Registered overlapping workspaces protect
the whole system tree, including user directories nested below it; logical Session
archival still succeeds. Archive, restore, purge, and orphan sweep hold the reservation
through their filesystem work, so new overlapping registrations fail with a
retryable conflict until it completes. Checks resolve existing path aliases, probe
the managed containing directory's case and Unicode behavior, and include temporary
archive and restore paths. Missing components and stale claims beneath a file remain
protected. Distinct names on case-sensitive filesystems remain independent. Protected directories remain intact
even after the owning system Session is permanently removed. Session and Agent restore reject storage conflicts before activating database rows; a skipped reservation is never treated as a successful restore.

`AgentWorkspaceStorageService` owns every storage transition; `agentWorkspaceStorage`
provides validated filesystem primitives. Session `deletedAt` determines visibility,
while the sibling `.storage.json` durably records the operation ID, Session ID,
direction, phase, directory identity, and archive digest. Each intent is fsynced and
atomically published before its destructive step. Recovery verifies the recorded
copy rather than treating mere path existence as success.

| Operation | Durable phases | Authoritative copy |
|---|---|---|
| Archive | staging → packing → publishing | Original or `.archiving` until a verified archive is published |
| Restore | preparing → prepared → published → committed | Archive or pending directory until publication; backup retained until DB activation commits |
| Purge | deleting | Deletion intent retained until all artifacts are removed |

Restore extracts into a unique child of `.restoring` and publishes the prepared
directory before restoring the Session's database state. Agent restore prepares
all Sessions archived together with that Agent before its single database
transaction. A conflicting destination or invalid source leaves the Session trashed.
DB failure preserves the published restore and its backup for an explicit retry.

Lifecycle sweep resumes the recorded direction. An archived Session with a restore
record stays archived: sweep may finish safe filesystem preparation but never
activates the row or recompresses its source. An active Session allows restore
cleanup to finish. A new explicit archive can settle a published restore and then
archive the current live files. Backup deletion follows a committed restore record;
interruption even after backup removal can finish cleanup on the next sweep.

All operation artifacts remain claimed while their workspace row exists. Purge and
retention cleanup write deletion intent after DB deletion and confirm producer
shutdown before removal. Orphan sweep reclaims each workspace's artifacts as one
group, preserves the group if any member is fresh or claimed by a user workspace,
and removes the operation record last. Runtime JSONL remains owned by the existing
driver orphan sweep and resume-token claims.

## Backup and shutdown

BackupManager owns the whole-app snapshot and restore protocol. AgentLifecycleService
owns the Agent-specific participants, using two stages:

1. `pauseIngress()` holds Channel intake and rejects new lifecycle commands.
2. `drainIngress()` waits for already accepted Channel admissions and lifecycle work.
3. BackupManager pauses global AiStreamManager and JobManager; `pauseExecution()`
   holds Delivery and Runtime autonomous launches.
4. All writers drain before snapshotting. A timeout aborts the backup attempt.

Pausing execution before Channel admission drains could discard an already
acknowledged incoming message. Keep that ordering explicit.

Holds are independent and released only by their owner. Releasing a backup hold
does not restore archived entities or enable user-paused tasks. Successful restore
staging retains its holds until relaunch; failed attempts release their holds.
Backup staging, the restore journal, and preboot promotion remain BackupManager's
responsibility.

Shutdown closes lifecycle-command admission and joins tracked work while its
dependencies are still alive. Runtime and Stream services retain ownership of
their own shutdown procedures.
