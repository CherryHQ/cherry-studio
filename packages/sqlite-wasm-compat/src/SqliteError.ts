import { getSqlite } from './sqlite'

/** Mirrors better-sqlite3's `SqliteError`: `code` is the extended result code name, e.g. `SQLITE_CONSTRAINT_UNIQUE`. */
export class SqliteError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'SqliteError'
    this.code = code
  }
}

/** oo1 prefixes messages with "<CODE>: sqlite3 result code <n>: "; better-sqlite3 reports the bare SQLite message. */
const OO1_PREFIX = /^SQLITE_\w+: sqlite3 result code \d+: /

export function toSqliteError(error: unknown): unknown {
  const sqlite3 = getSqlite()
  if (!(error instanceof sqlite3.SQLite3Error)) return error
  const wrapped = new SqliteError(
    error.message.replace(OO1_PREFIX, ''),
    sqlite3.capi.sqlite3_js_rc_str(error.resultCode)
  )
  wrapped.cause = error
  return wrapped
}
