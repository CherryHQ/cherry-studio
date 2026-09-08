import type { ScanRule } from '../types'

/** Host-environment failures: filesystem, disk, databases, native modules. */
export const environmentRules: readonly ScanRule[] = [
  {
    id: 'environment-permission-denied',
    domain: 'environment',
    attribution: 'user-fixable',
    devMessage:
      'A filesystem operation was denied (EPERM/EACCES); antivirus, missing privileges (e.g. Windows symlinks), or a read-only location is blocking the app.',
    anchors: [/\bEPERM\b|\bEACCES\b/]
  },
  {
    id: 'environment-disk-full',
    domain: 'environment',
    attribution: 'user-fixable',
    devMessage: 'The disk is out of space (ENOSPC); the app cannot persist data until space is freed.',
    anchors: [/\bENOSPC\b|no space left on device/i]
  },
  {
    id: 'environment-app-path-missing',
    domain: 'environment',
    attribution: 'app-bug',
    devMessage:
      'The app resolved one of its own directories to a bogus path (e.g. mkdir of a root-level dotfile failing with ENOENT); a packaging/path-resolution defect, not user configuration.',
    anchors: [/\bENOENT\b[\s\S]{0,120}mkdir/i]
  },
  {
    id: 'environment-database-corrupted',
    domain: 'environment',
    attribution: 'app-bug',
    devMessage:
      'A SQLite database failed integrity checks (SQLITE_NOTADB/SQLITE_CORRUPT); the file is damaged or not a database — restore from backup rather than deleting.',
    anchors: [/SQLITE_NOTADB|SQLITE_CORRUPT|database disk image is malformed/i]
  },
  {
    id: 'environment-native-module-load-failed',
    domain: 'environment',
    attribution: 'app-bug',
    devMessage:
      'A native module failed to load (ERR_DLOPEN_FAILED); usually an architecture mismatch between the installed build and the host system.',
    anchors: [/ERR_DLOPEN_FAILED|The specified module could not be found/i]
  }
]
