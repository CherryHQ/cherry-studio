import { ACTIVE_JOB_STATUSES, JobStatusAtomSchema } from '@shared/data/api/schemas/jobs'
import type { KnowledgeItemStatus } from '@shared/data/types/knowledge'

/**
 * The portable-database materialization policy table
 * (docs/references/backup/README.md §3.1). One entry per table this phase makes
 * a decision about, naming the exact columns and the evidence for the decision.
 *
 * This module is deliberately DATA ONLY — plain strings and small pure
 * predicates, no schema import. The production Drizzle schema is asserted against
 * this table by `__tests__/schemaGuard.test.ts`, so a renamed table or column
 * breaks that test loudly instead of silently turning a policy into a no-op.
 * Keeping the schema out of the module graph is also what lets the policy stay
 * free of database and filesystem I/O.
 *
 * Materialization is archive processing: it rewrites only the archive's own
 * staged database and NEVER consults a target business row (§3.1 invariant).
 */

export type MaterializationPolicy =
  /** Copied verbatim — business data, or bootstrap state the target must keep to migrate and boot. */
  | 'preserve'
  /** Rows removed, or columns overwritten with a target-safe value. */
  | 'reset'
  /** Managed absolute paths rebased onto target roots ({@link ./managedPathRebase}). */
  | 'rebase'
  /** An external absolute path kept as metadata only: never rebased, stat'd, followed, copied, or auto-activated. */
  | 'inert'
  /** Derived artifact regenerated after promotion instead of being transported. */
  | 'rebuild'

export interface TablePolicyEntry {
  /** SQLite table name. */
  readonly table: string
  readonly policy: MaterializationPolicy
  /**
   * Drizzle property names of the columns the policy applies to (empty when the
   * policy is table-wide). These are the names the materializer writes, and the
   * names the schema guard asserts still exist.
   */
  readonly columns: readonly string[]
  /** Why — a contract reference plus the reader that makes the decision necessary. */
  readonly evidence: string
}

