export { type BackupOperation, BackupService, type BackupStatus, type RestoreStatus } from './BackupService'
export {
  ArchiveAdmissionError,
  BackupBusyError,
  BackupCancelledError,
  BackupFormatCompatibilityError,
  type BackupMigrationCompatibility,
  BackupMigrationCompatibilityError,
  type BackupMigrationTip,
  CeilingExceededError,
  DiskFullError,
  HardLinkUnsupportedError,
  InsufficientDiskSpaceError,
  NonRegularSourceError,
  OutputPathExistsError,
  ResourceInstallPlanError,
  RestoreStateError,
  type RestoreStateErrorCode,
  SourceDriftError,
  UnportableSourceError
} from './errors'
export { BACKUP_FORMAT_VERSION } from './manifest'
export { presentDegradations, presentJournalDegradations } from './restore/degradationReport'
