export type DatabaseFailureKind = 'busy' | 'io' | 'access' | 'full' | 'corrupt' | 'unknown'

/** Accepts both driver errors and their serialized diagnostic-log representation. */
export function classifyDatabaseFailure(error: unknown): { kind: DatabaseFailureKind; code?: string } {
  let current = error
  const visited = new Set<unknown>()
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current)
    const { code, cause } = current as { code?: unknown; cause?: unknown }
    if (typeof code === 'string') {
      if (/^SQLITE_BUSY(?:_|$)/.test(code)) return { kind: 'busy', code }
      if (/^SQLITE_IOERR(?:_|$)/.test(code)) return { kind: 'io', code }
      if (/^SQLITE_(?:CORRUPT|NOTADB)(?:_|$)/.test(code)) return { kind: 'corrupt', code }
      if (code === 'SQLITE_FULL' || code === 'ENOSPC') return { kind: 'full', code }
      if (/^SQLITE_(?:READONLY|CANTOPEN|PERM)(?:_|$)/.test(code) || code === 'EACCES' || code === 'EPERM') {
        return { kind: 'access', code }
      }
    }
    current = cause
  }
  return { kind: 'unknown' }
}