export const PORTABLE_DB_POLICIES: readonly TablePolicyEntry[] = Object.freeze([
  {
    table: 'app_state',
    policy: 'preserve',
    columns: [],
    evidence:
      '§3.1 "retain app_state keys required by v2 migration/seeding rather than dropping the table". The keys are exactly that bootstrap state: migration_v2_status (src/main/data/migration/v2/core/MigrationEngine.ts:66,533) and the seed journal seedRunner:bootstrapCompleted / seed:<name> (src/main/data/db/seeding/SeedRunner.ts:10,43,77). Dropping them would re-run seeding over restored business rows.'
  },
  {
    table: 'job',
    policy: 'reset',
    columns: ['status'],
    evidence:
      '§3.1 "runtime work proven unsafe to restore (e.g. pending job executions)". Non-terminal rows are deleted (see isJobRowResettable). JobManager.dispatchAll() runs every `pending` row ~60s after onAllReady (src/main/core/job/JobManager.ts:473-479), and startup recovery RESETS `running` rows of `recovery: "retry"` types back to `pending` and executes them (src/main/core/job/runtime/recovery.ts:96-99). Those handlers spawn an agent runtime (src/main/ai/agents/runAgentTask.ts:145), call a paid image API, resume a remote OCR poll, and — worst — run a destructive knowledge subtree delete (src/main/features/knowledge/tasks/deleteSubtreeJobHandler.ts:20). Terminal rows are inert history and stay.'
  },
  {
    table: 'job_schedule',
    policy: 'reset',
    columns: ['enabled'],
    evidence:
      '§3.1 dangerous capabilities: an enabled schedule fires automatically — JobManager arms every row from `listEnabled()` (src/main/core/job/JobManager.ts:448 → src/main/data/services/JobScheduleService.ts:71-79), and an agent heartbeat schedule is INVISIBLE in the Tasks UI (filtered at src/main/data/services/AgentTaskService.ts:97) yet still armed, so a restored archive could carry automation the user cannot see. `enabled: false` is sufficient AND minimal: a disabled row is never listed, so it is never armed and never caught up. `nextRun`/`lastRun` are deliberately NOT cleared — see JOB_SCHEDULE_AUTOMATION_PATCH. `trigger`, `jobInputTemplate`, `catchUpPolicy`, `metadata`, `type` and `name` are PRESERVED as inert configuration.'
  },
  {
    table: 'mcp_server',
    policy: 'reset',
    columns: ['isActive', 'isTrusted', 'trustedAt', 'dxtPath'],
    evidence:
      '§3.1 dangerous capabilities. See ./capabilityReset.ts (sanitizeMcpServerCapability) for the per-column evidence: an active server is auto-connected and a stdio server SPAWNS `command`; `dxtPath` becomes a spawn cwd. `command`, `args`, `env`, `baseUrl`, `headers`, `configSample` and the disabled-tool lists are PRESERVED as inert configuration.'
  },
  {
    table: 'agent',
    policy: 'reset',
    columns: ['configuration'],
    evidence:
      '§3.1 agent automation. See ./capabilityReset.ts (sanitizeAgentAutomation): heartbeat_enabled must be written `false` because the reader skips only on an explicit false (src/main/ai/agents/runAgentTask.ts:89); scheduler_enabled is reset with it; permission_mode `bypassPermissions` is dropped. Instructions, models, env_vars and unknown keys are PRESERVED.'
  },
  {
    table: 'agent_channel',
    policy: 'reset',
    columns: ['isActive', 'activeChatIds', 'permissionMode'],
    evidence:
      '§3.1 channel automation. `isActive` DEFAULTS TO TRUE (src/main/data/db/schemas/agentChannel.ts:21) and an active channel connects to a third-party messaging service, so it is the highest-risk automation flag in the schema. `config` (bot tokens, endpoints) and `workspace` are PRESERVED as inert configuration.'
  },
  {
    table: 'agent_channel_task',
    policy: 'preserve',
    columns: [],
    evidence:
      "Pure link rows (channel ↔ job_schedule, src/main/data/db/schemas/agentChannel.ts:37-46). They cannot fire on their own: the schedule they reference is reset to `enabled: false` and the channel to `isActive: false`, so preserving the wiring costs nothing and keeps the user's setup intact."
  },
  {
    table: 'agent_workspace',
    policy: 'rebase',
    columns: ['path', 'type'],
    evidence:
      '§3.1 names managed `agent_workspace.path` as a rebase target. `path` is a NOT NULL absolute path with a byte-exact unique index (src/main/data/db/schemas/agentWorkspace.ts:9,20). A path under a registered managed root rebases; a user-chosen workspace outside every managed root is `external` and stays inert (§4 — never created, followed, or auto-activated).'
  },
  {
    table: 'note',
    policy: 'rebase',
    columns: ['rootPath', 'path'],
    evidence:
      '§3.1 names `note.rootPath` as a rebase target. `path` is already root-relative and is NOT rewritten. Rows exist only to carry is_starred/is_expanded state (CHECK note_has_state_check, src/main/data/db/schemas/note.ts:19), so a row whose root stays external is harmless inert metadata.'
  },
  {
    table: 'knowledge_item',
    policy: 'inert',
    columns: ['data', 'status'],
    evidence:
      '§3.1 "archive-supplied external absolute paths: never auto-activate". `data.source` is the user\'s ORIGINAL absolute path (src/shared/data/types/knowledge.ts:231) — it is preserved untouched and never rebased, stat\'d, or followed, because rewriting a field inside an arbitrary JSON union would be the reflective rewriting §3.1 forbids. Verified safe to preserve: every reader of `data.source` is user-initiated (src/main/features/knowledge/KnowledgeService.ts:387 add-items, :1136 reindex — the latter `recovery: "abandon"`, so startup recovery cancels it rather than replaying it). `status` is reset only for the one value that auto-executes; see resetKnowledgeItemStatus.'
  },
  {
    table: 'knowledge_base',
    policy: 'rebuild',
    columns: [],
    evidence:
      '§3.1 "derived indexes: rebuild" and §6.7. The vector index lives on the filesystem at {baseId}/.cherry/index.sqlite{,-wal,-shm} — excluded from directory-unit hashing (§5.1.2) and rebuilt by the post-promotion reindex scheduler — so no DB column here transports it and none is rewritten.'
  },
  {
    table: 'file_entry',
    policy: 'reset',
    columns: ['externalPath', 'origin'],
    evidence:
      '§3.1/§4: an external absolute path cannot be retained as inert metadata because existing renderers resolve FileEntry ids automatically (for example generated-image tool output) and turn UNC paths into file:// authorities. Materialization deletes origin=external rows; FK-owned relation rows cascade, while historical message payloads keep their display metadata but can no longer resolve the removed id. Internal blobs carry no path column and remain portable.'
  },
  {
    table: 'agent_global_skill',
    policy: 'preserve',
    columns: ['folderName'],
    evidence:
      'No rebase needed: `folderName` is a RELATIVE folder name under the managed skills root (src/main/data/db/schemas/agentGlobalSkill.ts, unique index agent_global_skill_folder_name_unique), not an absolute path, so it is already portable. Listed explicitly so a future change to an absolute path is caught by review rather than assumed safe.'
  },
  {
    table: 'preference',
    policy: 'reset',
    columns: ['scope', 'key', 'value'],
    evidence:
      '§3.1 device/platform-local preference keys. Rows whose `key` is in ./preferenceResetPolicy.ts PREFERENCE_RESET_KEYS are DELETED so the target default applies; feature.code_cli.configs gets sub-key surgery instead. Every other preference row is preserved.'
  }
])

const ACTIVE_JOB_STATUS_SET: ReadonlySet<string> = new Set(ACTIVE_JOB_STATUSES)

