/**
 * Backup storage configs (WebDAV / S3). Cross-process: the renderer manages
 * these via settings UI and the main process consumes them in the backup
 * services; both sides pass them across the IPC boundary.
 */

import * as z from 'zod'

export type WebDavConfig = {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
  fileName?: string
  maxBackups?: number
  skipBackupFile?: boolean
  disableStream?: boolean
}

export type LocalBackupConfig = {
  localBackupDir?: string
  maxBackups?: number
  skipBackupFile?: boolean
}

export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
  fileName?: string
  skipBackupFile?: boolean
  autoSync: boolean
  syncInterval: number
  maxBackups: number
}

/**
 * V2 export progress update, emitted during export/restore. Progress is UI-only —
 * never participates in correctness. The renderer
 * routes updates by `backupId` (the startBackup return value, also the cancel key).
 *
 * `phase` is the coarse pipeline step; export uses `snapshot` (DB copy), `collect`
 * (resolve / strip / collect / stage), and `archive` (assembleArchive). Restore-only
 * phases (quiesce / merge / verify / journal / relaunch) are unused by export.
 */
export interface BackupProgressUpdate {
  readonly backupId: string
  readonly phase:
    | 'preflight'
    | 'collect'
    | 'snapshot'
    | 'archive'
    | 'quiesce'
    | 'merge'
    | 'verify'
    | 'journal'
    | 'relaunch'
  readonly current: number
  readonly total: number
  readonly message?: string
}

/** Result of BackupV2_StartBackup — `backupId` is the cancel/progress routing key. */
export interface BackupV2StartResult {
  readonly backupId: string
  readonly archivePath: string
}

/**
 * Resource class for restore planning + disclosure. Shared (main + renderer) so the
 * plan's `SkippedResource.kind` and the IPC `RestoreResultSummary.kind` agree, and
 * knowledge vs skill (both `dir-add` in FileResource) stay distinguishable in the UI.
 */
export type ResourceClass = 'file' | 'knowledge' | 'skill' | 'note'

export const RestoreSkipReasonCodeSchema = z.enum([
  'local_record_exists',
  'target_exists',
  'notes_root_unavailable',
  'outside_user_data',
  // dir-swap (notes-tree-swap): a same-path .md conflict resolved local-first (local content
  // kept, backup dropped) — distinct from target_exists because the local row IS the target.
  'tree_swap_local_first'
])

export type RestoreSkipReasonCode = z.infer<typeof RestoreSkipReasonCodeSchema>

export interface RestoreSkippedResource {
  readonly id: string
  readonly kind: ResourceClass
  readonly reasonCode: RestoreSkipReasonCode
}

/**
 * Lossy outcomes a restore accepts rather than aborting on. Stable codes so the
 * renderer can i18n them; the engine's English detail stays diagnostic-only.
 *
 * - `ref_cleared`: a dangling FK was set NULL (the row survives, the link does not)
 * - `row_pruned`: a row was deleted because a required reference target was missing
 * - `rows_skipped`: backup rows were never imported (e.g. a nested member whose parent
 *   was not imported)
 * - `association_dropped`: a junction / polymorphic association row was dropped because
 *   an endpoint is unavailable in the merged DB
 * - `field_conflict`: a column merge kept the local value on an irreconcilable conflict
 *   (e.g. a discriminated-union `type` mismatch), so the backup value is not applied
 * - `backup_overwrote_local`: a `remote-overwrites-local` field merge replaced a non-empty
 *   local value with the backup value (backup-wins) — destructive, so disclosed distinctly
 *   from `field_conflict` (which keeps local). The UI must tell the user the LOCAL value
 *   was replaced, not kept.
 * - `attachment_unavailable`: an imported message references an attachment blob this
 *   archive did not carry
 * - `resource_content_missing`: the export shipped a resource's DB row without its file
 *   content (manifest `degraded`)
 */
export const RestoreDegradationKindSchema = z.enum([
  'ref_cleared',
  'row_pruned',
  'rows_skipped',
  'association_dropped',
  'field_conflict',
  'backup_overwrote_local',
  'attachment_unavailable',
  'resource_content_missing'
])

export type RestoreDegradationKind = z.infer<typeof RestoreDegradationKindSchema>

/**
 * One structured degradation record. Every lossy restore phase (merge repair, junction /
 * polymorphic drops, field conflicts, attachment disclosure, export-side content
 * omissions) produces these so nothing is disclosed by log line only.
 */
export interface RestoreDegradation {
  readonly kind: RestoreDegradationKind
  /** DB table the loss applies to — scopes the UI line; not user-facing on its own. */
  readonly scope: string
  /** Affected row count (aggregated per scope+kind+detail). */
  readonly count: number
  /** Raw engine detail (English, diagnostic). The UI renders from `kind`. */
  readonly detail?: string
}

