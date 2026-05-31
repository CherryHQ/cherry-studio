/**
 * Schema-out-of-sync error detection for the v2 migration gate.
 *
 * During v2 development the drizzle migration SQL is disposable — it gets
 * regenerated or deleted freely. When the SQL no longer matches the local
 * database, drizzle re-runs `CREATE TABLE` against objects that already
 * exist and the libsql driver throws `SQLITE_ERROR: ... already exists`.
 * `isSchemaOutOfSyncError` recognizes that specific failure so the gate can
 * show a developer-targeted "reset your local DB" dialog instead of the
 * generic connectivity error.
 *
 * This file lives inside migration/v2/ so it is removed when migration is
 * deleted.
 */

/** Maximum `.cause` chain depth traversed — guards against cyclic causes. */
const MAX_CAUSE_DEPTH = 5

/**
 * True when `error` (or any error in its `.cause` chain) is a libsql
 * `SQLITE_ERROR` whose message reports an existing schema object
 * (`table` / `index` / `trigger` ... `already exists`).
 *
 * Requiring `code === 'SQLITE_ERROR'` excludes constraint violations, which
 * carry `SQLITE_CONSTRAINT_*` codes — those are never a stale-DB symptom.
 * The driver wraps the real error inside an outer `LibsqlError`, so the
 * `.cause` chain is walked rather than inspecting only the top-level error.
 */
export function isSchemaOutOfSyncError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return false
    const code = (current as { code?: string }).code
    if (code === 'SQLITE_ERROR' && /already exists/i.test(current.message)) {
      return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}