/**
 * Whether a `job` row must be dropped while staging.
 *
 * Reuses the job domain's own `ACTIVE_JOB_STATUSES` / `JobStatusAtomSchema`
 * (src/shared/data/api/schemas/jobs.ts) rather than restating the list, so a
 * status added upstream is classified here automatically instead of silently
 * falling through as "terminal".
 *
 * An UNRECOGNIZED status is also dropped: a state this build cannot classify
 * cannot be proven terminal, and keeping a possibly-runnable row is the unsafe
 * direction.
 */
export function isJobRowResettable(status: unknown): boolean {
  const parsed = JobStatusAtomSchema.safeParse(status)
  if (!parsed.success) return true
  return ACTIVE_JOB_STATUS_SET.has(parsed.data)
}

/**
 * Columns to overwrite on every `job_schedule` row.
 *
 * `enabled: false` alone, on purpose. Clearing the derived scheduling cursors
 * looks tidier and is actively DANGEROUS:
 * - `lastRun` is what marks a `once` schedule spent. `armSchedule` skips it only
 *   when `lastRun !== null && lastRun >= trigger.at`
 *   (src/main/core/job/JobManager.ts:2058-2066); with `lastRun` cleared, a
 *   past-due `once` schedule is re-armed and `scheduleOnce` fires a past `at`
 *   IMMEDIATELY (src/main/core/scheduler/SchedulerService.ts:238-239, delay 0).
 *   Clearing it would therefore CREATE the replay the reset is meant to prevent.
 * - `nextRun` only feeds the cron overdue test, which treats a null cursor as
 *   not-overdue (src/main/core/job/runtime/catchUp.ts:78-82) — so clearing it
 *   changes nothing that `enabled: false` has not already stopped.
 */
export const JOB_SCHEDULE_AUTOMATION_PATCH = Object.freeze({ enabled: false } as const)

/**
 * The one `knowledge_item.status` value a restore must rewrite.
 *
 * `deleting` is not merely stale — it is EXECUTABLE. `recoverDeletingItems()`
 * runs at `onAllReady` (src/main/features/knowledge/KnowledgeService.ts:1021-1032),
 * finds every `deleting` subtree root, and enqueues `knowledge.delete-subtree`,
 * which recursively removes knowledge storage and purges vectors
 * (src/main/features/knowledge/utils/storage/pathStorage.ts:232). A restored
 * archive carrying such a row would silently destroy content on the TARGET
 * machine — the exact class of unconfirmed side effect §3.1 forbids.
 *
 * The other in-flight statuses (`preparing`, `processing`, `reading`, `embedding`)
 * are deliberately LEFT ALONE: the owning service force-fails them itself on
 * every startup (`failInterruptedItems`,
 * src/main/data/services/KnowledgeItemService.ts:226-246) precisely so paid
 * embeddings are not auto-respent. Duplicating that here would add a second
 * policy for state the owner already handles, and rewriting them to `idle` would
 * be worse — it would invite an automatic re-index the owner refuses to do.
 */
const KNOWLEDGE_ITEM_AUTO_EXECUTING_STATUS = 'deleting' satisfies KnowledgeItemStatus

/**
 * The reason written alongside the reset status. `knowledge_item.error` is a
 * plain non-empty reason string by convention
 * (`KnowledgeItemService.failInterruptedItems`, src/main/data/services/KnowledgeItemService.ts:226-237),
 * not a code the UI translates.
 */
const KNOWLEDGE_ITEM_RESET_ERROR = 'Deletion was interrupted by a backup restore; retry it on this device'

/** The status/error pair a `knowledge_item` row is reset to. */
export interface KnowledgeItemStatusReset {
  readonly status: Extract<KnowledgeItemStatus, 'failed'>
  readonly error: string
}

/**
 * The reset for one `knowledge_item.status`, or `null` when the row needs no
 * change.
 *
 * `failed` — the same terminal state the owner uses for interrupted work — and
 * NOT `idle`: the delete genuinely did not complete, `failed` stops
 * `recoverDeletingItems` from firing, and it keeps the row out of any automatic
 * re-index. The user can retry the deletion on the target device.
 *
 * `status` and `error` MUST move together: `knowledge_item_status_error_check`
 * admits `failed` only with a non-blank `error` (and requires `error IS NULL` for
 * every other status), so writing the status alone would abort the whole
 * materialization transaction and make any archive containing a `deleting` item
 * unrestorable.
 */
export function resetKnowledgeItemStatus(status: unknown): KnowledgeItemStatusReset | null {
  // The status type is pinned to the schema's own union, so removing either
  // literal from KNOWLEDGE_ITEM_STATUSES breaks this at typecheck rather than
  // emitting a value `knowledge_item_status_check` would reject.
  if (status !== KNOWLEDGE_ITEM_AUTO_EXECUTING_STATUS) return null
  return { status: 'failed', error: KNOWLEDGE_ITEM_RESET_ERROR }
}
