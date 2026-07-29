import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Backup v2 IPC schemas — the renderer's whole view of export and restore
 * (docs/references/backup/README.md).
 *
 * Only a Request block. Every state change here is initiated by the window that
 * observes it, and the durable one (the restore journal) survives a relaunch and
 * is read back through `backup.get_status`, so there is nothing for main to push.
 *
 * NO PATHS CROSS THE BOUNDARY INWARD. `export` and `prepare_restore` take no
 * path: main opens the file dialog itself with fixed filters, so the renderer
 * can neither name a file to write nor name a file to read. The paths that come
 * back out are for display only.
 */

export const BACKUP_DEGRADATION_CODES = [
  'capability-malformed',
  'external-file-dropped',
  'path-unportable',
  'path-collision',
  'workspace-disconnected',
  'resource-unavailable',
  'resource-changed',
  'resource-nonportable',
  'resource-limit',
  'unknown'
] as const

export type BackupDegradationCode = (typeof BACKUP_DEGRADATION_CODES)[number]

/** Localizable, bounded presentation of what export/restore reduced (§4). */
const DegradationSchema = z.strictObject({
  code: z.enum(BACKUP_DEGRADATION_CODES),
  count: z.number().int().positive(),
  /** Bounded userData-relative display sample; never an install input. */
  paths: z.array(z.string().min(1).max(1024)).max(3).optional()
})

/** Does THIS device have the files the restored database will point at (§2)? */
const CoverageSchema = z.strictObject({
  available: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  unverifiable: z.number().int().nonnegative()
})

const RestorePreviewSchema = z.strictObject({
  restoreId: z.string(),
  coverage: CoverageSchema,
  /** How many resource units would be created vs replaced on this device. */
  resources: z.strictObject({
    install: z.number().int().nonnegative(),
    replace: z.number().int().nonnegative()
  }),
  degradations: z.array(DegradationSchema),
  /** The archive's database was an older chain, migrated forward during preparation. */
  migratedForward: z.boolean()
})

/** The durable restore journal's state machine (§6.1), as the UI sees it. */
const RestoreStatusSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('unreadable'), error: z.string() }),
  z.strictObject({
    kind: z.literal('journal'),
    state: z.enum([
      'prepared',
      'armed',
      'promoting',
      'reverting',
      'completed',
      'rollback-armed',
      'rolled-back',
      'failed',
      'expired'
    ]),
    restoreId: z.string(),
    step: z.string().optional(),
    /** A `failed` restore still holding the only copy of what it moved (§6.5). */
    recoveryIncomplete: z.literal(true).optional(),
    /** A `completed` restore whose resource units are not all in place yet (§6.5). */
    resourcesIncomplete: z.literal(true).optional(),
    /** Archive-transported Knowledge material still lacks owner-proven index completion. */
    knowledgeRebuildPending: z.literal(true).optional(),
    /** What materializing this archive on THIS device reduced (§4). Absent when nothing was. */
    degradations: z.array(DegradationSchema).optional()
  })
])

const BackupStatusSchema = z.strictObject({
  /** An operation running in main right now; not durable. */
  operation: z.enum(['export', 'prepare-restore']).nullable(),
  restore: RestoreStatusSchema
})

const ExportOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('canceled') }),
  z.strictObject({
    status: z.literal('exported'),
    archivePath: z.string(),
    /** Resource units the archive carries. */
    resourceCount: z.number().int().nonnegative(),
    degradations: z.array(DegradationSchema)
  })
])

const PrepareOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('canceled') }),
  z.strictObject({ status: z.literal('prepared'), preview: RestorePreviewSchema })
])

const AcknowledgeResultSchema = z.strictObject({
  /** False when there was nothing to acknowledge (already done, or no restore ran). */
  acknowledged: z.boolean(),
  restoreId: z.string().optional(),
  removed: z.number().int().nonnegative()
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const backupRequestSchemas = {
  'backup.get_status': defineRoute({ input: z.void(), output: BackupStatusSchema }),
  'backup.export': defineRoute({ input: z.void(), output: ExportOutcomeSchema }),
  'backup.prepare_restore': defineRoute({ input: z.void(), output: PrepareOutcomeSchema }),
  /**
   * Abort the long-running operation reported by `backup.get_status.operation`.
   * NOT `cancel_restore`: this one stops work in flight (an export, an archive
   * being admitted), while `cancel_restore` discards an already-prepared restore.
   * `cancelled: false` means nothing was running — the request raced the finish.
   */
  'backup.cancel_operation': defineRoute({
    input: z.void(),
    output: z.strictObject({ cancelled: z.boolean() })
  }),
  'backup.cancel_restore': defineRoute({ input: z.void(), output: z.void() }),
  'backup.arm_restore': defineRoute({
    input: z.strictObject({ restoreId: z.string().min(1) }),
    output: z.void()
  }),
  'backup.rollback_restore': defineRoute({ input: z.void(), output: z.void() }),
  'backup.acknowledge_restore': defineRoute({
    input: z.strictObject({ knowledgeRebuild: z.enum(['require-complete', 'abandon']) }),
    output: AcknowledgeResultSchema
  })
}
