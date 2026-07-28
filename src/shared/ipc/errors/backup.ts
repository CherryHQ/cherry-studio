import * as z from 'zod'

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

/**
 * Backup-domain IpcApi error codes. Import directly from this module on both
 * sides.
 *
 * The set is the closed list of failures the restore UI must say something
 * specific about; everything else is an unexpected fault and stays `INTERNAL`.
 */
export const backupErrorCodes = {
  /** Another export or restore preparation holds the service. */
  BUSY: 'BACKUP_BUSY',
  /** The caller is not a window this app manages, so it may not drive a restore. */
  SENDER_NOT_ALLOWED: 'BACKUP_SENDER_NOT_ALLOWED',
  /** The chosen archive is malformed, corrupt, tampered with, or otherwise unsafe. */
  ARCHIVE_REJECTED: 'BACKUP_ARCHIVE_REJECTED',
  /** The archive database has a strict extension of this build's migration chain. */
  RESTORE_REQUIRES_NEWER_APP: 'BACKUP_RESTORE_REQUIRES_NEWER_APP',
  /** The archive database and this build diverge within their shared migration prefix. */
  RESTORE_LINEAGE_INCOMPATIBLE: 'BACKUP_RESTORE_LINEAGE_INCOMPATIBLE',
  /** The archive uses a different Backup container/manifest format. */
  FORMAT_UNSUPPORTED: 'BACKUP_FORMAT_UNSUPPORTED',
  /** Cancel/arm/acknowledge found no restore in the state the action needs. */
  RESTORE_STATE: 'BACKUP_RESTORE_STATE',
  /** The restore journal cannot be parsed; the next boot quarantines it. */
  JOURNAL_UNREADABLE: 'BACKUP_JOURNAL_UNREADABLE',
  /** The relaunch that performs the restore could not be started; the arm was rolled back. */
  ARM_FAILED: 'BACKUP_ARM_FAILED',
  /** The previous DB has already been released, so a completed restore can no longer roll back. */
  ROLLBACK_UNAVAILABLE: 'BACKUP_ROLLBACK_UNAVAILABLE',
  /** A failed restore still holds the only copy of what it moved; a restart retries it. */
  RECOVERY_INCOMPLETE: 'BACKUP_RECOVERY_INCOMPLETE',
  /** A backup/restore working volume has insufficient usable space. */
  STORAGE_UNAVAILABLE: 'BACKUP_STORAGE_UNAVAILABLE',
  /** The export source changed or violates the portable resource contract. */
  EXPORT_SOURCE: 'BACKUP_EXPORT_SOURCE',
  /** The selected output cannot be atomically published without clobbering. */
  EXPORT_DESTINATION: 'BACKUP_EXPORT_DESTINATION',
  /** Restore resources conflict with the target filesystem (type, symlink, or device). */
  RESTORE_RESOURCES: 'BACKUP_RESTORE_RESOURCES'
} as const
