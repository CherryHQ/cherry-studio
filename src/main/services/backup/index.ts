export { type BackupOperation, BackupService, type BackupStatus, type RestoreStatus } from './BackupService'
export { presentDegradations, presentJournalDegradations } from './degradationReport'
export {
  ArchiveAdmissionError,
  BackupBusyError,
  BackupCancelledError,
  DiskFullError,
  HardLinkUnsupportedError,
  InsufficientDiskSpaceError,
  OutputPathExistsError
} from './errors'
