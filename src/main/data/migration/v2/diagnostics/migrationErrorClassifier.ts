import type { MigrationErrorCategory, MigrationErrorCode } from './migrationDiagnosticsSchemas'

const MAX_CAUSE_DEPTH = 4

export interface ClassifiedMigrationError {
  readonly category: MigrationErrorCategory
  readonly code: MigrationErrorCode
  readonly causeDepth: number
}

const UNKNOWN_CLASSIFICATION: ClassifiedMigrationError = {
  category: 'unknown',
  code: 'unknown',
  causeDepth: 0
}

function classifyCode(code: string): Pick<ClassifiedMigrationError, 'category' | 'code'> | undefined {
  if (code === 'SQLITE_CANTOPEN' || code.startsWith('SQLITE_CANTOPEN_')) {
    return { category: 'filesystem', code: 'path_unavailable' }
  }
  if (code === 'SQLITE_READONLY' || code.startsWith('SQLITE_READONLY_')) {
    return { category: 'filesystem', code: 'permission_denied' }
  }

  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return { category: 'filesystem', code: 'permission_denied' }
    case 'ENOENT':
    case 'ENOTDIR':
      return { category: 'filesystem', code: 'path_unavailable' }
    case 'ENOSPC':
    case 'SQLITE_FULL':
      return { category: 'filesystem', code: 'disk_full' }
    case 'SQLITE_CORRUPT':
      return { category: 'database_read', code: 'sqlite_corrupt' }
    case 'SQLITE_NOTADB':
      return { category: 'database_read', code: 'sqlite_not_database' }
    case 'SQLITE_TOOBIG':
      return { category: 'database_write', code: 'sqlite_too_big' }
    case 'SQLITE_SCHEMA':
      return { category: 'database_read', code: 'sqlite_schema' }
    default:
      if (code === 'SQLITE_CONSTRAINT' || code.startsWith('SQLITE_CONSTRAINT_')) {
        return { category: 'database_write', code: 'sqlite_constraint' }
      }
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
      const classification = classifyCode(code)
      if (classification) return { ...classification, causeDepth }
    }

    current = ownDataProperty(current, 'cause')
  }

  return UNKNOWN_CLASSIFICATION
}
