import type {
  MigrationErrorCategory,
  MigrationErrorCode,
  MigrationFailureErrorCode
} from './migrationDiagnosticsSchemas'

const MAX_CAUSE_DEPTH = 4

export interface ClassifiedMigrationError {
  readonly errorCode: MigrationFailureErrorCode
  /** @deprecated Removed with the event-timeline diagnostics consumer. */
  readonly category: MigrationErrorCategory
  /** @deprecated Removed with the event-timeline diagnostics consumer. */
  readonly code: MigrationErrorCode
  /** @deprecated Cause depth is intentionally excluded from persisted diagnostics. */
  readonly causeDepth: number
}

interface LegacyClassification {
  readonly category: MigrationErrorCategory
  readonly code: MigrationErrorCode
}

function legacyClassification(errorCode: MigrationFailureErrorCode): LegacyClassification {
  switch (errorCode) {
    case 'sqlite_corrupt':
    case 'sqlite_not_database':
    case 'sqlite_schema':
      return { category: 'database_read', code: errorCode }
    case 'sqlite_constraint':
    case 'sqlite_too_big':
      return { category: 'database_write', code: errorCode }
    case 'sqlite_open_failed':
    case 'file_missing':
      return { category: 'filesystem', code: 'path_unavailable' }
    case 'sqlite_readonly':
    case 'sqlite_permission':
    case 'file_permission':
    case 'file_readonly':
      return { category: 'filesystem', code: 'permission_denied' }
    case 'sqlite_io':
    case 'file_io':
      return { category: 'filesystem', code: 'disk_full' }
    default:
      return { category: 'unknown', code: 'unknown' }
  }
}

function classified(errorCode: MigrationFailureErrorCode, causeDepth = 0): ClassifiedMigrationError {
  const result = { errorCode } as ClassifiedMigrationError
  const legacy = legacyClassification(errorCode)
  Object.defineProperties(result, {
    category: { value: legacy.category },
    code: { value: legacy.code },
    causeDepth: { value: causeDepth }
  })
  return result
}

const UNKNOWN_CLASSIFICATION = classified('unknown_error')

function classifyCode(code: string): MigrationFailureErrorCode | undefined {
  if (code === 'SQLITE_CANTOPEN' || code.startsWith('SQLITE_CANTOPEN_')) {
    return 'sqlite_open_failed'
  }
  if (code === 'SQLITE_CORRUPT' || code.startsWith('SQLITE_CORRUPT_')) {
    return 'sqlite_corrupt'
  }
  if (code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_NOTADB_')) {
    return 'sqlite_not_database'
  }
  if (code === 'SQLITE_SCHEMA' || code.startsWith('SQLITE_SCHEMA_')) {
    return 'sqlite_schema'
  }
  if (code === 'SQLITE_CONSTRAINT' || code.startsWith('SQLITE_CONSTRAINT_')) {
    return 'sqlite_constraint'
  }
  if (code === 'SQLITE_READONLY' || code.startsWith('SQLITE_READONLY_')) {
    return 'sqlite_readonly'
  }
  if (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_')) {
    return 'sqlite_busy'
  }
  if (code === 'SQLITE_LOCKED' || code.startsWith('SQLITE_LOCKED_')) {
    return 'sqlite_locked'
  }
  if (code === 'SQLITE_IOERR' || code.startsWith('SQLITE_IOERR_')) {
    return 'sqlite_io'
  }

  switch (code) {
    case 'SQLITE_PERM':
    case 'SQLITE_AUTH':
      return 'sqlite_permission'
    case 'SQLITE_TOOBIG':
      return 'sqlite_too_big'
    case 'SQLITE_FULL':
      return 'sqlite_io'
    case 'EACCES':
    case 'EPERM':
      return 'file_permission'
    case 'EROFS':
      return 'file_readonly'
    case 'ENOENT':
    case 'ENOTDIR':
      return 'file_missing'
    case 'ENOSPC':
    case 'EIO':
      return 'file_io'
    default:
      if (code.startsWith('SQLITE_')) return 'sqlite_unknown'
      return undefined
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function ownDataProperty(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

export function classifyMigrationError(error: unknown): ClassifiedMigrationError {
  let current = error
  const visited = new WeakSet<object>()

  for (let causeDepth = 0; causeDepth <= MAX_CAUSE_DEPTH; causeDepth++) {
    if (!isObjectLike(current) || visited.has(current)) return UNKNOWN_CLASSIFICATION
    visited.add(current)

    const code = ownDataProperty(current, 'code')
    if (typeof code === 'string') {
      const errorCode = classifyCode(code)
      if (errorCode) return classified(errorCode, causeDepth)
    }

    current = ownDataProperty(current, 'cause')
  }

  return UNKNOWN_CLASSIFICATION
}
