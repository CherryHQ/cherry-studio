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

// ── Error payloads: what an `IpcError.data` carries for the compatibility codes ──
// Here rather than in `errors/backup.ts` because these are zod values, and that
// module stays zod-free so the renderer may value-import its code map.

const VersionDiagnosticSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/)

const MigrationTipDiagnosticSchema = z.strictObject({
  folderMillis: z.number().int().safe().nonnegative(),
  hashPrefix: z.union([z.string().regex(/^[0-9a-f]{12}$/), z.literal('unavailable')])
})

const CompatibilityCommonSchema = z.object({
  archiveAppVersion: VersionDiagnosticSchema,
  archiveBuildType: z.enum(['packaged', 'development', 'unknown']),
  currentAppVersion: VersionDiagnosticSchema,
  currentBuildType: z.enum(['packaged', 'development']),
  sourceMigrationCount: z.number().int().safe().positive(),
  targetMigrationCount: z.number().int().safe().positive(),
  sourceTip: MigrationTipDiagnosticSchema,
  targetTip: MigrationTipDiagnosticSchema
})

export const BackupMigrationCompatibilityDiagnosticSchema = z.discriminatedUnion('kind', [
  CompatibilityCommonSchema.extend({
    kind: z.literal('source-ahead'),
    missingMigrationCount: z.number().int().safe().positive(),
    firstExtraIndex: z.number().int().safe().positive()
  }).strict(),
  CompatibilityCommonSchema.extend({
    kind: z.literal('lineage-fork'),
    firstDivergentIndex: z.number().int().safe().positive()
  }).strict()
])

export type BackupMigrationCompatibilityDiagnostic = z.infer<typeof BackupMigrationCompatibilityDiagnosticSchema>

export const BackupFormatCompatibilityDiagnosticSchema = z.strictObject({
  kind: z.enum(['archive-newer', 'archive-legacy']),
  archiveFormatVersion: z.number().int().safe().nonnegative(),
  currentFormatVersion: z.number().int().safe().nonnegative(),
  archiveAppVersion: VersionDiagnosticSchema.optional(),
  archiveBuildType: z.enum(['packaged', 'development', 'unknown']),
  currentAppVersion: VersionDiagnosticSchema,
  currentBuildType: z.enum(['packaged', 'development'])
})

export type BackupFormatCompatibilityDiagnostic = z.infer<typeof BackupFormatCompatibilityDiagnosticSchema>

const DRIVE_PREFIX = /^[a-zA-Z]:/

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export const BackupDiagnosticPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => {
    if (hasControlChar(value)) return false
    if (value.startsWith('/') || value.includes('\\') || DRIVE_PREFIX.test(value)) return false
    return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  })

/**
 * Bounded, presentation-only detail for `BACKUP_EXPORT_SOURCE`.
 *
 * Paths are userData-relative display values, never filesystem inputs. Main
 * omits a path it cannot prove belongs to the active profile.
 */
export const BackupExportSourceDiagnosticSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('quiesce-timeout'),
    phase: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/)
  }),
  z.strictObject({
    kind: z.literal('source-changed'),
    path: BackupDiagnosticPathSchema.optional()
  }),
  z.strictObject({
    kind: z.literal('non-regular'),
    path: BackupDiagnosticPathSchema.optional()
  }),
  z.strictObject({
    kind: z.literal('unportable-path'),
    reason: z.enum(['invalid-path', 'name-collision']),
    path: BackupDiagnosticPathSchema.optional()
  }),
  z.strictObject({
    kind: z.literal('limit-exceeded'),
    limit: z.enum(['entry-count', 'resource-entries', 'entry-bytes', 'total-bytes', 'manifest-bytes', 'unknown'])
  })
])

export type BackupExportSourceDiagnostic = z.infer<typeof BackupExportSourceDiagnosticSchema>

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
  'external-reference',
  'dangling-reference',
  'cyclic-reference',
  'unclassified-reference',
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

/**
 * Does THIS device have the files the restored database will point at (§2)?
 * `available` + `rebuildable` + `missing` partition the requirements;
 * `unverifiable` counts references that are not requirements at all.
 */
const CoverageSchema = z.strictObject({
  available: z.number().int().nonnegative(),
  /** Present as source material; its owner rebuilds the derived state after restore. */
  rebuildable: z.number().int().nonnegative(),
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
  // No detail: the renderer branches on `kind` and says its own sentence, and
  // the underlying report names the journal's path and quotes its contents.
  z.strictObject({ kind: z.literal('unreadable') }),
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
  operation: z.enum(['export', 'prepare-restore', 'arm-restore', 'rollback-restore']).nullable(),
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