/**
 * Restore result summary shown in the relaunch-confirm dialog BEFORE promotion
 * applies. Promotion hasn't run yet at this point (preboot may expire the whole
 * batch via assertNoAddConflicts), so UI copy MUST use future tense
 * ("will restore / will skip"), never "restored".
 *
 * Main→renderer event payload (TCB source → pure type, not zod-parsed).
 * `toRestore` is pre-computed by planning (not reverse-derived from resources,
 * which can't separate knowledge vs skill — both are `dir-add`). `toSkip` mirrors
 * plan.skips 1:1 with stable reason codes for renderer i18n. `degradations` carries
 * the lossy merge/export outcomes — the DB is already merged when this is written, so
 * unlike toRestore/toSkip these describe what the restore ALREADY gave up, and they
 * must survive the relaunch in the journal (a log line does not).
 */
export interface RestoreResultSummary {
  readonly toRestore: ReadonlyArray<{ readonly kind: ResourceClass; readonly count: number }>
  readonly toSkip: ReadonlyArray<RestoreSkippedResource>
  readonly degradations: ReadonlyArray<RestoreDegradation>
}

const ResourceClassSchema: z.ZodType<ResourceClass> = z.enum(['file', 'knowledge', 'skill', 'note'])

const LegacyRestoreSkipReasonSchema = z.enum([
  'local DB row exists',
  'live exists',
  'no managed notesRoot',
  'outside userData',
  'exists — skip'
])

const legacyRestoreSkipReasonCodes: Record<z.infer<typeof LegacyRestoreSkipReasonSchema>, RestoreSkipReasonCode> = {
  'local DB row exists': 'local_record_exists',
  'live exists': 'target_exists',
  'no managed notesRoot': 'notes_root_unavailable',
  'outside userData': 'outside_user_data',
  'exists — skip': 'target_exists'
}

const RestoreSkippedResourceSchema = z.union([
  z.strictObject({
    id: z.string().min(1),
    kind: ResourceClassSchema,
    reasonCode: RestoreSkipReasonCodeSchema
  }),
  z
    .strictObject({
      id: z.string().min(1),
      kind: ResourceClassSchema,
      reason: LegacyRestoreSkipReasonSchema
    })
    .transform(({ id, kind, reason }) => ({
      id,
      kind,
      reasonCode: legacyRestoreSkipReasonCodes[reason]
    }))
])

const RestoreDegradationSchema = z.strictObject({
  kind: RestoreDegradationKindSchema,
  scope: z.string().min(1),
  count: z.number().int().nonnegative(),
  detail: z.string().optional()
})

/** Journal/status schema; legacy English reasons normalize to stable codes. */
export const RestoreResultSummarySchema: z.ZodType<RestoreResultSummary> = z.strictObject({
  toRestore: z.array(
    z.strictObject({
      kind: ResourceClassSchema,
      count: z.number().int().nonnegative()
    })
  ),
  toSkip: z.array(RestoreSkippedResourceSchema),
  // Additive: a journal staged by a build without degradations still parses.
  degradations: z.array(RestoreDegradationSchema).default([])
})

/**
 * Current restore journal outcome, returned by `backup.restore_status` so the
 * UI can disclose what happened across the relaunch boundary (promotion runs
 * preboot — its result outlives the window that requested it).
 *
 * - `pending`: a sealed restore awaits relaunch (or an interrupted promotion
 *   awaits the next boot) — offer restart, not a new restore.
 * - `completed` / `failed` / `expired`: terminal outcome awaiting user
 *   acknowledgement via `backup.restore_acknowledge`; `reason` carries the
 *   journal's raw diagnostic for failed/expired, and `completed` carries the
 *   journal's summary so a crash before the pre-relaunch dialog was seen still
 *   discloses what the restore lost (the journal outlives that window).
 * - `none`: no journal (or corrupt — nothing actionable for the UI).
 */
export type RestoreStatus =
  | { readonly state: 'none' }
  | { readonly state: 'pending'; readonly summary?: RestoreResultSummary }
  | { readonly state: 'completed'; readonly summary?: RestoreResultSummary }
  | { readonly state: 'failed'; readonly reason?: string }
  | { readonly state: 'expired'; readonly reason?: string }
export type BackupResult<T> = {
  result: T
  cleanupFailed: boolean
}

export const AUTO_BACKUP_TYPES = ['webdav', 's3', 'local', 'nutstore'] as const
export type AutoBackupType = (typeof AUTO_BACKUP_TYPES)[number]

export type AutoBackupEventInput =
  | { type: AutoBackupType; status: 'running' }
  | { type: AutoBackupType; status: 'stopped' }
  | { type: AutoBackupType; status: 'succeeded'; timestamp: number }
  | { type: AutoBackupType; status: 'warning'; timestamp: number; reason: 'cleanup_failed' }
  | { type: AutoBackupType; status: 'failed'; timestamp: number; errorMessage: string }

export type AutoBackupEvent = AutoBackupEventInput & { id: number }

export type AutoBackupSnapshot = {
  events: AutoBackupEvent[]
  pendingNotifications: AutoBackupEvent[]
}

export const BACKUP_ACTIVE_WRITERS_ERROR_CODE = 'BACKUP_ACTIVE_WRITERS'
