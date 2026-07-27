export { acknowledgeRestore, type AcknowledgeResult } from './acknowledgeRestore'
export { type BackupOperation, BackupService, type BackupStatus, type RestoreStatus } from './BackupService'
export { BACKUP_CEILINGS, type BackupCeilings } from './ceilings'
export { type ExportArchiveInputs, type ExportArchiveResult, exportLiteArchive } from './exportArchive'
export {
  BACKUP_FORMAT_VERSION,
  BACKUP_PRESETS,
  type BackupManifest,
  type BackupManifestDegradation,
  BackupManifestSchema,
  type BackupPreset,
  type ManagedRootIdentity,
  parseBackupManifest,
  type ReadManifestResult,
  type ResourcePayload,
  type ResourceRequirement
} from './manifest'
export { type PostPromotionOutcome, runPostPromotionWork } from './postPromotion'
export {
  armPreparedRestore,
  cancelPreparedRestore,
  prepareLiteRestore,
  type PrepareRestoreInputs,
  type RestorePreview
} from './prepareRestore'
export {
  type ResourcePathCandidate,
  type ResourcePathLimits,
  type ResourcePathValidation,
  type ResourcePathViolation,
  type TargetState,
  validateResourcePaths
} from './resourcePaths'
export {
  type CoverageReport,
  measureResourceCoverage,
  type ResourceCoverage
} from './resources/coverage'
