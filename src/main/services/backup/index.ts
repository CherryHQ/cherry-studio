export { type BackupOperation, BackupService, type BackupStatus, type RestoreStatus } from './BackupService'
export { presentDegradations, presentJournalDegradations } from './degradationReport'
export {
  ArchiveAdmissionError,
  BackupBusyError,
  BackupCancelledError,
  BackupFormatCompatibilityError,
  type BackupMigrationCompatibility,
  BackupMigrationCompatibilityError,
  type BackupMigrationTip,
  BackupQuiesceError,
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
