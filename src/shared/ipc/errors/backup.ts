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
  /** The chosen archive is malformed, tampered with, or built by an incompatible version. */
  ARCHIVE_REJECTED: 'BACKUP_ARCHIVE_REJECTED',
  /** Cancel/arm/acknowledge found no restore in the state the action needs. */
  RESTORE_STATE: 'BACKUP_RESTORE_STATE',
  /** The restore journal cannot be parsed; the next boot quarantines it. */
  JOURNAL_UNREADABLE: 'BACKUP_JOURNAL_UNREADABLE',
  /** The relaunch that performs the restore could not be started; the arm was rolled back. */
  ARM_FAILED: 'BACKUP_ARM_FAILED',
  /** The destination volume cannot take the archive (no space, exists, unsupported). */
  EXPORT_DESTINATION: 'BACKUP_EXPORT_DESTINATION'
} as const
